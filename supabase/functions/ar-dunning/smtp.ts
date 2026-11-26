export type SmtpConfig = { host: string; port: number; username: string; password: string; from: string };

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const enc = new TextEncoder();

async function bounded<T>(operation: Promise<T>, phase: string, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`smtp_${phase}_timeout`)), ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function validateSmtpConfig(value: Partial<SmtpConfig>): SmtpConfig {
  const { host, port, username, password, from } = value;
  if (!host?.trim() || port !== 465 || !username?.trim() || !password || !from?.trim() ||
      !emailPattern.test(username) || !emailPattern.test(from)) throw new Error("smtp_configuration");
  return { host: host.trim(), port, username: username.trim(), password, from: from.trim() };
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodedWord(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("smtp_header");
  return `=?UTF-8?B?${b64(enc.encode(value))}?=`;
}

export function makeMimeMessage(from: string, to: string, subject: string, text: string): Uint8Array {
  if (!emailPattern.test(from) || !emailPattern.test(to) || /[\r\n]/.test(from + to + subject)) throw new Error("smtp_header");
  const body = b64(enc.encode(text)).replace(/.{1,76}/g, "$&\r\n");
  return enc.encode([
    `From: ${from}`, `To: ${to}`, `Subject: ${encodedWord(subject)}`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    body.replace(/\r\n$/, ""),
  ].join("\r\n"));
}

export interface SmtpSocket { read(buffer: Uint8Array): Promise<number | null>; write(buffer: Uint8Array): Promise<number>; close(): void }
export type SmtpConnect = (host: string, port: number) => Promise<SmtpSocket>;

class Replies {
  private pending = "";
  private socket: SmtpSocket;
  constructor(socket: SmtpSocket) { this.socket = socket; }
  async read(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const newline = this.pending.indexOf("\n");
      if (newline < 0) {
        const buf = new Uint8Array(2048); const size = await bounded(this.socket.read(buf), "reply");
        if (size === null) throw new Error("smtp_disconnected");
        this.pending += new TextDecoder().decode(buf.subarray(0, size));
        if (this.pending.length > 16_384) throw new Error("smtp_reply_too_large");
        continue;
      }
      const line = this.pending.slice(0, newline).replace(/\r$/, ""); this.pending = this.pending.slice(newline + 1);
      if (!/^\d{3}[ -]/.test(line)) throw new Error("smtp_protocol");
      const code = Number(line.slice(0, 3)); lines.push(line.slice(4));
      if (line[3] === " ") return { code, lines };
    }
  }
}

async function write(socket: SmtpSocket, value: string | Uint8Array): Promise<void> {
  const bytes = typeof value === "string" ? enc.encode(value) : value; let offset = 0;
  while (offset < bytes.length) { const count = await bounded(socket.write(bytes.subarray(offset)), "write"); if (!count) throw new Error("smtp_disconnected"); offset += count; }
}

async function expect(reply: Replies, accepted: number[], phase: string): Promise<void> {
  const result = await reply.read(); if (!accepted.includes(result.code)) throw new Error(`smtp_${phase}_${result.code}`);
}

async function login(config: SmtpConfig, connect: SmtpConnect): Promise<{ socket: SmtpSocket; reply: Replies }> {
  const socket = await connect(config.host, config.port); const reply = new Replies(socket);
  await expect(reply, [220], "greeting"); await write(socket, "EHLO qerp.local\r\n"); await expect(reply, [250], "ehlo");
  await write(socket, "AUTH LOGIN\r\n"); await expect(reply, [334], "auth");
  await write(socket, `${b64(enc.encode(config.username))}\r\n`); await expect(reply, [334], "auth");
  await write(socket, `${b64(enc.encode(config.password))}\r\n`); await expect(reply, [235], "auth");
  return { socket, reply };
}

export async function probeSmtp(raw: Partial<SmtpConfig>, connect: SmtpConnect): Promise<void> {
  const config = validateSmtpConfig(raw); const { socket } = await login(config, connect);
  try { await write(socket, "QUIT\r\n"); } finally { socket.close(); }
}

export async function sendSmtp(raw: Partial<SmtpConfig>, to: string, subject: string, text: string, connect: SmtpConnect): Promise<void> {
  const config = validateSmtpConfig(raw);
  if (!emailPattern.test(to)) throw new Error("smtp_recipient");
  const { socket, reply } = await login(config, connect);
  try {
    await write(socket, `MAIL FROM:<${config.from}>\r\n`); await expect(reply, [250], "mail_from");
    await write(socket, `RCPT TO:<${to}>\r\n`); await expect(reply, [250, 251], "recipient");
    await write(socket, "DATA\r\n"); await expect(reply, [354], "data");
    const rawMessage = makeMimeMessage(config.from, to, subject, text);
    const data = new TextDecoder().decode(rawMessage).replace(/(^|\r\n)\./g, "$1..");
    try { await write(socket, `${data}\r\n.\r\n`); await expect(reply, [250], "accepted"); }
    catch (error) {
      if (error instanceof Error && /^smtp_accepted_/.test(error.message)) throw error;
      const uncertain = new Error("smtp_delivery_uncertain");
      Object.defineProperty(uncertain, "cause", { value: error, configurable: true, writable: true });
      throw uncertain;
    }
    await write(socket, "QUIT\r\n");
  } finally { socket.close(); }
}

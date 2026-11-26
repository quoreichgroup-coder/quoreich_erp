import { describe, expect, it } from "vitest";
import { makeMimeMessage, probeSmtp, sendSmtp, validateSmtpConfig, type SmtpSocket } from "../../../supabase/functions/ar-dunning/smtp";

class FakeSmtpSocket implements SmtpSocket {
  private queue = [new TextEncoder().encode("220 ready\r\n")];
  private wake: (() => void) | null = null;
  private inData = false;
  transcript = "";
  async read(buffer: Uint8Array) {
    while (this.queue.length === 0) await new Promise<void>((resolve) => { this.wake = resolve; });
    const chunk = this.queue.shift()!; buffer.set(chunk); return chunk.length;
  }
  async write(bytes: Uint8Array) {
    const value = new TextDecoder().decode(bytes); this.transcript += value;
    let response = "";
    if (value.startsWith("EHLO")) response = "250-test\r\n250 AUTH LOGIN\r\n";
    else if (value === "AUTH LOGIN\r\n") response = "334 username\r\n";
    else if (value === btoa("u@x.test") + "\r\n") response = "334 password\r\n";
    else if (value === btoa("secret") + "\r\n") response = "235 authenticated\r\n";
    else if (value.startsWith("MAIL FROM:")) response = "250 sender ok\r\n";
    else if (value.startsWith("RCPT TO:")) response = "250 recipient ok\r\n";
    else if (value === "DATA\r\n") { this.inData = true; response = "354 send data\r\n"; }
    else if (value === "QUIT\r\n") response = "221 bye\r\n";
    else if (this.inData) { this.inData = false; expect(value).toMatch(/\r\n\.\r\n$/); response = "250 accepted\r\n"; }
    else throw new Error(`Unexpected SMTP command: ${value}`);
    if (response) { this.queue.push(new TextEncoder().encode(response)); this.wake?.(); this.wake = null; }
    return bytes.length;
  }
  close() {}
}

describe("cloud dunning SMTP", () => {
  it("conserve la cause d'une coupure après DATA sans annoncer une livraison certaine", async () => {
    const interrupted = new Error("connection lost");
    class InterruptedSocket extends FakeSmtpSocket {
      override async write(bytes: Uint8Array) {
        if (new TextDecoder().decode(bytes).endsWith("\r\n.\r\n")) throw interrupted;
        return super.write(bytes);
      }
    }
    const socket = new InterruptedSocket();
    const config = { host: "smtp.example.test", port: 465, username: "u@x.test", password: "secret", from: "billing@x.test" };
    await expect(sendSmtp(config, "client@x.test", "Relance", "Bonjour", async () => socket))
      .rejects.toMatchObject({ message: "smtp_delivery_uncertain", cause: interrupted });
    expect(socket.transcript).not.toContain("QUIT");
  });

  it("requires TLS SMTP on the port allowed by the hosted Edge runtime", () => {
    expect(validateSmtpConfig({ host: "smtp.example.test", port: 465, username: "user@example.test", password: "secret", from: "user@example.test" }).port).toBe(465);
    expect(() => validateSmtpConfig({ host: "smtp.example.test", port: 587, username: "u@example.test", password: "secret", from: "u@example.test" })).toThrow("smtp_configuration");
  });

  it("encodes subjects and message bodies and rejects header injection", () => {
    const message = new TextDecoder().decode(makeMimeMessage("billing@example.test", "client@example.test", "Relance émise", "Bonjour\r\n.test"));
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).not.toContain("\r\n.test");
    expect(message.endsWith("\r\n.")).toBe(false);
    expect(() => makeMimeMessage("billing@example.test", "client@example.test", "ok\r\nBcc: x@example.test", "body")).toThrow("smtp_header");
  });

  it("probes authenticated TLS without DATA and completes one correctly terminated SMTP message", async () => {
    const config = { host: "smtp.example.test", port: 465, username: "u@x.test", password: "secret", from: "billing@x.test" };
    const probe = new FakeSmtpSocket();
    await probeSmtp(config, async () => probe);
    expect(probe.transcript).not.toMatch(/MAIL FROM|RCPT TO|^DATA/m);
    const send = new FakeSmtpSocket();
    await sendSmtp(config, "client@x.test", "Relance", "Bonjour", async () => send);
    expect(send.transcript).toContain("RCPT TO:<client@x.test>");
    expect(send.transcript).toMatch(/\r\n\.\r\nQUIT\r\n$/);
  });
});

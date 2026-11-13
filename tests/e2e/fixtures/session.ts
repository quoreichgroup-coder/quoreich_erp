/**
 * Session Supabase factice pour les specs qui simulent le backend (page.route).
 *
 * L'application redirige vers /login sans session (ProtectedRoute). Sous Lovable, la session
 * était injectée par l'aperçu ; en local il faut la fournir. On dépose donc dans le localStorage,
 * à la clé que supabase-js lit (`sb-<ref>-auth-token`), une session dont le jeton n'expire pas
 * pendant le test : supabase-js la tient pour valide sans appel réseau. Le jeton n'est pas signé
 * et n'ouvre rien côté serveur — toute requête non simulée qui atteindrait Supabase serait
 * refusée (401). Les specs simulent ensuite `profiles` pour donner la société.
 *
 * Les specs connectées (treasury-rbac-*, treasury-realtime) se connectent elles-mêmes avec de
 * vrais identifiants et remplacent cette session.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const E2E_USER_ID = "00000000-0000-4000-8000-0000000000e2";

function supabaseUrl(): string {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL;
  try {
    const env = readFileSync(resolve(import.meta.dirname, "../../../.env"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("VITE_SUPABASE_URL="));
    if (line) return line.slice("VITE_SUPABASE_URL=".length).replace(/^["']|["']$/g, "").trim();
  } catch {
    /* pas de .env : la clé par défaut ci-dessous ne correspondra à rien, les specs le diront */
  }
  return "https://example.supabase.co";
}

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function fakeSessionStorageState(origin: string) {
  const ref = new URL(supabaseUrl()).hostname.split(".")[0];
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const user = {
    id: E2E_USER_ID, aud: "authenticated", role: "authenticated", email: "e2e@example.test",
    app_metadata: { provider: "email" }, user_metadata: { full_name: "Utilisateur E2E" },
    created_at: "2026-01-01T00:00:00Z",
  };
  const accessToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    sub: E2E_USER_ID, aud: "authenticated", role: "authenticated", exp, email: user.email,
  })}.e2e`;
  const session = {
    access_token: accessToken, token_type: "bearer", expires_in: 24 * 3600, expires_at: exp,
    refresh_token: "e2e-refresh", user,
  };
  return {
    cookies: [],
    origins: [{ origin, localStorage: [{ name: `sb-${ref}-auth-token`, value: JSON.stringify(session) }] }],
  };
}

import { supabase } from "@/integrations/supabase/client";
import { apiBaseUrl } from "@/api/client";

/**
 * Temps réel sur site (V118) : une seule WebSocket vers l'API (`/api/v1/realtime`), partagée par tous les écrans.
 * Le jeton de session part dans le premier message (pas dans l'URL). Le serveur ne relaie que les changements de la
 * société de l'utilisateur, sous la forme { type: "change", table } : l'écran relit ses données sous la RLS.
 * La connexion se rouvre seule (fin de jeton, coupure, redémarrage de l'API) avec une attente croissante.
 */
type Listener = (table: string) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function url() {
  return `${apiBaseUrl().replace(/^http/, "ws")}/api/v1/realtime`;
}

async function connect() {
  timer = null;
  if (socket || listeners.size === 0 || typeof WebSocket === "undefined") return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    schedule();
    return;
  }
  const ws = new WebSocket(url());
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
  ws.onmessage = (e) => {
    let m: { type?: string; table?: string };
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m.type === "ready") retry = 0;
    if (m.type === "change" && m.table) listeners.forEach((l) => l(m.table!));
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    schedule();
  };
  ws.onerror = () => ws.close();
}

function schedule() {
  if (timer || listeners.size === 0) return;
  const delay = Math.min(30_000, 1_000 * 2 ** retry);
  retry = Math.min(retry + 1, 5);
  timer = setTimeout(() => void connect(), delay);
}

/** S'abonne aux changements de la société ; renvoie la fonction de désabonnement. */
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  if (!socket && !timer) void connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      const s = socket;
      socket = null;
      s?.close();
    }
  };
}

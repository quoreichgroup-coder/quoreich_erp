/**
 * Client HTTP de l'API Java QUOREICH.
 *
 * L'API est optionnelle côté front : tant que `VITE_QERP_API_URL` n'est pas définie,
 * `isApiEnabled()` vaut `false` et les hooks migrés (AR) continuent d'interroger Supabase.
 * La bascule d'un environnement est donc une variable, pas un déploiement du front.
 *
 * Le jeton est celui de la session courante : l'API ne lit jamais la société dans le jeton
 * (elle vient de `profiles`), si bien que ce client n'envoie aucun paramètre de société.
 */
import { supabase } from "@/integrations/supabase/client";

const RAW_BASE = (import.meta.env.VITE_QERP_API_URL as string | undefined) ?? "";

export function apiBaseUrl(): string {
  return RAW_BASE.replace(/\/+$/, "");
}

export function isApiEnabled(): boolean {
  return apiBaseUrl() !== "";
}

/** Erreur HTTP de l'API : `message` est le texte générique renvoyé par le serveur. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiHttpError(401, "Session expirée, reconnectez-vous");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* corps absent ou non JSON : on garde le message par défaut */
    }
    throw new ApiHttpError(response.status, message);
  }
  return response;
}

export async function apiGet<T>(path: string): Promise<T> {
  return (await authorizedFetch(path)).json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return (await authorizedFetch(path, { method: "POST", body: JSON.stringify(body) })).json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return (await authorizedFetch(path, { method: "PUT", body: JSON.stringify(body) })).json() as Promise<T>;
}

/** Télécharge un CSV servi par l'API (avec jeton : un simple lien `<a href>` n'en porte pas). */
export async function apiDownloadCsv(path: string, filename: string): Promise<void> {
  const blob = await (await authorizedFetch(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

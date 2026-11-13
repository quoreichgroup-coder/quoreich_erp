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

/** Message quand le serveur n'en donne pas un à lui : dire à l'utilisateur quoi faire, pas le code. */
export function defaultMessage(status: number): string {
  if (status === 401) return "Session non reconnue par le serveur : reconnectez-vous";
  if (status === 403) return "Accès refusé : droits insuffisants dans la société courante";
  if (status === 404) return "Élément introuvable, ou non visible dans la société courante";
  if (status >= 500) return "Le serveur a rencontré une erreur : réessayez, ou contactez l'administrateur";
  return `Erreur ${status}`;
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
    // Message par défaut quand le serveur n'en donne pas (401 et 403 de la couche sécurité
    // arrivent sans corps) : dire à l'utilisateur quoi faire, pas seulement le code.
    let message = defaultMessage(response.status);
    try {
      const body = (await response.json()) as { error?: string; status?: number; path?: string };
      // Seuls les refus rédigés par l'API ({"error": "…"}) sont affichés tels quels. Le corps
      // d'erreur par défaut de Spring ({"status", "error": "Not Found", "path"}) n'est qu'un
      // libellé HTTP en anglais : on garde le message par défaut, qui dit quoi faire.
      if (body.error && body.path === undefined && body.status === undefined) message = body.error;
      // 404 au format Spring : c'est la ROUTE qui n'existe pas (un élément introuvable renvoie
      // un 404 sans corps). Cas typique : API lancée sur une version plus ancienne que l'écran.
      else if (response.status === 404 && body.path !== undefined) {
        message = "Service introuvable sur le serveur : l'API est plus ancienne que l'application, redémarrez-la";
      }
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

export async function apiDelete<T>(path: string): Promise<T> {
  return (await authorizedFetch(path, { method: "DELETE" })).json() as Promise<T>;
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

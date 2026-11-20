/**
 * Suivi des expéditions (V131) : lecture d'un fichier de suivi exporté par le transitaire ou la compagnie (Excel / CSV),
 * sans saisie. Les colonnes sont reconnues par leur en-tête (français ou anglais), l'étape par son libellé (mots-clés
 * du référentiel shipment_event_codes, inspiré de DCSA Track & Trace), la date au format français, ISO ou Excel.
 */
import { parseDate } from "@/lib/bank-statement";

export interface EventCode { code: string; label: string; stage: number; keywords: string[] }
export interface ParsedEvent {
  line: number; event_code: string | null; event_at: string | null; event_class: "planned" | "estimated" | "actual";
  location: string | null; vessel: string | null; voyage: string | null; container_number: string | null; notes: string | null; raw: string;
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const COLUMNS: Record<string, string[]> = {
  date: ["date", "date de l'evenement", "event date", "date/heure", "date et heure", "actual date", "timestamp", "date evenement"],
  event: ["evenement", "event", "statut", "status", "etape", "milestone", "activite", "activity", "description", "move"],
  location: ["lieu", "location", "port", "place", "localisation", "ville", "city", "terminal"],
  vessel: ["navire", "vessel", "vol", "flight", "vessel name", "transport"],
  voyage: ["voyage", "voyage no", "voyage number", "n° voyage"],
  container: ["conteneur", "container", "container number", "n° conteneur", "equipment"],
  kind: ["type", "nature", "estime/reel", "estimated/actual", "event type"],
};

/** Indice de chaque colonne reconnue dans les en-têtes (−1 si absente). */
export function detectColumns(headers: string[]): Record<keyof typeof COLUMNS, number> {
  const h = headers.map(norm);
  const out = {} as Record<keyof typeof COLUMNS, number>;
  for (const [field, names] of Object.entries(COLUMNS)) {
    out[field as keyof typeof COLUMNS] = h.findIndex((x) => names.some((n) => x === norm(n))) >= 0
      ? h.findIndex((x) => names.some((n) => x === norm(n)))
      : h.findIndex((x) => names.some((n) => x.includes(norm(n))));
  }
  return out;
}

/** Étape reconnue par son libellé : le mot-clé le plus long trouvé l'emporte (« gate out » avant « out »). */
export function classifyEvent(label: string, codes: EventCode[]): string | null {
  const l = norm(label);
  if (!l) return null;
  const exact = codes.find((c) => norm(c.code) === l.replace(/\s+/g, "_") || norm(c.label) === l);
  if (exact) return exact.code;
  let best: { code: string; len: number } | null = null;
  for (const c of codes) for (const k of c.keywords) {
    const kk = norm(k);
    if (kk && l.includes(kk) && (!best || kk.length > best.len)) best = { code: c.code, len: kk.length };
  }
  return best?.code ?? null;
}

function kindOf(raw: string, label: string): ParsedEvent["event_class"] {
  const t = norm(`${raw} ${label}`);
  if (/\b(estime|estimated|eta|etd|expected|prevu)\b/.test(t)) return /\bprevu\b/.test(t) && !/estime/.test(t) ? "planned" : "estimated";
  if (/\b(planned|planifie)\b/.test(t)) return "planned";
  return "actual";
}

/** Lignes du fichier → événements (ligne non reconnue gardée avec event_code null pour l'aperçu). */
export function parseTrackingRows(rows: string[][], codes: EventCode[]): ParsedEvent[] {
  if (rows.length < 2) return [];
  const col = detectColumns(rows[0]);
  const at = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  return rows.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== "")).map((r, i) => {
    const label = at(r, col.event);
    const container = at(r, col.container).toUpperCase().replace(/\s/g, "");
    return {
      line: i + 2,
      event_code: classifyEvent(label, codes),
      event_at: parseDate(at(r, col.date).split(/\s+/)[0]),
      event_class: kindOf(at(r, col.kind), label),
      location: at(r, col.location) || null,
      vessel: at(r, col.vessel) || null,
      voyage: at(r, col.voyage) || null,
      container_number: /^[A-Z]{4}\d{7}$/.test(container) ? container : null,
      notes: label || null,
      raw: r.join(" · "),
    };
  });
}

export const TRACKING_STATES: Record<string, { label: string; tone: "success" | "warning" | "destructive" | "muted" }> = {
  on_time: { label: "À l'heure", tone: "success" },
  delayed: { label: "Retardé", tone: "warning" },
  overdue: { label: "En retard (ETA dépassée)", tone: "destructive" },
  arrived: { label: "Arrivé", tone: "success" },
  delivered: { label: "Livré", tone: "muted" },
};

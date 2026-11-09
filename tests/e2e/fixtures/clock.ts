/**
 * Horloge fixe pour les tests E2E.
 *
 * `FIXED_NOW` est la date/heure de référence partagée par tous les tests
 * Treasury qui dépendent d'un filtrage par date (audit, prévisions, etc.)
 * afin que les résultats — y compris le contenu CSV exporté — soient
 * reproductibles.
 *
 * `freezeClock(page)` installe l'horloge factice dans le navigateur via
 * l'API `page.clock` de Playwright (gèle `Date.now`, `new Date()`,
 * `setTimeout`, etc.). À appeler AVANT `page.goto(...)`.
 *
 * `fixedToday(offsetDays)` produit une date ISO (YYYY-MM-DD) calée sur
 * FIXED_NOW, utilisable côté Node (fixtures Supabase) pour seeder des
 * lignes alignées avec ce que le navigateur "voit".
 */
import type { Page } from "@playwright/test";

// 2026-06-15 09:00:00 UTC — date arbitraire mais stable.
export const FIXED_NOW_ISO = "2026-06-15T09:00:00.000Z";
export const FIXED_NOW = new Date(FIXED_NOW_ISO);

export async function freezeClock(page: Page, iso: string = FIXED_NOW_ISO) {
  await page.clock.install({ time: new Date(iso) });
  await page.clock.pauseAt(new Date(iso));
}

export function fixedToday(offsetDays = 0, base: Date = FIXED_NOW) {
  return new Date(base.getTime() + offsetDays * 864e5).toISOString().slice(0, 10);
}

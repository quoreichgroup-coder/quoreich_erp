/**
 * Écrans entièrement traduits (périmètre du PoC, C-07). Partout ailleurs, une langue autre que le
 * français affiche un avertissement explicite plutôt qu'un mélange silencieux. Ajouter un écran ici
 * seulement quand tous ses textes passent par les catalogues (contrôle CI des fichiers pilotes).
 * La coquille (menu, barre du haut, connexion) est traduite partout.
 */
export const I18N_READY_PAGES = ["/sales", "/settings?tab=languages"] as const;

export function isI18nReady(pathname: string, search = ""): boolean {
  const tab = new URLSearchParams(search).get("tab");
  const page = tab ? `${pathname}?tab=${tab}` : pathname;
  return (I18N_READY_PAGES as readonly string[]).includes(page);
}

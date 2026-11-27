/**
 * Clés de traduction du menu, dérivées des adresses (stables) et non des libellés.
 * « / » devient « __ » : un point créerait une hiérarchie i18next (« sales » à la fois texte et objet).
 */
export function navPathKey(url: string): string {
  const path = url.replace(/^\//, "").replace("?tab=", "/tab_").replace(/[^a-zA-Z0-9/_]/g, "_").toLowerCase();
  return path ? path.split("/").join("__") : "home";
}
export const navItemKey = (url: string) => `item.${navPathKey(url)}`;
export const navModuleKey = (basePath: string) => `module.${navPathKey(basePath)}`;
export const navSectionKey = (id: string) => `section.${id}`;

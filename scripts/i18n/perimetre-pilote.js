/**
 * Fichiers du périmètre pilote i18n (PoC du 26 nov. 2026) : aucun texte visible en dur n'y est
 * accepté (règle ESLint i18next/no-literal-string, en erreur) ni aucune locale codée en dur.
 * Un fichier entre dans cette liste quand il est entièrement traduit ; il n'en sort jamais.
 */
export const FICHIERS_PILOTES = [
  "src/pages/Login.tsx",
  "src/components/AuthShell.tsx",
  "src/components/TopNav.tsx",
  "src/components/DashboardSidebar.tsx",
  "src/components/CommandPalette.tsx",
  "src/components/NotificationBell.tsx",
  "src/components/AppearanceSettings.tsx",
  "src/components/PageShell.tsx",
  "src/pages/Settings.tsx",
  "src/components/LanguageSettingsPanel.tsx",
  "src/components/LanguageSwitcher.tsx",
  "src/pages/Sales.tsx",
  "src/components/CommercialLinesEditor.tsx",
  "src/components/DocumentEditions.tsx",
];

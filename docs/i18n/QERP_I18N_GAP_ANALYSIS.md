# QERP — Analyse des écarts i18n / l10n

Fondé sur `QERP_I18N_CURRENT_STATE_AUDIT.md` (26 nov. 2026).

## 1. Matrice de maturité

Échelle d'état : 0 = rien · 1 = codes stables, textes en dur · 2 = partiellement externalisé · 3 = traduisible.
Les preuves renvoient à l'audit de l'existant.

| Module | État actuel | Preuve (fichier/ligne) | Écart | Risque | Priorité | Phase cible | Recommandation |
|---|---|---|---|---|---|---|---|
| Socle front (shell, menu, auth) | 0 | `src/lib/navigation.ts`, `index.html:2`, `src/pages/Login.tsx` | Pas de bibliothèque, `lang` fixe | Élevé : bloque tout | P0 | 1 | i18next + namespace `common`, `lang` dynamique |
| Formats (dates, nombres, montants) | 1 | 271 `"fr-FR"` / 160 fichiers ; 95 formateurs locaux | Aucun formateur central | Élevé : incohérences | P0 | 1 | `src/lib/locale-format.ts` unique, lint interdisant `"fr-FR"` |
| Erreurs base / API | 1 | 2 216 `RAISE`, 144 `QGxxx` ; `DatabaseRefusalAdvice.java:34-58` | Texte FR seul porteur du détail | Élevé : 1 900 messages | P0 | 1 (essentiels) → 2 | Clé + paramètres dans `HINT`/`DETAIL`, texte FR en repli (D-I18N-004) |
| Comptabilité / GL | 1 | `accounting_journals` V38, `report_lines` V63, `annex_notes` V123 | Libellés de référentiel FR | Moyen | P1 | 2 | Traductions des référentiels système |
| Ventes / CRM / Clients | 1 | `src/pages/Sales*.tsx`, `CommercialLinesEditor` | Écrans + documents FR | Moyen | P1 | 1–2 | Namespace `sales`, langue documentaire du client |
| Comptes clients (AR) | 1 | `ar_dunning_rules.template` V5:355 ; `ar-dunning` | Relance monolingue | Moyen | P1 | 2 | Modèle de relance par langue |
| Achats / Approvisionnement | 1 | `ProcurementLifecycleActions`, V143 | Écrans mixtes FR/EN (27 libellés anglais) | Moyen | P1 | 1–2 | Corriger le mélange dès la phase 1 |
| Comptes fournisseurs (AP) | 1 | `APInvoiceActions`, `Withholding.tsx` | idem | Moyen | P1 | 2 | |
| Stocks | 1 | `InventoryTransactions.tsx` ; pas d'unité de mesure normalisée | Désignations d'articles non traduisibles | Moyen | P2 | 2 | `item_translations` si besoin commercial |
| Trésorerie | 1 | `TreasuryTransactions.tsx`, `bank-statement.ts` (formats FR de relevé) | Import de relevés FR seulement | Faible | P2 | 2 | Parseur multi-format (déjà détection auto) |
| Immobilisations | 1 | `AssetAccountingPanels.tsx` | Écrans FR | Faible | P2 | 2 | |
| Budget / Contrôle de gestion | 1 | `BudgetTransactions.tsx`, `budget-import.ts` (mois en français) | Import « mars 2041 » FR seul | Faible | P2 | 2 | Noms de mois par locale |
| RH / Paie | 1 | `hr_payroll_settings.country` ; bulletin PDF FR | Bulletin monolingue ; **règles déjà séparées de la langue** | Moyen (légal) | P1 | 2 | Langue du bulletin = langue documentaire du salarié |
| Projets / Notes de frais | 1 | `use-projects.ts`, `use-expenses.ts` | Écrans FR | Faible | P2 | 2 | |
| Conformité / Risques | 1 | `src/lib/grc.ts` | Écrans FR | Faible | P3 | 2 | |
| Administration / Rôles | 1 | `erp_permission_catalog.label` V23 (143 droits) | Libellés de droits FR en base | Moyen | P1 | 2 | Traduction du catalogue |
| Documents PDF / Excel | 1 | `document-pdf.ts:91` (montant en lettres FR), V141 `lang="fr"`, contexte figé sans langue | Pas de langue documentaire | Élevé (pièces légales) | P0 | 1 (stockage) → 2 | Figer langue + locale dans le contexte émis |
| Notifications / e-mails | 1 | `ar-dunning/index.ts` | Messages FR | Moyen | P1 | 2 | Langue du destinataire |
| Business AI | 1 | prompts « en français » : `ai-*/index.ts:133,135`, `AiAnalyses.java:146,238` | Langue de réponse fixe | Faible | P2 | 2 | Langue de réponse = langue de l'utilisateur |
| Reporting / exports CSV | 1 | `csv-export.ts:7-10` (`;`, virgule) | Format Excel FR fixe | Moyen | P1 | 1 | Séparateur selon locale |
| Tests | 0 | 1 293 sélecteurs E2E sur libellés FR | Pas de contrôle de couverture | Élevé (régressions) | P0 | 1 | Parcours en `fr` par défaut, contrôles CI de clés |
| Mobile | — | Absent | Hors périmètre actuel | — | — | 3 | Réutiliser les mêmes catalogues JSON |
| EAM, Maintenance, Downtime, Fleet, Production | — | Absents | Modules à construire | — | — | dès leur création | Naître traduisibles (règle de développement) |

## 2. Benchmark ERP

> Rédigé à partir de connaissances documentaires des éditeurs ; **les références n'ont pas été consultées en
> ligne dans cette session**. Chaque ligne est à confirmer sur la documentation officielle avant d'être citée
> à un client (décision D-I18N-010).

| Éditeur | Pratique | Applicable à QERP |
|---|---|---|
| SAP S/4HANA / Fiori | Langue de connexion par utilisateur ; textes de référentiels dans des tables de texte dépendantes de la langue (clé + `SPRAS`) ; langue de correspondance par tiers ; outils de traduction séparés du développement | Table de traduction par référentiel ; langue documentaire du tiers |
| Microsoft Dynamics 365 F&O | Fichiers de libellés par langue ; langue utilisateur ≠ paramètres régionaux ; langue sur les fiches client / fournisseur pour les documents | Séparer `language` et `locale` |
| Oracle Fusion / EBS | Architecture MLS : tables `_TL` avec `LANGUAGE` et `SOURCE_LANG`, une ligne par langue installée, repli vers la langue source | Modèle relationnel + indicateur de langue source |
| Sage (300 / X3) | Textes traduisibles centralisés (X3) ; langue de la société et langue du tiers pour les éditions | Langue société par défaut + tiers |
| Odoo (≥ 16) | Champs traduisibles stockés en JSONB `{"fr_FR": …, "en_US": …}` ; langue sur le partenaire pour les documents ; import/export PO | JSONB pour référentiels globaux, simple à requêter |
| ERPNext | Langue par utilisateur ; doctype de traduction pour personnaliser les libellés ; langue du client sur les impressions | Personnalisation tenant au-dessus des traductions globales |

Constantes partagées : **(1)** langue ≠ pays ≠ réglementation ; **(2)** langue documentaire portée par le
tiers ; **(3)** repli explicite vers une langue source ; **(4)** codes techniques jamais traduits.

## 3. Écarts structurants

1. **Aucune notion de langue** dans le modèle (utilisateur, société, tiers, document) → D-I18N-003.
2. **Messages métier en base sans clé** : ≈ 1 900 textes à convertir progressivement → D-I18N-004.
3. **Documents émis sans langue figée** : un document réimprimé après un changement de langue changerait de contenu, ce que V141 interdit déjà pour les données → D-I18N-007.
4. **Tests E2E liés aux libellés** : 1 293 sélecteurs → D-I18N-009.
5. **Formats dispersés** (95 formateurs) : la locale ne peut pas changer sans un formateur central → phase 1.

## 4. Ce qui est déjà conforme

- Statuts, droits (`module.action`), rôles système et codes d'erreur sont des **codes stables** [V].
- Règles fiscales, sociales et de paie portées par un **pays** et des paramètres confirmés (V80+, V129) : aucune dépendance à la langue [V].
- Devises traitées comme données métier (V124–V130) [V].
- Contexte de document émis figé et haché (V141) : il suffit d'y ajouter langue et locale [V].

## Note de consolidation — 26 novembre 2026, après-midi

- Matrice après PoC : la coquille (menu, barre du haut, recherche, notifications, apparence, connexion), l'accueil
  Ventes, l'onglet « Langues et formats », l'éditeur de lignes commerciales et l'édition des factures passent à
  l'**état 3 (traduisible)**. Tous les autres écrans restent à l'état 1 et affichent, dans une langue autre que le
  français, un avertissement explicite (C-07).
- Erreurs base / API : état 2 pour le contrat (clé + paramètres + repli), 13 sites sur 2 248 portent une clé
  (2 refus existants convertis — émission de facture et compte de comptabilisation manquant — et 11 nouveaux sites
  V155). Dénominateurs corrigés dans l'audit (38 codes, 1 204 messages littéraux).
- Benchmark : non vérifié sur sources officielles dans cette session (D-I18N-010, non bloquant pour le PoC).

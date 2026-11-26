# QERP — Spécification fonctionnelle i18n / l10n

## 1. Principes

- **Langue** (`fr`, `en`) : textes affichés. **Locale** (`fr-BF`, `fr-FR`, `en-GB`, `en-US`) : formats.
  **Pays / référentiel** (BF, CI, SYSCOHADA, PCG) : règles fiscales, comptables, sociales. Les trois sont indépendants.
- Changer de langue ne modifie **jamais** une règle de calcul, un taux, un plan comptable ni un document émis.
- Une traduction manquante **n'empêche jamais** une opération : repli explicite, puis la clé elle-même.
- Codes, numéros de pièce, comptes, références, identifiants et données saisies ne sont **jamais traduits**.
- Identifiants BCP 47 ; langues MVP : `fr` (source) et `en`.

## 2. Préférences linguistiques

| Niveau | Porteur (cible) | Défaut |
|---|---|---|
| Plateforme | configuration | `fr` / `fr-FR` |
| Société (tenant) | `tenants.default_language`, `default_locale`, `timezone` | plateforme |
| Utilisateur | `profiles.language`, `profiles.locale` | société |
| Tiers (client, fournisseur, salarié) | `document_language` | société |
| Document émis | figé dans le contexte (`language`, `locale`) | voir matrice |
| Navigateur | `navigator.languages` | uniquement avant connexion |

## 3. Matrice de priorité linguistique

| Contexte | 1er choix | 2e | 3e | Repli final |
|---|---|---|---|---|
| Écran (connecté) | utilisateur | société | plateforme | `fr` puis clé |
| Écran de connexion | navigateur (si langue active) | plateforme | — | `fr` |
| Erreur API / base | langue de la requête (`Accept-Language` envoyé par le front) | utilisateur | société | texte FR d'origine |
| Document commercial (devis, facture, BL, avoir, relance) | choix explicite à l'émission | tiers | société | `fr` |
| Document interne (DA, BC interne, écriture, état) | utilisateur qui imprime | société | — | `fr` |
| Bulletin de paie | salarié | société | — | `fr` |
| E-mail de notification | destinataire (utilisateur ou tiers) | société | — | `fr` |
| Tâche planifiée (IA, relance automatique) | auteur de la planification | société | — | `fr` |
| Réponse IA | langue de l'utilisateur | langue détectée de la question | société | `fr` |
| Export CSV / Excel | locale de l'utilisateur (séparateur, décimale) | société | — | `fr-FR` |

## 4. Changement de langue

- Sélecteur dans le menu utilisateur et dans le profil ; effet immédiat, **sans rechargement** ni perte de saisie
  (les formulaires ouverts restent montés ; seuls les libellés changent).
- La préférence est enregistrée côté serveur (synchronisée entre appareils) et en cache local.
- Les données déjà chargées ne sont pas relues ; les libellés de référentiel le sont (clé de cache contenant la langue).

## 5. Périmètre par catégorie de texte

| Catégorie | Exemple | Traitement |
|---|---|---|
| Interface statique | boutons, menus, titres | catalogues front versionnés |
| Messages métier | refus `QG001` « compte manquant 411 » | clé + paramètres, rendu par le front |
| Référentiels système (globaux) | droits, rôles système, journaux, rubriques d'états, notes annexes | traductions globales livrées avec la version |
| Référentiels société | catégories, types de frais d'approche, catégories de pièces jointes, références RH | traduction facultative par société |
| Données métier traduisibles | désignation d'article, de service | traduction facultative (phase 2, selon besoin commercial) |
| Texte libre | libellé d'écriture, note, motif | jamais traduit |
| Documents émis | facture PDF | langue figée à l'émission |

## 6. Formats régionaux

| Locale | Date | Nombre | Montant | Séparateur CSV |
|---|---|---|---|---|
| fr-BF | 26/11/2026 | 1 250 300,50 | 1 250 301 FCFA | `;` |
| fr-FR | 26/11/2026 | 1 250 300,50 | 1 250 300,50 € | `;` |
| en-GB | 26/11/2026 | 1,250,300.50 | £1,250,300.50 | `,` |
| en-US | 11/26/2026 | 1,250,300.50 | $1,250,300.50 | `,` |

- La **devise d'un montant** vient de la donnée (société, pièce), jamais de la locale.
- Nombre de décimales selon la devise (ISO 4217 : XOF = 0).
- Fuseau horaire par société ; les dates comptables restent des dates (sans heure).
- Montant en lettres : par langue du document (fr, en) ; formule légale propre à chaque pays si nécessaire.

## 7. Documents

- Langue documentaire choisie à l'émission (proposée depuis le tiers), figée dans le contexte et le hachage.
- Un modèle par type de document et par langue (V141 : versionné) ; à défaut, modèle de la langue société.
- Réimpression = octets archivés (déjà le cas avec V141) : aucune retraduction.

## 8. Hors MVP

Langues supplémentaires (pt, es, ar, de, zh), RTL, traduction IA assistée, recherche multilingue, mobile.
L'architecture doit les permettre sans refonte.

## Note de consolidation — 26 novembre 2026, après-midi (C-02, C-05)

**Correction du tableau §6 (C-02).** Le tableau du matin comparait des devises différentes selon la locale ; c'est
faux : la devise vient de la pièce ou de la société, jamais de la locale. Même montant, même devise, quatre locales
(sortie réelle d'Intl, ICU 78) :

| Locale | 1 250 300 XOF | Date comptable 2026-01-01 | Décimale | CSV utilisateur |
|---|---|---|---|---|
| fr-BF | `1 250 300 XOF` | 01/01/2026 | `,` | `;` |
| fr-FR | `1 250 300 XOF` | 01/01/2026 | `,` | `;` |
| en-GB | `XOF 1,250,300` | 01/01/2026 | `.` | `,` |
| en-US | `XOF 1,250,300` | 01/01/2026 | `.` | `,` |

- Le code ISO est affiché plutôt que « F CFA » : le symbole vaut à la fois XOF et XAF.
- Décimales par devise (ISO 4217, XOF = 0) ; aucune valeur stockée, aucun taux, aucun arrondi n'est modifié par
  l'affichage.
- Une date sans heure s'affiche toujours au même jour (calcul en UTC), quel que soit le fuseau ; un horodatage
  s'affiche dans le fuseau de la société (IANA validé côté base et côté navigateur).
- CSV : le séparateur suit la locale **pour un fichier destiné à l'utilisateur** ; les formats d'échange machine
  (imports, API) restent stables. Les exports existants ne sont pas encore rebranchés (lot 1B).
- XLSX : cellules numériques et dates typées (inchangé, `src/lib/xlsx.ts`).
- Les 44 `"XOF"` codés en dur ne sont pas remplacés à l'aveugle : ceux du périmètre pilote lisent maintenant la
  devise de la société (`useTenantCurrency`) ou de la pièce (`CommercialTotals currency`).

**Société = tenant.** Le schéma n'a qu'une entité (`tenants`) et un utilisateur appartient à une seule société
(`profiles.tenant_id`, garde V24) : les préférences « tenant » et « société » sont donc les mêmes colonnes.

**Documents (C-05).** Langue proposée par le client, choisie avant émission, refus explicite (QG038, clé
`errors:documents.template_missing_language`) s'il n'existe pas de modèle publié dans cette langue — jamais de pièce
légale produite silencieusement dans une autre langue. Les documents internes non émis restent dynamiques.

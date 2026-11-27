# QERP — Backlog d'implémentation i18n (révisé après PoC)

Charges en jours-personne d'effort **humain** (développeur), marge ±30 %. L'assistance IA réduit le temps de saisie
mais ni la revue, ni la traduction professionnelle, ni la validation métier ; la durée calendaire dépend du
parallélisme et des validations du PO. Le PoC ne mesure pas un rendement humain (il a été mené avec assistance) ;
il mesure des **volumes réels** et retire du reste à faire ce qui est livré.

## 1. Reste à faire de la phase 1 (MVP fr / en)

| ID | Lot | Fichiers / objets | Dépend de | Priorité | Charge initiale | Fait au PoC | Reste | Critère d'acceptation |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Socle i18next | `src/i18n/*` | — | P0 | 2 j | oui | 0 | — |
| 1.2 | Formateurs centraux | `src/lib/locale-format.ts` + 160 fichiers | 1.1 | P0 | 4 j | module + pilote | 3 j | cliquet `"fr-FR"` à 0 hors zones autorisées |
| 1.3 | Préférences | V155, onglet, sélecteurs | — | P0 | 3 j | oui | 0 | — |
| 1.4 | Contrat d'erreur | `PublicErrorDetails`, `errors.ts`, Edge | — | P0 | 3 j | oui | 0 | — |
| 1.5 | Refus critiques MVP | fonctions SQL de la liste §3 (migrations jumelles) | 1.4 | P0 | 5 j | 2 sites existants + 11 nouveaux | 4,5 j | 100 % des sites de la liste fermée avec clé |
| 1.6 | Écrans MVP | ventes (transactions, devis, commandes, livraisons), AR, AP, achats, GL, trésorerie, stocks | 1.1, 1.2 | P0 | 18 j | coquille, accueil Ventes, réglages, éditeur de lignes, éditions | 15 j | fichiers ajoutés à `perimetre-pilote.js`, règle ESLint verte |
| 1.7 | Pièces émises | V141 / V143 : formatage par locale figé dans le contexte, montant en lettres EN, modèle BC anglais | 1.3 | P0 | 4 j | langue figée, refus sans modèle, rendu PDF/A EN | 2 j | facture et BC EN émis, réimpression octet pour octet |
| 1.8 | CI + parcours EN | `i18n:check` (fait), parcours connectés nuage + sur site en anglais | 1.6 | P0 | 4 j | contrôle CI, parcours bouchonné | 2 j | parcours EN verts nuage et sur site |
| 1.9 | Libellés mixtes | 27 libellés anglais dans l'interface française | 1.6 | P1 | 1 j | accueil Ventes corrigé | 1 j | aucun libellé anglais en `fr` |
| 1.10 | Budget premier écran | décision P-I18N-02, ou découpage | — | P1 | — | mesure faite | 0,5 j | budget validé par le PO et tenu en CI |
| 1.11 | Exports utilisateur | `csv-export.ts` : séparateur selon locale pour l'utilisateur | 1.2 | P2 | — | `userCsvSeparator` livré | 1 j | CSV en-US ouvert en colonnes |
| **Total phase 1** | | | | | **44 j** | | **≈ 29 j** | |

Plus traduction anglaise (≈ 20 j, prestataire) et relecture métier (≈ 5 j), inchangées.

## 2. Phase 2 (Commercial Stable) — 63 j, inchangée

Modules restants (12 j), messages base restants (22 j), messages Java propres (5 j), référentiels globaux JSONB
(4 j), référentiels société `*_translations` avec brouillon / publication (5 j), documents et notifications (6 j),
IA (1 j), LMC société (8 j). Nouveaux points issus du PoC : alertes `erp_alerts` et e-mails de relance avec clés
(inclus dans « documents et notifications »).

## 3. Liste fermée des refus critiques du MVP (dénominateur du lot 1.5)

| Code | Refus | Fonctions | Couverture au PoC |
|---|---|---|---|
| QG001 | compte de comptabilisation manquant | `on_ar_invoice_posted`, `require_posting_account`, posting AP / paiements / stocks / paie | 2 fonctions avec clé |
| QG003 | période fiscale fermée | `assert_fiscal_period_open` | 0 |
| QG005 | règlement refusé | `record_settlement`, `guard_payment`, `reverse_settlement` | 0 |
| QG009 | facture émise figée | `guard_ar_invoice_lifecycle` | 0 |
| QG010 | limite de crédit, devis expiré | `check_customer_credit_on_so`, `create_sales_order_from_quote` | 0 |
| QG007 / QG008 | préalables d'achat, rapprochement 3 voies | `procurement_submit`, `ap_invoice_submit` | 0 |
| QG038 | édition de document | `request_document_edition` et suivantes | 1 site avec clé (langue sans modèle) |
| QG039 | langues et formats | V155 | 10 sites sur 10 |
| 42501 | droit insuffisant | gardes et fonctions de droits | 0 (message générique traduit côté écran à prévoir) |

Le dénominateur exact (sites `RAISE` dans la **dernière** définition de chaque fonction) se mesure sur une base
reconstruite avec `pg_get_functiondef` ; il est volontairement fixé au début du lot 1.5, pas estimé ici.

## 4. Règle permanente

Toute nouvelle fonction SQL porte une clé `errors:*` pour ses refus destinés à l'utilisateur ; tout nouvel écran
entre directement dans `perimetre-pilote.js`. Les futurs modules (maintenance, production, arrêts, mobile en
aperçu) naissent traduisibles.

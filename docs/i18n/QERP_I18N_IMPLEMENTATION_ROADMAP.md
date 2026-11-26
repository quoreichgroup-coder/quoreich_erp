# QERP — Feuille de route i18n / l10n

Charges en jours-personne (j), estimées à partir des volumes mesurés dans l'audit ; marge ± 30 %.

## Hypothèses de charge

| Volume | Mesure | Rendement retenu | Charge |
|---|---|---|---|
| Chaînes front | ≈ 3 400 chaînes + 594 toasts + 896 attributs ≈ 4 900 | ≈ 200 extractions / j avec outil d'extraction et revue | ≈ 25 j |
| Formateurs | 271 `"fr-FR"` / 160 fichiers, 95 formateurs locaux | remplacement mécanique | ≈ 4 j |
| Messages base | ≈ 1 900 textes, 144 codes QG | essentiels : ≈ 150 messages / 5 j ; reste ≈ 80 / j | 5 j (P1) + 22 j (P2) |
| Messages Java | ≈ 718 chaînes | ≈ 150 / j | ≈ 5 j |
| Traduction anglaise | ≈ 7 500 segments ≈ 50 000 mots | ≈ 2 500 mots / j par traducteur professionnel | ≈ 20 j (prestation) |
| Relecture métier (comptable / RH) | glossaire + documents légaux | — | ≈ 5 j |

## Phase 0 — Audit et décisions (en cours)

- Livrables : les 10 documents de `docs/i18n/`. Fait le 26 nov. 2026.
- D-I18N-001 à 005 validées par le Product Owner le 26 nov. 2026 ; 006 à 010 restent à valider.
- **Go/No-Go** : D-I18N-001 à 005 validées → **Go phase 1 atteint** (démarrage sur décision explicite du PO).

## Phase 1 — Infrastructure et MVP fr / en (≈ 45 j + traduction)

| # | Lot | Dépend de | Priorité | Complexité | Charge |
|---|---|---|---|---|---|
| 1.1 | `src/i18n` (i18next, détection, repli, namespaces paresseux), `<html lang>` dynamique | D-002 | P0 | faible | 2 j |
| 1.2 | `locale-format.ts` + remplacement des 271 `"fr-FR"` et 95 formateurs | 1.1 | P0 | moyenne | 4 j |
| 1.3 | Migration préférences (`languages`, `tenants`, `profiles`) + écran profil + onglet « Langues et formats » | D-003 | P0 | faible | 3 j |
| 1.4 | Contrat d'erreur `{code, key, params, error}` (Java + client Supabase) | D-004 | P0 | moyenne | 3 j |
| 1.5 | Clés des 144 codes QG les plus fréquents | 1.4 | P0 | moyenne | 5 j |
| 1.6 | Extraction des écrans du périmètre MVP : shell, connexion, ventes, AR, achats, AP, GL, trésorerie, stocks | 1.1 | P0 | élevée (volume) | 18 j |
| 1.7 | Langue figée dans le contexte V141 + `montantEnLettres` en anglais | D-007 | P0 | moyenne | 4 j |
| 1.8 | Contrôles CI (clés, variables, littéraux, `"fr-FR"`) + parcours `108-langue-anglaise` | 1.1 | P0 | moyenne | 4 j |
| 1.9 | Corriger les 27 libellés restés en anglais dans l'interface française | 1.6 | P1 | faible | 1 j |
| 1.10 | Traduction anglaise du périmètre + relecture métier | 1.6 | P0 | — | prestation |

**Risques** : régression des parcours (atténuée par D-009), incohérences de formats (atténuée par 1.2 avant 1.6),
volume sous-estimé (mesure réelle après 1.6 sur un module pilote : Ventes).
**Go/No-Go** : critères « Phase 1 » de la stratégie de test ; parcours nuage et sur site verts.

## Phase 2 — Couverture commerciale (≈ 55 j)

- Modules restants (RH / paie, immobilisations, budget, projets, notes de frais, GRC, administration, CRM) : ≈ 12 j.
- Reste des messages base (≥ 95 %) : ≈ 22 j ; messages Java : 5 j.
- Référentiels globaux traduits (`label_i18n`) : catalogue des 143 droits, rôles, journaux, rubriques d'états, notes annexes : ≈ 4 j.
- Référentiels société traduisibles (`*_translations`) : ≈ 5 j.
- Langue documentaire des tiers, modèles par langue (V141/V143/V144), bulletin de paie, relances : ≈ 6 j.
- IA : langue de réponse paramétrée (edge functions + `AiAnalyses.java`) : 1 j.
- LMC société (édition, import / export, publication, revue à deux) : ≈ 8 j.
**Go/No-Go** : critères « Phase 2 » ; validation métier des documents légaux en anglais.

## Phase 3 — Enterprise (selon marché)

Langues supplémentaires (pt, es, ar…), RTL, assistant de traduction IA (validation humaine obligatoire,
jamais de publication automatique), glossaire, recherche multilingue, mobile. Charge à chiffrer selon le
marché visé ; condition préalable : une langue ajoutée sans code (critère « Phase 3 »).

## Règle immédiate, sans attendre la phase 1

Les nouveaux modules (EAM, maintenance, flotte, production) doivent **naître** avec clés de message et codes
stables, pour ne pas grossir la dette mesurée ici.

## Backlog avec critères d'acceptation (extrait phase 1)

| ID | Récit | Critère d'acceptation |
|---|---|---|
| I18N-01 | En tant qu'utilisateur, je choisis ma langue dans mon profil | La langue persiste après déconnexion et sur un autre navigateur ; aucune saisie en cours n'est perdue |
| I18N-02 | En tant qu'admin société, je fixe langue, locale et fuseau par défaut | Un nouvel utilisateur sans préférence voit la langue société |
| I18N-03 | Les montants respectent ma locale et la devise de la pièce | 1 250 300 XOF : « 1 250 300 FCFA » en fr-BF, « XOF 1,250,300 » en en-GB ; 0 décimale |
| I18N-04 | Un refus métier s'affiche dans ma langue | `QG001` en `en` affiche le texte anglais avec le compte en paramètre ; clé inconnue → texte français d'origine, sans erreur |
| I18N-05 | Une facture émise garde sa langue | Facture émise en `en`, utilisateur repassé en `fr` : la réimpression est identique (SHA-256 inchangé) |
| I18N-06 | Un export CSV suit ma locale | `en-US` : séparateur `,`, point décimal ; `fr-*` : `;`, virgule |
| I18N-07 | Le CI refuse un texte en dur | Un littéral visible ajouté dans un composant modifié fait échouer `npm run lint` |

## Note de consolidation — 26 novembre 2026, après-midi (C-07) — charges réconciliées

| Bloc | Charge humaine | Remarque |
|---|---|---|
| Phase 1, lots 1.1 à 1.9 | **44 j** | hors traduction (2 + 4 + 3 + 3 + 5 + 18 + 4 + 4 + 1) |
| Phase 2 | **63 j** | 12 + 22 + 5 + 4 + 5 + 6 + 1 + 8 (le « ≈ 55 j » du matin était une erreur d'addition) |
| Traduction anglaise | 20 j | prestataire |
| Relecture métier | 5 j | comptable / RH |
| **Total indicatif** | **132 j** | si cumulatif sans recouvrement, marge ±30 % |

- **Trois mesures distinctes** : effort humain (ci-dessus), part assistée par IA (extraction et premier jet de
  traduction ; n'enlève ni la relecture ni la validation métier), durée calendaire (dépend du parallélisme et des
  validations PO). Recalibrage après PoC : voir `QERP_I18N_IMPLEMENTATION_BACKLOG.md`.
- **Critère remplacé** : « 144 codes QG avec clé » est supprimé (mesure erronée, voir l'audit). Nouveaux critères :
  phase 1 = **100 % des refus critiques du MVP** avec clé (liste fermée dans le backlog, dénominateur vérifié) ;
  phase 2 = **≥ 95 % des sites `RAISE` applicables** des fonctions en vigueur, exceptions documentées.
- **Dépendances documentaires** : stockage langue / locale figées (fait, V155) → modèle anglais publié par la
  société → langue documentaire du tiers. Au MVP, les trois sont nécessaires pour émettre une facture anglaise ;
  le formatage par locale des montants dans la pièce et le montant en lettres anglais restent à livrer (lot 1B).
- Aucun module vendu comme bilingue ne reste partiellement traduit sans l'avertissement explicite des écrans.

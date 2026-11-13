# QUOREICH — Procès-verbal de recette du Lot 2

Date : 13 novembre 2026. Statut : **critère de sortie AR-REC atteint et parité démontrée ; réception métier sous réserve de l'application des migrations en production**.

## Objet du lot

Le Lot 2 est la première tranche verticale de la bascule vers l'API Java (`docs/PLAN-BASCULE-JAVA.md`, § Lot 2) : les comptes clients (AR), de bout en bout — identité, société, contrat d'API, écran, export, recette.

Critère de sortie (cahier des charges, **AR-REC**) : *facture valide → créance et écriture équilibrée ; paiement partiel → solde exact ; paiement final → soldé ; facture invalide ou période close → refus sans effet ; export conforme aux droits.* Le plan y ajoute : *parité démontrée avec l'implémentation SQL existante.*

## Méthode

Trois niveaux de preuve, aucun ne s'appuyant sur des données inventées dans la base de production :

1. **Tests d'intégration Java** contre un vrai PostgreSQL 18.6 (Testcontainers) : les 157 politiques RLS, les déclencheurs et les fonctions de production sont exécutés tels quels. Les requêtes passent par l'API HTTP, avec des jetons dont seul l'émetteur est simulé, ou directement sous le rôle applicatif `qerp_api` avec la session du porteur.
2. **Recette sur la copie des données réelles** (`qerp_reel`, restaurée du dump du 9 novembre 2026 et conservée hors du dépôt). Le scénario est joué sous `qerp_api`, avec la session d'un vrai administrateur de société, en reprenant exactement les requêtes de l'API. Il tourne dans une transaction **annulée** : la copie n'est pas modifiée et la production n'est jamais touchée.
3. **Tests du front** (Vitest) et **tests de bout en bout** (Playwright, backend simulé).

Aucun secret, identifiant de compte ni nom de société n'apparaît dans ce rapport.

## AR-REC : résultats

| Critère | Tests d'intégration | Copie des données réelles (13 nov.) |
|---|---|---|
| Facture valide → créance et écriture équilibrée | `ArInvoiceIT`, `InvoiceLinesApiIT`, `LignesFactureIT` | Facture à 2 lignes, TVA 18 % : HT 720 000 + TVA 129 600 = **TTC 849 600** ; numéro définitif **INV-2026-0001** attribué à l'émission ; écriture **4110 D 849 600 / 4000 C 720 000 / 4310 C 129 600**, équilibrée |
| Paiement partiel → solde exact | `ArInvoiceIT`, `ArParityIT` | 300 000 encaissés : reste **549 600**, statut `partially_paid` ; une seule écriture d'encaissement, équilibrée |
| Paiement final → soldé | `ArInvoiceIT`, `ArParityIT` | Solde encaissé : **849 600 / 849 600**, reste 0, statut `paid` |
| Facture invalide → refus sans effet | `ArInvoiceIT` (surpaiement), `ParametrageComptableIT` (plan incomplet, `QG001`), `AxesAnalytiquesIT` (analytique obligatoire, `QG002`), `InvoiceLinesApiIT` (code TVA inactif, quantité nulle) | Surpaiement refusé (« amount_paid > total ») ; ensuite, payé toujours 300 000 et un seul encaissement |
| Période close → refus sans effet | `ArInvoiceIT`, `ArParityIT`, `NumerotationFacturesIT` (aucun numéro consommé) | Refus « GL period 2020-01 is closed », sur le chemin de l'API (brouillon puis émission) comme sur le chemin direct de l'écran ; nombre de factures émises et d'écritures inchangé |
| Export conforme aux droits | `ArInvoiceIT` (CSV limité à la société du porteur ; lecteur ou rôle d'une autre société → 403) | Un lecteur voit les factures sans droit d'écrire ; une autre société ne voit ni la facture ni ses encaissements, et sa tentative d'encaissement est refusée par la RLS |
| Parité avec le chemin SQL historique | `ArParityIT` : même état et mêmes écritures pour facture, paiement partiel et paiement final ; une écriture par encaissement ; mêmes refus. **Un seul écart, voulu** : le chemin historique laissait un lecteur facturer, l'API le refuse | — |

## Ce que le lot a livré

Migrations `V16` à `V32` (écrites à la main, chacune avec sa jumelle dans `supabase/migrations/`), API, écrans et tests :

- **Comptabilisation** : déclencheurs en double supprimés (V16 ; l'AR était comptabilisé trois fois), outil de correction des doublons historiques (`scripts/data/doublons-declencheurs/`, à blanc par défaut), refus de comptabiliser quand le plan comptable est incomplet (V17).
- **Paramétrage comptable** sans compte codé en dur : rôles de comptabilisation par société, référentiel SYSCOHADA révisé (V18), écran « Paramétrage comptable ».
- **Analytique** : axes séparés du plan de comptes, règles obligatoire/interdit par préfixe, défauts par client, imputation sur facture et écriture manuelle (V19, V20).
- **Factures** : lignes et codes TVA (V21), numérotation unique, continue et attribuée à l'émission (V22).
- **Autorisations** : un seul modèle de rôles, limité à la société (V23) ; matrice éditable dans `/settings` avec journal (V25, V26, V28) ; écrans qui lisent leurs droits dans la base (V27) ; rôles des modules écrits dans la matrice (V31) ; fin de la table de transition `user_roles` (V32).
- **Tests de bout en bout** : Playwright installé et suite verte (23 réussis).

## Défauts trouvés et corrigés pendant le lot

Plusieurs défauts existaient en production avant ce lot et n'apparaissaient qu'en jouant les écrans ou les fonctions comme un utilisateur :

| Défaut (production) | Correction |
|---|---|
| Chaque encaissement AR et chaque paiement AP comptabilisés **trois fois** ; réceptions de stock doublées | V16, script de correction des doublons |
| Un utilisateur pouvait **rattacher son profil à une autre société** et lire ses données | V24 |
| `join_tenant` : en tapant le nom d'une société, **n'importe qui y entrait** et lisait clients et factures (reproduit) | V31 : invitation à usage unique |
| Trois politiques laissaient lire ou écrire **d'une société à l'autre** (rôles, journaux de rôles) | V27 |
| **Aucun devis, commande client ni bon de livraison** ne pouvait être créé depuis le 26 juin 2026 ; aucune demande ou commande d'achat ne pouvait être soumise à approbation | V30 |
| 11 des 12 écrans de rôles par module **échouaient ou n'attribuaient rien** ; 9 ne vérifiaient pas la société de l'utilisateur ciblé | V31 |
| Conversion d'opportunité refusée à l'administrateur alors que le bouton était actif | V29 |
| Page `/alerts` blanche ; annulation d'export inopérante ; échecs PDF silencieux | Front (`a4095e9`, `b1b965d`) |

## Contrôles automatiques au 13 novembre 2026

| Contrôle | Résultat |
|---|---|
| `./mvnw verify` (API Java) | 103 tests : 11 unitaires, 92 d'intégration — tous réussis |
| `npm test` | 58 fichiers, 422 tests — tous réussis |
| `npm run test:e2e` | 23 réussis, 17 ignorés (specs connectées sans identifiants), 0 échec |
| `npm run lint` | 0 erreur |
| `tsc` (application et configuration) | 0 erreur |
| `npm run api:check`, `npm run build` | Conformes |

Les tests Java des V29, V30 et V31 ont aussi été joués **sans** la migration correspondante : ils échouent alors avec les erreurs exactes de la production. Ils détectent donc bien le défaut qu'ils protègent.

## Réserves

1. **Production : migrations à appliquer et à vérifier.** Les migrations V16 à V32 sont poussées sur `main` ; leur application par Lovable sur Supabase et le résultat de la CI GitHub restent à confirmer. V24 et V31 ferment des failles d'isolation entre sociétés : ce sont les plus urgentes. La recette ci-dessus porte sur la copie du 9 novembre, pas sur la production.
2. **Recette au navigateur par le métier.** Les écrans livrés (factures à lignes, codes TVA, paramétrage comptable, analytique, rôles et autorisations, invitations, onboarding par code) ont été vérifiés par les tests, pas encore par un utilisateur en conditions réelles.
3. **Doublons historiques non corrigés en production.** Le script `scripts/data/doublons-declencheurs/corriger.psql` doit être joué à blanc, relu, puis appliqué. Les doublons de stock et d'audit sont seulement signalés.
4. **Référentiel SYSCOHADA non validé** (`is_validated = false`) : revue par un expert-comptable local requise (cahier des charges § 138). Le choix d'une société de comptabiliser ses ventes en 4000 plutôt qu'en 7000 est une décision comptable laissée à cette société.
5. **Factures historiques sans écriture.** Sur la copie, 3 des 4 factures émises n'ont pas d'écriture comptable (créées avant la comptabilisation automatique ou à travers un ancien défaut). Leur reprise relève d'une décision comptable.
6. **Traçabilité des encaissements.** L'écriture d'un encaissement existe et elle est équilibrée, mais `payments.journal_entry_id` n'est pas renseigné : le lien passe par la source `ar_receipt`. Amélioration à prévoir.
7. **Robustesse de la comptabilisation AR.** Le débit reprend le `total` de la facture tel qu'il est fourni. Un total absent ou incohérent est refusé (écriture déséquilibrée, donc aucun effet), mais le calcul devrait partir du HT et de la TVA. Durcissement à prévoir.
8. **Hors périmètre du Lot 2.** Avoirs, lettrage, ajustements et passages en perte (AR-06) ; comptabilisation AP et stocks qui s'ignore encore en silence (Lots 3 et 4) ; fournisseur d'identité Keycloak (l'API valide aujourd'hui les jetons Supabase) ; réserves bancaires du Lot 1, toujours ouvertes.
9. **Types générés.** `src/integrations/supabase/types.ts` mentionne encore `user_roles` tant que Lovable ne l'a pas régénéré ; aucun code de `src/` ne le lit.

## Décision de sortie

Le critère de sortie **AR-REC** est atteint et la parité avec le chemin SQL est démontrée. **Le Lot 2 est clos sur le plan technique.** Sa réception métier sera prononcée après les vérifications de la réserve 1 (migrations appliquées, CI verte) et de la réserve 2 (recette au navigateur par un utilisateur autorisé). Les réserves 3 à 9 ne bloquent pas le Lot 3 ; elles sont reportées à la feuille de route.

## Traces

- Tests : `services/api/src/test/java/com/quoreich/qerp/` (`ArInvoiceIT`, `ArParityIT`, `InvoiceLinesApiIT`, `LignesFactureIT`, `NumerotationFacturesIT`, `ParametrageComptableIT`, `AxesAnalytiquesIT`, `AuthorizationsApiIT`, `SocieteDuProfilIT`, `RolesDesModulesIT`, `VentesAchatsDeclencheursIT`, `SchemaMigrationIT`, `TenantIsolationIT`) ; `src/**/__tests__/` ; `tests/e2e/`.
- Commits du lot : `12b50d1` à `c5be276` sur `main`.
- Les scripts de recette sur la copie réelle sont des fichiers de travail temporaires ; ce procès-verbal en consigne les résultats.

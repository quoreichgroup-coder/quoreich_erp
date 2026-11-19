# 27 — Balayage « 360 » : données de démonstration, valeurs codées en dur, commandes sans effet

État au 19 novembre 2026, à la demande du propriétaire (« pas de partie codée en dur »). Migration V119.

## 1. Méthode

| Volet | Contrôle | Outil |
|---|---|---|
| Écrans | chaque route de `App.tsx` : accès aux données (hooks, API, Supabase) contre valeurs littérales ; tableaux d'objets écrits dans le code, y compris dans le JSX (`{[ … ].map(`) ; marqueurs (années fixes, noms inventés, `Math.random`, « FY 20xx ») | scripts Python sur `src/pages`, `src/components` |
| Commandes | `<select>` sans `onChange` / `value`, boutons sans action, champs sans état, liens `href="#"` | script `scan_noop` (0 restant) |
| Règles | taux et coefficients dans le code du front (TVA, retenues) | recherche ciblée (aucun) |
| Base | fonctions PL/pgSQL contenant des numéros de compte, des taux, des montants ou des identifiants fixes ; valeurs pré-remplies à la création d'une société | catalogue `pg_proc` |
| Fonctionnement | parcours métier nuage et sur site, tests Java, Vitest | suites existantes |

## 2. Constats et corrections

| # | Écran / objet | Constat | Correction |
|---|---|---|---|
| 1 | Tableau de bord `/` | entités « QUOREICH CI / SN » et montants inventés, 5 alertes inventées, « Risk Score 72/100 » fixe, « Fiscal Year 2025–2026 · février 2026 » fixe, courbe N-1 toujours à 0, flèches de tendance décoratives, bloc « AI Insights » de démonstration | sociétés accessibles et leurs indicateurs consolidés réels, alertes ouvertes de la base, exercice du calendrier, N-1 calculé sur les règlements réels, bloc de démonstration supprimé |
| 2 | Paramètres `/settings` — Plan comptable, Conditions de paiement, Circuits (« Workflow Engine »), Audit | listes de démonstration (comptes, conditions, 4 règles de circuit, simulation, délégations, journal d'audit avec des noms inventés) ; l'entrée de menu « Audit et journaux » y menait | plan comptable → écrans réels de la comptabilité ; conditions de paiement → éditeur réel (`ar_payment_terms`) ; circuits → niveaux réels de chaque module et règles enregistrées ; audit → journaux réels (grand livre, autorisations, calendrier, trésorerie, achats, RH, conformité) |
| 3 | Centre de rapports `/reports` (menu) | bilan, compte de résultat, analytique, rapports enregistrés et planifiés de démonstration | point d'entrée vers les 17 rapports réels des modules (dont les états SYSCOHADA par rubriques) |
| 4 | `/invoices` | clients « Acme Corp »… inventés | redirige vers les factures clients réelles ; page supprimée |
| 5 | Comptes clients, fournisseurs, journal, rapports clients | « FY 2025-2026 », « P11 – Février 2026 », période 2026 par défaut ; filtres affichés sans effet | exercice lu dans le calendrier (`FiscalYearLabel`) ; période par défaut = exercice en cours ; filtres factices retirés |
| 6 | Contrôle de trésorerie | indicateurs « 2/3 », « 3 », « 0 » écrits dans le code | calculés : comptes entièrement rapprochés, mouvements non rapprochés, limites dépassées (V107) |
| 7 | Paramètres de trésorerie | onglets « Bank Integration » (banques et synchronisations inventées), « Alerts », « FX Policy », « Controls » jamais enregistrés | onglet réel « Rapprochement et alertes » (tolérances, fenêtre de dates, alerte de non-rapprochement, seuil global, continuité des relevés : `treasury_settings`) ; les onglets fictifs sont supprimés |
| 8 | Rapports clients (constructeur) | aperçu tronqué à 100 lignes, tranche d'âge toujours « — », filtres Devise / Tranche sans effet, boutons Aperçu / PDF / Excel / Imprimer / Nouveau modèle / Planifier sans action | toutes les lignes, tranche calculée, filtres réels, exports réels des colonnes choisies, « Nouveau modèle » ouvre le constructeur ; la planification (non gérée par la base) est retirée |
| 9 | Autres commandes sans effet | « Voir toutes les factures », « Gérer les limites », « Voir le rapport d'antériorité », « Export » (performance fournisseurs), « Refresh » / « Export » (modules), « Import Journal », « Edit / Add Alert Rule / Reverse / Audit » d'un panneau inutilisé | reliées à l'écran ou à l'export réel ; « Import Journal » (aucun import d'écritures) et le panneau inutilisé sont supprimés |
| 10 | Composants `KpiCards`, `AiInsights` | démonstrations en anglais | supprimés (plus utilisés) |
| 11 | `seed_ap_defaults` (base) | taux de retenue 7,5 / 15 / 20 / 10 % sur des comptes 4471 à 4474 pré-remplis ; insertions sans protection contre les doublons alors que la fonction est appelée à chaque modification des paramètres fournisseurs : **3 652 lignes pour 4 taux** sur la société de test du nuage (744 sur site), aucune société réelle touchée | V119 : plus aucune retenue pré-remplie ; doublons supprimés et rendus impossibles (index uniques) ; un seul niveau d'approbation proposé |
| 12 | `seed_ar_defaults` (base) | frais de relance 15 000 / 50 000 / 150 000 XOF fixés ; libellés anglais | V119 : niveaux et délais proposés sans frais ; libellés français |

## 3. Ce qui reste, en connaissance de cause

- **Valeurs proposées par défaut, modifiables par la société** (pas des règles imposées) : niveaux d'approbation des achats
  à la création d'une société (`seed_procurement_defaults`), coefficients dégressifs 1,5 / 2 / 2,5 et taux patronal 16,4 %
  (valeurs initiales de paramètres documentés, modifiables avec le droit correspondant). À faire valider par l'expert-comptable.
- **Fonctions absentes, désormais non simulées** : connexion bancaire directe (les relevés s'importent par fichier),
  politique de change et réévaluation (lot achats internationaux), rapports planifiés par e-mail (avec la messagerie).
- **Libellés anglais** : traduits le 19 nov. 2026 (environ 390 libellés dans 70 fichiers, un dictionnaire unique appliqué
  aux écrans et aux sélecteurs des tests ; composants de base : « Fermer la fenêtre », pagination). Restent des mots
  identiques dans les deux langues (« Transactions », « Contact », « Pipeline », « Export CSV »).
- Les comptes 4471 à 4474 déjà créés sur la société de test restent (données de la société).

## 4. Vérification

Vitest 613 / 613, contrôle de types, lint sans erreur ; tests Java concernés (`ParametresParDefautIT`, `SchemaMigrationIT`,
`CycleDeVieFacturesFournisseursIT`, `PayableApiIT`, `ParametresProtegesIT`) ; parcours sur site et nuage, dont le
parcours 102 qui vérifie l'absence des entités et du score inventés et la présence des écrans réels.

## 5. Défauts trouvés pendant la traduction

- Rapports clients : le filtre de statut comparait le libellé affiché (« Ouvert ») au statut enregistré (`sent`,
  `partially_paid`) : choisir un statut vidait toujours la liste. Valeurs explicites et filtre « ouvert / échu » calculé.
- Nouveau risque : le code proposé était calculé à l'ouverture de la fenêtre ; ouverte avant le chargement de la liste,
  elle proposait « R-001 », déjà pris, et l'enregistrement échouait. Recalculé quand la liste arrive.
- Export consolidé CFO : les colonnes s'appellent « Encaissements clients », « Décaissements fournisseurs », « Flux de
  trésorerie net », « Solde de trésorerie » (ce sont des flux de trésorerie, pas un chiffre d'affaires comptable).


# QUOREICH — Procès-verbal de recette du Lot 1

Date : 6 novembre 2026, 22:24 UTC. Statut : **recette technique effectuée, réception métier avec réserves**. Lot 2 non démarré.

## Périmètre et méthode

Contrôles sur l’application locale reliée à Lovable Cloud, avec une session autorisée réelle, sans création de données fictives et sans modification des données métier. Vérifications des pages `/treasury/reporting`, `/sales/reporting` et `/cockpit/consolidated`, des téléchargements CSV et des réponses serveur. Captures visuellement contrôlées. Aucun secret ni identifiant de compte utilisateur n’est inclus dans ce rapport.

## Corrections réalisées

- Marge : « Coût non renseigné » et aucune marge calculée sans sorties de stock valorisées ; disparition du 100 % par défaut.
- Transactions bancaires : lecture paginée exhaustive, tri stable date/identifiant et filtre explicite de société. Les agrégations et exports ne se limitent plus aux 200 dernières transactions.
- Cache des comptes et transactions : séparation explicite par société.
- CFO : agrégation des tendances côté serveur, intersection des sociétés demandées avec les sociétés accessibles, contrôle de session et périodes 3/6/12 mois seulement.
- Solde passé : relevé importé couvrant le mois complet et arrêté exactement à sa clôture, pour chaque compte XOF actif éligible. En l’absence de justificatifs complets, valeur inconnue, jamais copie du solde courant. Le mois courant utilise le solde actuel des comptes XOF actifs.
- Graphique : absence de courbe de trésorerie sur les mois inconnus et avertissement visible. CSV principal et dédié : « Non renseigné » pour ces valeurs.
- Exports trésorerie indisponibles pendant un chargement ou après une erreur.

## Résultats vérifiés

| Contrôle | Résultat | Preuve / limite |
|---|---|---|
| Connexion et chargement trésorerie | Réussi | Requête réelle HTTP 200, page affichée sous session autorisée |
| Position bancaire vide | Réussi | Aucun compte enregistré ; total de liste vide à 0 XOF, message explicite, export position désactivé |
| Export flux trésorerie | Réussi | Fichier CSV téléchargé, six mois et six nets à zéro en l’absence de transactions |
| Marge sans coût réel | Réussi | « Coût non renseigné » affiché dans le reporting ventes, montant et pourcentage non calculés |
| Chargement CFO | Réussi | Indicateurs réels chargés ; aucune erreur d’exécution navigateur relevée |
| Export principal CFO 3 mois | Réussi | Trois points mensuels, périmètre sélectionné conservé, historique « Non renseigné » |
| Export principal CFO 6 mois | Réussi | Six points mensuels, même contrôle |
| Export principal CFO 12 mois | Réussi | Douze points mensuels, même contrôle |
| Soldes historiques sans relevé | Réussi | Réponses serveur : respectivement 3, 6 et 12 valeurs NULL, et non des zéros inventés |
| Société existante inaccessible | Réussi sur le contrôle d’accès | Ajouter son identifiant ne change pas la réponse de tendances ; demander cette société seule renvoie une liste vide pour les trois périodes |
| Lectures bancaires d’une société inaccessible | Réussi sur le périmètre demandé | Comptes et transactions renvoient une liste vide ; les tables étant vides, ce contrôle ne démontre pas l’exclusion de lignes réelles non nulles |
| Période invalide de 4 mois | Réussi | Rejet serveur HTTP 400 |
| Modal CFO au clavier | Réussi | Ouverture Entrée/Espace, rôle modal et description, Tab/Maj+Tab confinés, Échap et retour du focus |
| Sélection CFO vide | Réussi | Message visible et export principal désactivé |
| Tests ciblés | Réussi | 34/34 : sincérité 11, reporting 7, CFO 4, accessibilité et CSV 12 |
| Contrôles automatiques de compilation | Réussi | Dernier signal : build OK à 22:22:59 UTC |

Les tests de calcul utilisent des jeux unitaires isolés, jamais injectés dans l’application ou la base. Le test de lecture paginée vérifie concrètement 501 transactions reçues en deux pages, avec filtre de société sur chacune.

## Réserves et écarts restant à lever

1. **Montants bancaires non nuls, position exportée et historique chiffré : non réceptionnés.** La base contient zéro compte bancaire, zéro transaction et zéro relevé. Il faut des données métier autorisées de recette (comptes, mouvements et relevés de clôture) pour comparer les affichages et exports aux montants attendus sur 3/6/12 mois. Aucun montant n’a été inventé pour contourner cette absence.
2. **Isolation de lignes bancaires entre deux sociétés alimentées : non réceptionnée.** Le filtrage serveur d’une société existante inaccessible a été vérifié, mais les données vides ne permettent pas de prouver la séparation de deux ensembles de mouvements réels. Dépendance : jeux bancaires autorisés dans deux sociétés et comptes de recette appropriés.
3. **Historique importé, pas certification bancaire.** Un relevé importé est une source stockée, pas une preuve de validation ou de rapprochement définitif. Le modèle actuel ne fournit pas de date d’ouverture métier ni de période d’activation des comptes : l’éligibilité historique utilise la date de création et l’état actif actuel. Une reconstruction exhaustive des comptes fermés ou importés tardivement nécessiterait une décision métier et des données supplémentaires.
4. **Libellés CFO Revenue / Expenses / Net Profit : base encaissements-décaissements.** Les tendances restent fondées sur `payments` AR/AP ; elles ne constituent pas un compte de résultat en comptabilité d’engagement. Ne pas présenter cette différence comme un bénéfice comptable certifié.
5. **Multi-devise : pas de conversion.** La courbe cash est explicitement limitée aux comptes XOF actifs. Les tendances de paiements et les totaux consolidés de sociétés de devises différentes nécessitent une politique de conversion validée ; aucune conversion fictive n’est ajoutée.
6. **Autres pages trésorerie hors périmètre de cette recette.** Une inspection révèle encore des valeurs statiques dans `TreasuryControl.tsx` (rapprochements et journal d’activité) ; leur utilisation effective et leur remplacement doivent être audités séparément. Ce rapport ne certifie pas l’ensemble du module trésorerie.

## Décision de sortie

La correction de marge et les régressions techniques sont vérifiées. La recette connectée a été effectuée dans l’état réel disponible et documentée ; **le Lot 1 ne bénéficie pas d’une réception métier sans réserve**. Le Lot 2 reste non engagé jusqu’à la levée des réserves de données ou à leur acceptation explicite.

## Traces de vérification

- Tests conservés : `src/lib/__tests__/lot1-sincerity.test.ts`, `src/hooks/__tests__/lot1-reporting.test.tsx`, `src/hooks/__tests__/use-consolidated-cfo.test.tsx`, `src/components/__tests__/KpiDrilldownDialog.a11y.test.tsx`.
- Régression connectée conservée : `tests/e2e/cfo-consolidated-live.py`.
- Captures, CSV et résultats complémentaires temporaires : `/tmp/browser/lot1/` et `/tmp/browser/cfo-live/`. Ces traces sont temporaires et ne remplacent pas le présent procès-verbal.
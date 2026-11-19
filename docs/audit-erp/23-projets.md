# 23 — Projets (lot 4, module 2 : V111)

19 novembre 2026.

## 1. Constat avant le lot

- **Données** : une table de projets et une table de « coûts » saisis à la main, jamais comptabilisés.
  Aucun projet n'existait.
- **Accès** : politiques `FOR ALL` ouvertes à tout membre.
- **Écrans** : de démonstration (catégories de coûts, règles d'imputation et indicateurs écrits en
  dur).

## 2. Références

- **SAP PS** : le projet (élément d'OTP) porte budget, engagements et coûts réels, ces derniers issus
  des imputations des pièces (commandes, factures, notes de frais, écritures).
- **Sage X3** : les affaires. Une section analytique dédiée par affaire, avec budget, réalisé par
  nature, engagé et marge.
- **SYSCOHADA** : comptabilité analytique de gestion, facultative et propre à l'entreprise. Le projet
  y est une section ; il n'a pas de compte général propre.

## 3. Conception retenue

Un projet est une **valeur de l'axe analytique « projets »**, choisi par la société dans les
paramètres. La valeur est créée en même temps que le projet, avec son code, et suit son intitulé et
ses dates.

Les pièces qui portent déjà une section s'imputent donc au projet sans table de coûts parallèle :

- demandes et commandes d'achat (en-tête ou ligne) ;
- factures fournisseurs et clients ;
- écritures manuelles ;
- budgets par section ;
- notes de frais, ligne par ligne (nouveau).

Les chiffres se lisent dans la comptabilité :

- **Réalisé** (`project_financials`, `project_ledger`) : écritures comptabilisées portant la section
  ou une de ses sous-sections. Charges = débit − crédit sur les comptes de charges ; produits =
  crédit − débit sur les comptes de produits.
- **Engagé** : commandes approuvées non encore reçues, pour leur part imputée au projet, et si le
  paramètre est coché, les demandes approuvées non converties.
- **Budget** : par compte, sur toute la durée du projet ; un compte couvre ses sous-comptes ; charges
  et produits.

Cycle de vie (`project_set_status`, avec motif) :

- prévu → actif → suspendu / clôturé → rouvert ;
- annulé seulement s'il n'y a eu aucune imputation ;
- un projet clôturé désactive sa section, qui n'accepte alors plus d'imputation, et gèle son budget.

Gardes et droits :

- le code et la section sont figés ;
- le statut ne change que par la fonction ;
- un projet démarré ou imputé ne se supprime pas ;
- l'ancienne saisie libre des coûts (`project_costs`) est en lecture seule ;
- droits `projects.manage`, `budget`, `close`, `settings`, `export` (catalogue 122).

## 4. Écrans

- **Tableau de bord** : portefeuille en cours, consommé contre budget, marge réalisée.
- **Transactions** (par projet) :
  - chiffres : budget, réalisé, engagé, disponible, produits, marge ;
  - budget par compte, modifiable ;
  - grand livre du projet ;
  - situation imprimable (PDF / Excel) ;
  - démarrer, suspendre, clôturer, rouvrir.
- **Données de base** : fiches projet.
- **Rapports** : tous les projets, exportables.
- **Contrôle** :
  - dépassements ;
  - seuil d'alerte, tiré du paramètre du contrôle budgétaire de la société ;
  - échéances dépassées ;
  - projets sans budget.
- **Paramètres** : axe des projets, engagé des demandes, rôles.

## 5. Restes

- **Temps passés** (feuilles de temps valorisées au coût horaire) : à faire, avec des taux par
  salarié ou par fonction à paramétrer.
- **Facturation à l'avancement ou par jalons** : à faire. Aujourd'hui, une facture client portant la
  section du projet alimente ses produits.
- **Sur site** : pas encore d'API Java pour ce module.

## 6. Vérification

- `ProjetsIT` : section créée, budget, réalisé (charges et produits), engagé, grand livre, cycle,
  gardes, droits.
- Parcours **100** :
  - axe des projets, projet et budget ;
  - note de frais imputée au projet, avec barème kilométrique, hôtel en euros et avance imputée ;
  - le projet montre la dépense.
- Java, Vitest et l'ensemble des parcours (nuage et sur site) sont verts.

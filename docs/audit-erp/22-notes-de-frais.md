# 22 — Notes de frais (lot 4, module 1 : V109–V110)

19 novembre 2026.

## 1. Constat avant le lot

- **Données** : deux tables sans règle (en-tête, lignes) et aucune note enregistrée.
- **Accès** : politiques `FOR ALL` ouvertes à tout membre, lecteur compris.
- **Salarié** : la note pointait vers un compte utilisateur, pas vers une fiche du personnel.
- **Logique** : ni calcul, ni écriture, ni approbation.
- **Écrans** : les six affichaient des données de démonstration (catégories, barèmes de per diem,
  seuils, indicateurs).

## 2. Références

- **SAP Concur / SAP Travel Management** : note → approbation hiérarchique → comptabilisation →
  remboursement ; catégories (types de frais) avec compte de charge, plafonds et justificatifs.
- **Sage X3** : notes de frais, natures de frais, contrôle des plafonds, intégration comptable.
- **OHADA** :
  - pièce justificative (AUDCIF art. 19) ;
  - TVA récupérable seulement sur justificatif conforme, d'où son calcul ligne par ligne à partir du
    code TVA ;
  - compte du personnel en classe 42.

## 3. Ce qui est livré

### Données et paramètres

- **Catégories de frais**, par société, sans aucune pré-remplie : compte de charge imputable (V110),
  code TVA par défaut, seuil du justificatif, plafond par dépense, active ou non.
- **Règles générales** : seuil du justificatif, plafond par note, délai de soumission. Un champ vide
  désactive la règle.
- **Niveaux d'approbation** : plafond, approbateur, délai cible (même éditeur que les achats et les
  fournisseurs).
- **Rôle de comptabilisation** `EXPENSE_PAYABLE` : « Personnel, notes de frais à rembourser ». Le
  compte proposé est celui des rémunérations dues du référentiel (422 SYSCOHADA, modifiable).
- **Droits du catalogue** (117 codes au total) : `expenses.submit`, `manage`, `view_all`,
  `approve_l1` à `approve_l3`, `post`, `pay`, `settings`, `export`.

### Cycle de vie (fonctions de la base)

1. **Brouillon** : numéro provisoire `BROUILLON-…`. Les montants sont saisis TTC ; la TVA
   récupérable (TTC × taux / (100 + taux)) et le HT sont calculés par la base.
2. **Soumission** (`expense_report_submit`) :
   - contrôle de la catégorie, du justificatif, des plafonds et du délai ;
   - numéro légal `NDF-AAAA-####`, sans trou ;
   - file d'approbation construite à partir des seuils.
3. **Approbation** (`expense_report_decide`) : niveau par niveau. Jamais par l'auteur, jamais deux
   niveaux par la même personne. Le rejet exige un motif ; la note rejetée redevient modifiable et se
   soumet de nouveau.
4. **Comptabilisation** (`expense_report_post`, droit `expenses.post`), sur une période ouverte,
   journal OD :
   - débit du compte de la catégorie (HT) ;
   - débit de la TVA par le compte du code TVA, sinon le rôle de TVA récupérable ;
   - crédit du compte « à rembourser ».
5. **Remboursement** (`expense_report_pay`, droit `expenses.pay`), journal BQ : débit « à
   rembourser », crédit du compte de trésorerie choisi ; le mouvement de trésorerie est créé.
6. **Annulation** motivée, possible avant l'approbation.

### Gardes et confidentialité

- **Création** : en brouillon seulement.
- **Statut, numéro, montants et écritures** : modifiés uniquement par les fonctions.
- **Lignes** : figées dès la soumission.
- **Visibilité** : chacun ne voit que ses notes ; le droit `expenses.view_all` donne celles de la
  société.

### Écrans

- **Tableau de bord** : notes par étape, dépenses de l'année par catégorie.
- **Transactions** :
  - onglets Notes / À approuver / Comptabilisation ;
  - saisie par lignes avec un aperçu des règles identique au refus de la base ;
  - vue de la note avec ses approbations, impression PDF / Excel ;
  - actions groupées (soumettre, comptabiliser).
- **Données de base** : catégories, limitées aux comptes de charge imputables.
- **Rapports** : par catégorie, par salarié et par mois ; HT, TVA et TTC ; reste à rembourser.
- **Contrôle** :
  - approbations au-delà du délai cible ;
  - notes approuvées non comptabilisées, comptabilisées non remboursées ;
  - motifs de rejet et d'annulation ;
  - journal des décisions.
- **Paramètres** : règles, approbation, comptabilisation (rôle du module), rôles.

## 4. Défauts trouvés par le parcours 99 et corrigés

1. **Lecture des notes ambiguë** : deux clés étrangères relient les lignes aux notes, si bien que la
   lecture combinée échouait. Elle nomme maintenant sa clé.
2. **Compte de regroupement accepté** : une catégorie pouvait porter le compte « 6 », et la note
   approuvée était ensuite refusée à la comptabilisation. Désormais :
   - l'écran ne propose que des comptes imputables ;
   - la base refuse ce cas à la création de la catégorie (V110).

## 5. Compléments livrés le même jour (V111–V112)

- **Analytique par ligne** : chaque ligne peut être imputée à un projet actif (V111). L'écriture de
  charge porte alors la section du projet.
- **Avances au salarié** :
  - versement par la trésorerie, numéro `AVS-AAAA-####` ; écriture débit 4211 « Personnel, avances »
    (rôle `EXPENSE_ADVANCE`), crédit trésorerie ;
  - au remboursement d'une note, les avances ouvertes s'imputent d'abord, des plus anciennes aux plus
    récentes, et seul le reste passe par la trésorerie ;
  - restitution d'un solde non consommé.
- **Barèmes kilométriques et per diem** : taux par unité (km, jour, nuit, repas), catégorie, validité.
  Aucun barème légal n'est pré-rempli. La ligne vaut quantité × taux, sans TVA ni justificatif de
  montant.
- **Devises** : la ligne garde le montant d'origine, la devise et le cours saisi ; la note porte la
  contre-valeur arrondie au centime.
- **Photo du justificatif** : stockage privé du nuage `expense-receipts` (script de plateforme
  Supabase). Chemin `<société>/<note>/<fichier>` ; lecture par qui voit la note ; dépôt et retrait
  par l'auteur tant que la note est modifiable.

## 6. Restes

- **Sur site** : pas d'API Java pour les notes de frais. Comme les achats, le stock, le grand livre et
  la paie, le module passe aujourd'hui par Supabase ; le portage vers l'API suivra le plan des
  lots 3 à 5 (`docs/PLAN-BASCULE-JAVA.md`). Le stockage des justificatifs n'existe que dans le nuage ;
  sur site, la référence du justificatif reste obligatoire au-delà du seuil.

## 7. Vérification

- **Java** :
  - `NotesDeFraisIT` : cycle complet, rejet, gardes, confidentialité, V110 ;
  - les comptes de rôles sont mis à jour dans `AccountingSetupApiIT` et `ParametrageComptableIT` ;
  - toute la suite est verte.
- **Vitest** : 104 fichiers, 604 tests. Lint : 0 erreur.
- **Parcours nuage** : 41 tests, dont le nouveau **99** (catégorie, saisie, soumission, refus à
  l'auteur, approbation par le second membre, comptabilisation, remboursement en espèces, PDF).
- **Parcours sur site** : 2 tests.
- **Bases** : Supabase et la copie locale sont à V110.

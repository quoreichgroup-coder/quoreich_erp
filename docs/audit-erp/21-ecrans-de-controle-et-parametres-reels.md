# 21 — Lot 3 : écrans de contrôle et paramètres réels (V106–V108)

19 novembre 2026. Ce lot remplace les derniers écrans de démonstration du cœur et ferme les écritures
directes restées ouvertes à tout membre.

## 1. Références

- **SAP** :
  - cockpit de clôture ;
  - concordance des comptes collectifs avec les postes individuels ;
  - piste d'audit ;
  - limites de trésorerie ;
  - stratégies de libération par niveau (ME28 / MRBR).
- **Sage X3** :
  - contrôle de cohérence comptable ;
  - seuils de signature par montant.
- **Sage 300** : seuils d'approbation par montant.
- **AUDCIF** (art. 17 à 19) :
  - pièce justificative ;
  - intangibilité des écritures ;
  - concordance des livres auxiliaires avec le grand livre.

## 2. Grand livre (V106)

### Grand livre → Contrôle

Le serveur calcule tous les contrôles (fonctions SECURITY INVOKER, limitées par la RLS à la société).

- **Anomalies par écriture** :
  - écriture déséquilibrée ou sans ligne (toujours signalée) ;
  - montant au-delà d'un seuil ;
  - doublon probable d'une écriture manuelle ;
  - saisie et comptabilisation par la même personne ;
  - comptabilisation tardive ;
  - compte devenu inactif.

  Chaque anomalie s'**examine** : la justification est tracée (auteur, date) et l'anomalie reste
  visible, marquée « examinée ».
- **Concordance des livres** :
  - clients (factures ouvertes moins crédits non imputés) / comptes clients ;
  - acomptes / comptes d'avances ;
  - fournisseurs / comptes fournisseurs ;
  - chaque compte de trésorerie / son compte du plan ;
  - valeur du stock / comptes de stock.

  Les comptes collectifs comprennent ceux des jeux de comptes (V105).
- **Intégrité** :
  - écritures équilibrées et non vides ;
  - continuité de la numérotation par journal ;
  - trace d'audit de chaque écriture comptabilisée ;
  - pièces des livres auxiliaires reliées à leur écriture ;
  - conformité du plan comptable.
- **Piste d'audit** : réelle, toutes les pages, avec export.
- **Périodes** :
  - écritures par période ;
  - clôture et réouverture au calendrier fiscal central (V33), seul lieu où elles se font.
- **Simulateur d'écriture** : sur les comptes du plan, sans lignes inventées.

### Grand livre → Paramètres

- **Contrôles** : seuils vides = contrôle désactivé ; chaque contrôle se coupe ; tolérance de
  concordance. Droit `accounting.controls` (admin, comptable, auditeur).
- **Journaux et numérotation** : journaux SYSCOHADA et prochaine pièce réelle.
- **Calendrier fiscal** : le panneau central.
- **Devise** : la devise fonctionnelle réelle de la société, sans cours inventés.

### Sécurité

- `gl_audit_logs` : la piste d'audit comptable était **effaçable par tout membre**, lecteur compris
  (point S6 de l'audit du 14 novembre, jamais fermé). Elle est désormais en lecture seule ; seul le
  déclencheur l'écrit.

### Constats sur la copie réelle (ROXGOLD SANGO)

Aucune correction n'est faite ; la décision revient au propriétaire ou à l'expert-comptable.

- **Clients** : 0 au livre auxiliaire contre −1 500 000 au grand livre.
- **Fournisseurs** : 5 900 000 au livre auxiliaire contre 14 800 000 au grand livre.
- **Pièces sans écriture** : 4.
- **Plan comptable** : 20 erreurs (déjà connues).

## 3. Trésorerie (V107)

- **Limites des comptes** : solde minimal, solde maximal et découvert autorisé, saisis sur chaque
  compte. Vide = non suivi.
  - L'état est calculé contre le solde réel : dans les limites, sous le minimum, en découvert,
    découvert dépassé, excédent à placer.
- **Piste d'audit** : mouvements, relevés importés, rapprochements et clôtures, avec leur auteur.
  Elle remplace les lignes écrites en dur (banques et opérations de change fictives).

## 4. Achats et fournisseurs (V108)

### Écritures directes fermées

Le balayage « tables modifiables par tout membre » a trouvé, sans aucune garde :

- **Seuils d'approbation fournisseurs et achats** : un lecteur pouvait supprimer un niveau et
  contourner le circuit d'approbation.
- **Paramètres fournisseurs** (numérotation, modes de paiement, retenues, notifications) : la règle
  « tout paramétrable + droit » n'avait jamais été appliquée aux comptes fournisseurs (G-51).
- **Files d'approbation** (`procurement_approvals`, `ap_approval_queue`) et décisions de
  rapprochement : un membre pouvait marquer lui-même un niveau « approuvé ».
- **Alertes, modules activés, licences.**

Ce qui change :

- Files, décisions et alertes : écrites seulement par les fonctions métier.
- Paramètres : nouveau droit `ap.settings` (catalogue 107), ou `procurement.settings` pour les achats.
- Modules : réservés à l'administrateur de la société.
- Un seul niveau par type de pièce (index unique).

### Écrans

- **Seuils d'approbation modifiables** (`ApprovalThresholdsEditor`) dans les paramètres des achats
  (« Niveaux d'approbation ») et des fournisseurs (« Approbation »).
- **Contrôle AP** :
  - la « File de validation » lit la vraie file V41 (niveau en cours, délai écoulé contre le délai
    cible) ;
  - les décisions se prennent dans Transactions → Approbations.

  L'ancienne file approuvait par un UPDATE sans effet sur la facture.
- **Rapports d'approvisionnement réels** (`src/lib/procurement-reporting.ts`, testé) :
  - dépenses engagées par fournisseur et par catégorie de fournisseur ;
  - commandes par mois ;
  - délai de livraison ;
  - ponctualité contre la date promise.
- **Tableau de bord** : les niveaux réellement paramétrés.
- **Supprimé** : l'onglet « Spend Categories » factice.

## 5. Immobilisations

Les onglets « Depreciation » et « Maintenance » sont supprimés : méthodes et cycles écrits en dur.

- Méthode, coefficients dégressifs et prorata du premier mois : réels, dans le premier onglet.
- Maintenance : non gérée aujourd'hui.

## 6. Défaut trouvé par les parcours

Prévisions du budget : cliquer sur « Nouvelle version » avant que le plan comptable soit chargé créait
une version **vide**, sans le dire. Le parcours 93 l'a révélé de façon intermittente. La création
attend maintenant le chargement, et refuse en clair si le plan comptable manque.

## 7. Restes connus

- **Grand livre sur site** : contrôles et piste d'audit ne passent pas encore par l'API. L'écran le
  dit.
- **Tables des modules hors cœur** encore modifiables par tout membre : notes de frais, projets,
  conformité, risques, prévisions de trésorerie IA, règles de workflow, modèles de rapports. Elles
  seront traitées avec leurs modules (lot 4).
- **Catégories d'achat** : la catégorie reste le texte libre de la fiche fournisseur ; un
  référentiel de catégories reste à créer si le propriétaire le souhaite.

## 8. Vérification

- **Java** : 233 tests (11 unitaires et 222 d'intégration), dont les nouveaux `ControlesGrandLivreIT`
  et `ParametresProtegesIT`.
- **Vitest** : 103 fichiers, 601 tests ; lint : 0 erreur.
- **Parcours nuage** : 40 tests, dont le nouveau **98**.
- **Parcours sur site** : 2 tests.
- **Bases** : Supabase et la copie locale sont à V108.

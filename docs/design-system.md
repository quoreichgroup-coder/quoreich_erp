# Design system QERP

Premier lot appliqué le 21 novembre 2026. Le socle reste React, Tailwind et les composants shadcn/Radix présents dans `src/components/ui`.

## Accueil et préférences d’apparence

- `AppearanceProvider` applique le thème **Clair**, **Sombre** ou **Appareil** à toute l’application via `next-themes`, déjà installé. Le thème Appareil réagit aux changements du système.
- L’utilisateur choisit aussi **Essentiel**, formulaire centré par défaut, ou **Entreprise**, avec un panneau de présentation à partir de 1 024 px. Le formulaire reste identique et monté pendant ce changement : les champs saisis sont conservés.
- Le bouton **Apparence** est disponible avant la connexion. Après connexion, le même réglage se trouve dans **Compte utilisateur → Apparence**. Ce dialogue contrôlé restitue le focus au bouton du compte.
- Les préférences sont enregistrées sur l’appareil dans `qerp-theme` et `qerp-auth-layout`. Elles ne contiennent aucun identifiant ni mot de passe ; elles ne sont pas synchronisées avec le compte.
- `AuthShell` est commun à la connexion, à l’inscription, au mot de passe oublié et à la réinitialisation. Un seul formulaire est affiché, les libellés sont associés aux champs, les entrées mesurent 48 px et les mots de passe proposent un contrôle d’affichage explicite.
- Le petit écran conserve une seule colonne et un défilement vertical naturel, y compris en paysage ou lorsque le clavier réduit la hauteur disponible. Les champs utilisent une taille de texte de 16 px.
- Les erreurs de connexion et d’inscription restent visibles dans le formulaire. Le thème sombre utilise du texte noir sur les boutons primaires bleus et du texte clair sur les alertes destructives, pour conserver un contraste lisible au repos et au survol.

## Identité et couleurs

- Le logo du produit est celui de **QERP**, disponible dans `public/branding/qerp-logo-v1.png` et affiché par `AppLogo`. `inverse` fournit une présentation monochrome claire pour les surfaces foncées.
- Le titre de l'onglet et le titre de partage nomment aussi QERP ; QUOREICH GROUP reste l'auteur et l'éditeur de l'application.
- Le logo QUOREICH GROUP appartient à la société mère. L'identité des sociétés utilisatrices et de leurs pièces comptables reste indépendante.
- Bleu de marque : **#0062db** ; accent orange : **#ff8a51**. Les composantes HSL de `src/index.css` conservent ces valeurs sans arrondi visible d'un canal RGB. Le thème sombre conserve ses adaptations de contraste.
- Employer les couleurs sémantiques `primary`, `success`, `destructive`, `warning`, `info`, `muted` et leurs variantes de fond ; éviter de redéfinir les couleurs de statut dans chaque page.
- Montserrat compose la navigation, les données et les contrôles. Playfair Display compose les titres principaux (`h1`) et le titre de présentation Entreprise. Cette affectation est notre choix d'application des deux familles de la charte, qui ne décrit pas les composants de l'ERP.
- Les deux familles variables sont livrées localement dans `public/fonts`, avec leurs licences OFL et leurs sources. `src/styles/brand-fonts.css` fournit leurs sous-ensembles Unicode ; le rendu ne dépend plus d'un appel à Google Fonts.
- En thème clair, la navigation utilise le bleu exact de la charte et du texte blanc. L'entrée active a un fond blanc, du texte bleu et un repère orange. Les titres de `PageHeader` associent le bleu à un trait orange ; les tableaux gardent leurs surfaces neutres. En thème sombre, les surfaces et le bleu des textes s'adaptent au contraste.
- Les inversions texte/fond au survol du menu sont immédiates : une interpolation simultanée du blanc vers le bleu et du bleu vers le blanc crée une phase de contraste insuffisant. Les transitions de dimensions et de chevrons peuvent rester animées.
- Le logo QERP reste en couleurs dans un bandeau blanc de 56 px occupant toute la largeur du menu, sans marge bleue. Le logo est centré, large de 128 px, avec son ratio d'origine. Le bandeau garde uniquement un arrondi inférieur gauche de 12 px ; le côté droit reste à angle droit, conformément au rendu validé. Sur téléphone, le logo apparaît aussi dans la barre du haut, avec le nom de la société active visible et tronqué si nécessaire.

## Composants et densité

| Besoin | Composant / convention |
|---|---|
| Titre, description, actions | `PageHeader` : le groupe d'actions se replie selon l'espace réellement disponible |
| Bouton courant | `Button`, variantes `default`, `outline`, `ghost`, etc. |
| Densité | `size="sm"` : 44 px sur téléphone, 36 px dès `sm` ; `compact` : 32 px ; `touch` : 44 px |
| Statut métier | `StatusBadge`, avec un libellé français explicite pour les codes serveur |
| Liste | `Table` pour contenir le défilement du tableau ; `FilterBar`, `SortableHead` et `PaginationBar` pour les contrôles partagés |
| Fenêtre | `DialogContent` : marge extérieure, hauteur bornée au viewport dynamique, défilement intérieur |
| Confirmation | Primitives `AlertDialog`, avec des actions nommées et le motif métier requis |
| Onglets | `TabsList` et `TabsTrigger` : défilement horizontal local, navigation Radix au clavier |
| Navigation vers d'autres pages | Liens avec `aria-current="page"` ; ne pas leur donner un rôle d'onglet sans panneaux et gestion clavier correspondants |

## Règles responsive et accessibilité

1. Ne pas masquer un débordement du contenu principal avec un `overflow-x:hidden` global. Donner aux tableaux et aux onglets leur propre conteneur de défilement.
2. Les actions doivent se replier ; éviter une ligne de boutons non repliable à côté du titre. Les formulaires commencent sur une colonne avant d'en ajouter selon la largeur.
3. Les grilles de lignes gardent une largeur utile et défilent localement plutôt que d'écraser les champs numériques.
4. Le tri utilise un vrai bouton dans l'en-tête et annonce `aria-sort`. La pagination nomme ses contrôles et annonce la page courante.
5. Les dialogues contrôlés sans `DialogTrigger` reçoivent une référence explicite `returnFocusRef` à leur initiateur. Les vrais `DialogTrigger` conservent la gestion native Radix. Un `onCloseAutoFocus` propre au composant garde la priorité, notamment pour le CFO.
6. Chaque icône interactive possède un nom accessible. Les fenêtres et panneaux possèdent un titre.
7. Le panneau des notifications est borné à la largeur et à la hauteur de l'écran. Le menu latéral reste réductible sur ordinateur ; ses commandes sont retirées de la tabulation lorsqu'il est replié.

## Périmètre du premier lot

Appliqué aux composants UI partagés, aux contrôles de tableaux, aux notifications, à la navigation, à la connexion, aux en-têtes et premières fenêtres Achats/Ventes, au cockpit CFO, au shell d'accueil et à la navigation des Paramètres.

La migration des pièces complexes vers des pages dédiées, la généralisation des statuts et des confirmations aux anciens écrans restent à poursuivre module par module. Le lot ne modifie ni les données affichées, ni les droits, ni les exports métier.

Régression : `tests/e2e/design-system-responsive.spec.ts` vérifie les cinq largeurs 360/390/768/1024/1440 px, une demande de six lignes, le focus à la fermeture, les notifications et les onglets au clavier. Les contrôles de tri et de pagination sont couverts par `DataTableControls.accessibility.test.tsx`.

## Listes en cartes — deuxième lot

Les demandes, commandes et réceptions d'achat ainsi que les devis, commandes et livraisons de vente utilisent `Table` avec une option `mobileColumns`. Chaque colonne décrit un libellé, éventuellement un rôle (`selection`, `primary`, `actions`), une largeur de champ mobile (`wide`) ou la présence du tri (`sortable`). Les métadonnées doivent correspondre à l'ordre des cellules affichées, y compris celles fournies par un composant intermédiaire.

Sous 768 px, chaque ligne devient une carte avec légendes, sélection et actions accessibles au toucher. Les boutons de tri existants restent dans l'en-tête de la liste. À partir de 768 px, le tableau habituel est conservé. Une seule instance des lignes et des actions est montée : la sélection et les fenêtres ouvertes survivent au redimensionnement.

Les cartes réutilisent les valeurs, les filtres, les tris, la pagination et les actions du tableau. Leurs libellés ne doivent pas ajouter de devise fixe quand le tableau n'en impose pas. Les références Ventes sont accessibles au clavier et restituent le focus après fermeture du détail.

Un tableau sans `mobileColumns` conserve son rendu habituel. Les états vides et cellules fusionnées n'affichent pas de fausse légende ni de faux contrôle de sélection. L'adaptation des listes des autres modules reste à poursuivre.

Régressions : `Table.mobile-columns.test.tsx` couvre l'association des légendes et les tableaux non migrés ; `tests/e2e/responsive-document-cards.spec.ts` contrôle les six listes sur données non vides, le tri, la pagination, l'export filtré, les restrictions de droits et le redimensionnement.

## Comptes clients et fournisseurs

Les factures clients, encaissements, factures fournisseurs, paiements fournisseurs, factures à approuver et décisions d’approbation reprennent `Table.mobileColumns`. Les mêmes lignes sont présentées en cartes sous 768 px et en tableau au-delà. Les sélections, recherches et exports continuent d’utiliser les données existantes. Les légendes de montant n’ajoutent aucune devise fixe.

Sur ordinateur, les dates et références restent sur une ligne. Les noms longs utilisent une ellipse avec le texte complet au survol ; les cartes mobiles et le panneau de détail présentent le nom complet. La cible des références mesure au moins 44 px en mode carte et reprend une hauteur naturelle en tableau. Un tableau trop large défile dans son conteneur.

Les en-têtes utilisent `PageHeader`. Les formulaires de facture et de règlement commencent sur une colonne ; leurs cellules qui occupent deux colonnes sur ordinateur doivent utiliser `col-span-1 sm:col-span-2`, pour éviter de recréer une colonne implicite sur téléphone. Les libellés des champs de création sont associés aux contrôles.

`DocumentDrawer` fournit l’enveloppe partagée des deux panneaux de facture : `Sheet` Radix nommée, hauteur dynamique du viewport, contenu défilant, actions repliables, focus contenu et fermeture au clavier. Le contenu métier, les pièces jointes et les actions restent ceux du module. La référence est un bouton accessible ; `returnFocusRef` indique où revenir. Lors du passage au règlement, le module transfère cette référence au dialogue de règlement et vide celle du panneau avant sa fermeture, pour laisser le nouveau dialogue recevoir le focus.

Les dialogues de création, modification, rejet et annulation concernés reçoivent leur initiateur explicite. Les fenêtres restent montées pendant le redimensionnement et conservent la saisie. Les historiques comptables intégrés conservent leurs composants actuels.

Régression : `tests/e2e/finance-responsive.spec.ts` contrôle les six listes, la sélection, le CSV filtré, les droits de consultation, les panneaux au clavier et leur passage au règlement, les états vides, les formulaires et les champs de devise.

## Stocks et immobilisations

Les trois vues de mouvements de stock (ensemble, transferts, ajustements) et les mouvements d’immobilisations utilisent les mêmes cartes sous 768 px. Les contrôles de tri restent disponibles dans l’en-tête mobile. Pagination, sélection et périmètres d’export restent ceux du module : le CSV de sélection Stock porte sur les lignes choisies, celui de l’en-tête sur l’onglet courant ; les immobilisations conservent leurs filtres de date, type et statut.

Les en-têtes utilisent `PageHeader`. Les désignations, dépôts et motifs sont complets en cartes ; leurs versions compactes sur ordinateur donnent accès au texte entier au survol. Les dates et références restent sur une ligne dans les tableaux. Les légendes de montant ne définissent pas une nouvelle devise.

Les formulaires d’ajustement et de transfert de stock commencent sur une colonne, avec des contrôles de 44 px sur téléphone et un retour de focus explicite. La contre-passation d’amortissements utilise un `Dialog` avec motif obligatoire : une erreur conserve le motif et le succès rend le focus au bouton d’origine. Le calcul courant des dotations conserve son déclenchement existant.

Les libellés affichés des types et statuts d’immobilisation sont français, avec les couleurs sémantiques de `StatusBadge`. Les codes utilisés dans les filtres, calculs et exports restent inchangés. `maskAmount` reste la seule valeur rendue pour le montant : ne jamais ajouter le montant brut dans un titre, un nom accessible ou une autre propriété HTML.

Régression : `tests/e2e/stock-assets-responsive.spec.ts` vérifie les quatre listes, tri/pagination/sélection, portées CSV, formulaires, erreur de contre-passation, masquage des montants et états vides.

## Avoirs, crédits et avances

Les registres des avoirs clients, acomptes/crédits clients, avoirs fournisseurs et avances fournisseurs utilisent `Table.mobileColumns`. Ils présentent les mêmes lignes et valeurs en cartes sous 768 px et en tableau au-delà. Les noms et motifs sont complets sur téléphone ; les versions compactes sur ordinateur donnent le texte entier au survol. La liste des avances fournisseurs reste dans l'onglet Règlements.

Les avoirs intégrés à une facture omettent Facture et Tiers dans les cellules comme dans les métadonnées. Chaque cellule conditionnelle reste un enfant distinct du `TableRow` : un fragment contenant plusieurs cellules désalignerait leurs légendes mobiles. Les montants et leurs calculs ne changent pas, et les légendes n'ajoutent aucune devise.

La référence d'un avoir est un `Button` accessible au clavier. Le détail restitue le focus à ce bouton, y compris lorsque l'utilisateur ouvre la ligne en cliquant sur une autre valeur. Le remboursement partiel restitue le focus à son bouton d'origine ; un remboursement total revient au titre stable de la liste, puisque sa ligne disparaît. Une erreur conserve les champs. Sans droit de remboursement, la liste n'affiche pas de colonne d'actions vide.

Les cinq formulaires concernés — avoir client, avoir fournisseur, acompte client, avance fournisseur et remboursement — commencent sur une colonne sous `sm`, avec les contrôles d'au moins 44 px et du texte de 16 px. Ils conservent leurs valeurs au redimensionnement. Les dialogues d'avoir ouverts dans une facture rendent le focus au bouton de cette facture ; les avances reviennent au bouton d'en-tête. La grille d'édition des lignes d'avoir garde une largeur utile et défile dans une région nommée accessible au clavier. Les actions d'imputation intégrées se replient selon l'espace disponible.

`DocumentDetail` utilise une colonne pour l'en-tête sur téléphone et deux à partir de `sm`, des actions repliables et des totaux qui peuvent revenir à la ligne. Les lignes défilent dans une région nommée ; une grille de plus de quatre colonnes conserve au moins 36 rem, pour que ses dernières colonnes restent consultables. La construction des exports reste inchangée.

Régression : `tests/e2e/credits-advances-responsive.spec.ts` vérifie les quatre registres, les avoirs intégrés, les détails et leur CSV, les formulaires, les remboursements partiel et total (y compris après erreur), les restrictions de droits, les états vides et le bandeau du logo validé.

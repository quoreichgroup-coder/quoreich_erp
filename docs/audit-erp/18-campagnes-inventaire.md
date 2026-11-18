# S3 / G-44 — Campagnes d’inventaire physique

V53 fournit le comptage simple, la valorisation et la génération des ajustements. `post_inventory_count` recalcule le théorique lors de la validation. Un inventaire avec gel exige au contraire de figer cette quantité à l’ouverture pour comparer le comptage à un état stable.

Étendre le comptage V53 aurait l’avantage de réutiliser les écrans, mais ses lignes sont lisibles par la société et son circuit recalcule le théorique. Retenir un circuit de campagne distinct, compatible avec les comptages historiques, qui passe par les mouvements et la comptabilisation de stock existants.

1. Ouvrir une campagne pour un dépôt de la société active. Prendre un instantané par article et permettre une seule campagne active pour ce dépôt. Sérialiser la prise d’instantané avec les mouvements, y compris les transferts entrants et sortants.
2. Retourner au compteur uniquement les articles, les unités et les quantités saisies. Garder le théorique et les écarts hors de cette réponse et interdire leur lecture directe via les tables de campagne. Une ligne non saisie reste distincte d’un zéro confirmé.
3. À la soumission, rendre les écarts accessibles au valideur habilité. Au-delà des seuils configurés, demander un recomptage et appliquer la séparation des fonctions. Tracer chaque comptage et chaque décision.
4. Valider et générer les ajustements dans une transaction unique, avec une référence à la campagne. Ajouter un contrôle contre une seconde validation. Une annulation lève le gel sans générer de mouvement.

V91, V93 et V94 : ouverture, gel, saisie aveugle, soumission, tolérances, recomptage, validation, ajustements, références et suivi en catalogue. V96 ajoute la préparation du tournant ABC.

Recette prioritaire : course entre ouverture et un mouvement ; transfert touchant un dépôt gelé ; mouvement permis sur un autre dépôt ; accès et changement de société ; absence du théorique dans la réponse du compteur ; zéro confirmé ; annulation ; puis validation concurrente sans ajustement en double.

Limite à la recette : l’écran et l’API de campagne masquent le théorique, y compris après soumission. Ils ne retirent pas à un profil ses droits existants sur les autres écrans et rapports de stock. Vérifier les droits du profil compteur avant de parler d’un aveuglement sur l’ensemble de l’application.

Pour reproduire la recette PostgreSQL depuis la racine sous PowerShell : `./scripts/schema/verify-inventory-campaign.ps1`. Le script utilise l’image Docker locale `postgres:18.6-alpine`, recrée le schéma sans port publié, sans montage du dépôt et sans socket Docker dans le conteneur, puis exécute les scénarios de campagne et de concurrence.

## Contrôle et ajustements

- Donner la lecture des écarts et la validation aux profils disposant de `inventory.post_count`. Un utilisateur ayant saisi un comptage de la campagne ne peut pas le valider. Présenter au valideur la quantité figée, la dernière quantité confirmée et la différence.
- Paramétrer les seuils par société. Un seuil dépassé demande un recomptage sans révéler le théorique ni le premier résultat au second compteur. Conserver les deux comptages, leurs auteurs et leurs dates. Une campagne sans politique définie doit signaler l’absence de paramétrage au valideur.
- Appliquer l’écart `confirmé − figé` au dépôt inventorié, dans une seule transaction et sous le verrou du dépôt. Réutiliser l’écriture des mouvements de stock et leur valorisation existante. Une ligne sans écart ne crée aucune écriture. Une erreur, par exemple une période verrouillée ou une imputation manquante, laisse la campagne soumise et le dépôt gelé.
- Vérifier la non-duplication lors de deux validations concurrentes, la reprise après erreur, les quantités par dépôt après ajustement et les écritures comptables produites. Ne déployer le gel opérationnel qu’avec un circuit testé de validation ou d’annulation.

La validation verrouille la campagne et le dépôt, vérifie la société, les habilitations et les recomptages, calcule les écarts en base, puis passe la campagne à l’état validé dans la même transaction que les mouvements. Le verrou du dépôt reste pris jusqu’au commit. Les ajustements passent par le circuit normal ; le mouvement porte l’identifiant de campagne comme référence source et conserve le lien vers sa pièce comptable lorsque le mode permanent en crée une.

V91 exige un motif d’annulation et enregistre l’auteur et la date. Si la personne qui a ouvert la campagne est indisponible, un responsable de la société disposant des droits de comptage et de validation peut lever le gel par une annulation motivée.

## Organisation des écrans

| Onglet de Stocks → Paramètres | Règles réellement utilisées |
| --- | --- |
| Traitement | Stock négatif et motif des ajustements manuels. |
| Inventaires | Dépôt et périmètre proposés ; seuils de recomptage ; base, seuils, fréquences et taille de lot du tournant ABC. Les seuils et fréquences doivent être renseignés. |
| Documents | Préfixe, largeur et prochain numéro de la série de campagnes. La séquence est attribuée en transaction et ne recule pas. Une ancienne référence ne change pas. |
| Comptabilité | Inventaire permanent ou intermittent, comptes par rôle ; le coût des ajustements vient du moteur de stock. |
| Droits | Rôles Stock et audit des habilitations. |

**Stocks → Transactions** sépare le catalogue, la saisie et le contrôle. Le catalogue filtre par dépôt, état ou référence et exporte toutes les pages filtrées en `.xlsx`. Il inclut les campagnes validées sans écart, qui n’ont pas de mouvement à consulter. Les responsables peuvent ouvrir l’historique des décisions. Les comptages initiaux et les recomptages ont chacun une feuille Excel préremplie avec les codes, désignations et unités. Les imports n’écrivent qu’après confirmation, acceptent un zéro explicite et rejettent le lot entier si une quantité ou une ligne n’est plus admissible. Un opérateur ne peut pas écraser le comptage d’un autre.

Le catalogue des articles, dans **Stocks → Données de base**, est distinct. Sa lecture est bornée à la société active et parcourt toutes les pages ; son Excel suit la recherche et les filtres appliqués.

Le **tournant ABC** calcule par dépôt le classement des articles suivis à partir de la valeur en stock ou des sorties valorisées sur la période configurée. Les transferts et ajustements n’alimentent pas cette seconde base. Les articles sans valeur restent hors du plan sauf si une fréquence leur est attribuée. Les articles déjà validés ne redeviennent exigibles qu’à leur échéance. Les plus anciens retards passent avant les nouveaux articles dans la limite de la taille de lot. Le calcul ne gèle aucun dépôt ; l’ouverture explicite vérifie que la proposition est toujours la même et conserve les règles et classes retenues. Il n’y a pas de lancement automatique.

Dans **Stocks → Rapports**, l’analyse ABC par dépôt appelle le même calcul que le plan de tournant. Les totaux couvrent tout le dépôt sélectionné ; la liste affiche les plus fortes contributions. La base, la période et les résultats découlent du paramétrage de la société.

## Référentiels ERP étudiés

| Référentiel | Ce qui est repris dans QERP | Ce qui reste distinct |
| --- | --- | --- |
| [SAP ERP : documents d’inventaire](https://help.sap.com/docs/SAP_ERP/96bf9ad642cf4b26a29595e3d573fb8c/3961bd534f22b44ce10000000a174cb4.html) et [comptabilisation des écarts](https://help.sap.com/docs/SAP_ERP_SPV/96bf9ad642cf4b26a29595e3d573fb8c/5161bd534f22b44ce10000000a174cb4.html) | Instantané, gel, contrôle des écarts et lien avec mouvements et écritures. | SAP distingue le gel du solde et le blocage des mouvements ; QERP impose ici les deux. Les limites de comptabilisation SAP par document, ligne et groupe d’utilisateurs ne sont pas les seuils de recomptage QERP. |
| [Sage 300 : options de stock](https://help.sage300.com/en-us/2026/web/Content/Operations/Inventory/Setup/SCREENS/Options.htm) et [comptage et rapprochement](https://help.sage300.com/en-us/2026/web/Content/Operations/Inventory/PhysicalInventory/CountingAndReconcilingInventoryQuantities.htm) | Options de traitement, numérotation séparée, feuille préremplie en articles et rapprochement avant ajustement. | Pas de quantité théorique préremplie dans la feuille QERP ; le comptage de campagne reste à l’aveugle. |
| [Sage X3 : sessions de comptage](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESSNX.htm) et [organisation des comptages tournants](https://online-help.sagex3.com/erp/12/howtoguides/en-US/negoce/Manage%20stock%20counts/Content/How-to%20guides/Distribution/Manage%20stock%20counts/T3_Operating%20mode.htm) | Séparation des paramètres, des campagnes par dépôt et du recomptage ; échéances du tournant par classe et dernière validation. | Répartition de listes par opérateur et comptage par lot ou numéro de série restent à spécifier. |

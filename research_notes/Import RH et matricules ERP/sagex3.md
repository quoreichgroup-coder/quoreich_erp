# Sage X3 : dossiers du personnel, imports et matricules

## Dossiers employés et périmètre Sage X3

### Takeaway
Sage X3 documente bien une fonction RH « Employees » qui gère les dossiers du personnel et les données civiles/contractuelles, ainsi que des fonctions HR/HCM. Les pages consultées concernent explicitement Sage X3 ERP 12; elles ne doivent pas être extrapolées à Sage HR (produit distinct).

### Cited Findings
- La fonction « Employees » sert à enregistrer les dossiers du personnel et permet de modifier, imprimer ou supprimer les dossiers; elle gère les informations employé (dont état civil et contrat). Les contrats sont gérés dans une fonction séparée et plusieurs contrats peuvent être liés au même dossier employé. — [Sage X3 12, Employees](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESEML.htm)
- Le site d'aide X3 classe la documentation et des fonctions sous les modules « Human Resources administration » et « Human Capital management »; la fonction de dossier employé est une page de l'aide Sage X3 ERP 12. — [Sage X3 12 Sitemap](https://online-help.sagex3.com/erp/12/en-us/Content/Sitemap.htm); [Employees](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESEML.htm)
- Les pages d'aide X3 décrivent l'employé comme un dossier doté d'un identifiant unique REFNUM, et non comme un objet générique « client/contact ». — [Sage X3 12, Career](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESECP.htm)

### Inferences
- Les conclusions de cette note portent sur l'ERP Sage X3 et sa documentation RH/HCM. Une correspondance de fonctionnalités avec Sage HR/Sage HR Online ou d'autres produits Sage n'est pas établie par ces sources.

### Gaps
- Les sources consultées n'établissent pas quels modules/licences, codes d'activité ou paramètres sont activés dans une installation X3 donnée; la page Employees renvoie à la documentation d'implémentation pour les prérequis.
- Je n'ai pas trouvé de page officielle qui compare explicitement Sage X3 HR/HCM avec le produit Sage HR. Ne pas confondre les noms de produits sur cette base.

## Import, modèles et mises à jour en masse

### Takeaway
Sage X3 possède un mécanisme officiel d'import de fichiers structurés piloté par des modèles, avec journal d'import, option de mise en zone temporaire des lignes mal formées et possibilité de lancer l'import en tâche batch. La documentation consultée confirme aussi une fonction RH « Other entries » permettant la mise à jour en masse des dossiers contractuels via un écran RH configuré. Je n'ai pas trouvé de modèle standard d'import des dossiers « Employees » dans les listes publiques consultées, donc il faut vérifier le catalogue du dossier X3 installé avant d'affirmer qu'un import employé standard prêt à l'emploi existe.

### Cited Findings
- La fonction Imports convertit des données structurées vers les tables X3 au moyen d'un modèle; le journal décrit les résultats. Une case peut envoyer les lignes incorrectes dans une zone temporaire pour correction et réimport; l'import peut être lancé en batch via la tâche standard IMPORT et son bouton Test valide le fichier sans l'importer. — [Sage X3 12, Imports](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GIMPOBJ.htm)
- La fonction de définition des modèles permet des fichiers plats à champs fixes, des fichiers plats délimités et des fichiers XML. Un modèle peut autoriser ou interdire la mise à jour d'un enregistrement existant. Avec un objet X3, l'import passe par la logique d'objet et ses contrôles/actions; un modèle sans objet effectue un transfert direct en table sans la simulation de saisie et ses contrôles/actions d'objet. — [Sage X3 12, Import/Export templates](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESAOE.htm); [Functioning (Import / Export)](https://online-help.sagex3.com/erp/12/en-us/Content/MODEL/fon_import.htm)
- « Other entries » (Autres saisies) sert à consulter/modifier des informations employé selon des critères dans une grille configurée par « Employee screens ». La documentation dit explicitement que cette fonction peut mettre à jour en masse les dossiers contractuels, notamment après évolution de référentiels métiers/postes ou intégration d'un groupe de nouveaux employés; l'écran correspondant doit être créé. — [Sage X3 12, Other entries](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GENEMP.htm)
- Dans Other entries, les entrées peuvent être standard, copiées vers les lignes dessous via « Apply below », ou appliquées par opération (exemple donné: augmentation). — [Sage X3 12, Other entries](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GENEMP.htm)
- Le sommaire public X3 des modèles standards consulté présente des catégories pour Common Data, ventes, achats, stock, fabrication, finance, etc.; il ne présente pas de catégorie RH ni de modèle intitulé Employees dans la liste Common Data. Cette omission dans le sommaire public n'établit pas à elle seule qu'aucun modèle employé standard n'existe dans une version ou un dossier particulier. — [Sage X3 12, Import/export templates Module Common Data](https://online-help.sagex3.com/erp/12/en-us/Content/OBJ/AOE_9.htm); [Sage X3 12 Sitemap](https://online-help.sagex3.com/erp/12/en-us/Content/Sitemap.htm)

### Inferences
- Pour un chargement initial RH, l'option X3 la mieux documentée est l'import par modèle; le modèle concret doit être repéré/validé dans l'instance. Si aucun modèle objet employé approprié n'y existe, la documentation générale indique que les modèles peuvent être configurés, mais elle ne donne pas ici de recette standard, champ par champ, pour créer/importer le dossier employé.
- La fonction Other entries est spécifiquement documentée pour la mise à jour en masse des contrats et ne prouve pas une création en masse de nouveaux dossiers employés. Distinguer une importation/création de dossiers d'une mise à jour en masse de champs contractuels.
- Préférer un import lié à l'objet approprié lorsque l'objectif est de bénéficier de ses contrôles; la documentation indique que les imports directs sans objet n'exécutent pas la simulation/les contrôles de l'objet.

### Gaps
- Aucune documentation officielle repérée dans le catalogue public consulté ne donne un modèle standard (nom/code, colonnes obligatoires, exemples de fichier) pour importer un dossier employé complet dans Sage X3 ERP 12.
- La source Other entries limite explicitement le scénario de masse aux dossiers de contrat; elle ne documente pas la création de dossiers employé au moyen de cette grille.
- Vérifier localement les modèles disponibles dans Setup > Usage > Imports/Exports > Import/Export templates ainsi que les activités/modules licenciés et personnalisations; la documentation générale dit que les modèles sont configurés dans cette fonction.

## Matricule / identifiant employé et numérotation

### Takeaway
La documentation X3 identifie REFNUM comme l'identifiant unique du salarié, de longueur 1 à 15 caractères dans des pages RH consultées; elle permet la saisie manuelle ou une valeur attribuée automatiquement par compteur. Pour le recrutement, le point d'entrée officiel SUBHRENT/MAJMATRI nomme explicitement le compteur « MAT » et documente un mécanisme de personnalisation de l'identifiant après son attribution automatique.

### Cited Findings
- La page Career décrit REFNUM comme l'identifiant unique employé, long de 1 à 15 caractères, saisissable manuellement ou laissé vide à la création pour incrément automatique via un compteur. La même description apparaît dans la page « Leave by employee ». — [Sage X3 12, Career](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESECP.htm); [Leave by employee](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESCNE.htm)
- Sur l'embauche via la fonction « Employee arrival », le point d'entrée SUBHRENT/MAJMATRI est appelé après attribution d'un nouvel identifiant chrono dans NEWREFNUM et permet d'attribuer une valeur différente de celle donnée par le compteur MAT. La documentation précise qu'il faut modifier NEWREFNUM pour substituer le matricule. — [Sage X3 12, Process SUBHRENT: Receipts](https://online-help.sagex3.com/erp/12/en-us/Content/OBJ/ADC_SUBHRENT.htm)
- De manière générale, « Sequence Number Assignment » sert à associer un compteur à chaque type d'objet/document et peut autoriser ou non la saisie manuelle; le contexte peut tenir compte de la société/législation. Cette page décrit le mécanisme général, pas à elle seule la configuration du compteur employé MAT. — [Sage X3 12, Sequence Number Assignment](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESTCA.htm)
- La fonction « Sequence Number Values » permet de modifier la prochaine valeur d'un compteur; la documentation met en garde contre une baisse de la valeur, qui peut provoquer des doublons/erreurs, et indique que ce réglage est destiné notamment à la récupération initiale des données, avec verrouillage en exploitation normale. — [Sage X3 12, Sequence Number Values](https://online-help.sagex3.com/erp/12/en-us/Content/FCT/MODCPT.htm)
- Le paramètre utilisateur REFNUM/Employee ID est une valeur par défaut suggérée à la saisie; la documentation le distingue de l'attribution du numéro par compteur. — [Sage X3 12, Employee ID parameter](https://online-help.sagex3.com/erp/12/en-us/Content/OBJ/ADP_TC_REFNUM.htm)

### Inferences
- Pour préserver un matricule historique, saisir l'ID explicitement peut être possible dans les écrans où le champ accepte une saisie manuelle; le compteur MAT s'applique lors du recrutement documenté. L'usage du compteur ne doit pas être confondu avec le paramètre utilisateur qui propose une valeur par défaut.
- Toute personnalisation du matricule au recrutement via le point d'entrée relève d'une adaptation technique; la page de documentation décrit l'extension, pas une option utilisateur standard à cocher.

### Gaps
- Les sources publiques repérées ne montrent pas la structure/configuration exacte du compteur MAT (préfixes, longueur, remise à zéro, périmètre société/législation) ni son écran de paramétrage spécifique dans une installation.
- Les pages Career/Leave by employee documentent le champ REFNUM comme facultatif à la création dans ces fonctions; elles ne suffisent pas à conclure que toute création d'un dossier dans tous les écrans, pays et scénarios d'embauche autorise un ID vide/saisi manuellement.
- La documentation du point d'entrée explique une personnalisation technique après allocation par MAT, mais ne garantit pas qu'une séquence cible définie par le client puisse être utilisée telle quelle sans développement, tests de doublons et contrôle des dépendances.

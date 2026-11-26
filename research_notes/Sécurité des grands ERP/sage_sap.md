# Sécurité de Sage 300 et SAP S/4HANA Cloud Public Edition

## Sage 300 : groupes personnalisables et compte ADMIN protégé

### Takeaway
La documentation Sage 300 **2026** décrit des groupes d’autorisations personnalisables par application et un compte ADMIN spécialement protégé. La protection de ce compte ne signifie donc pas que tous les profils métier doivent être figés. [Guide d’administration 2026, p. 70–71](https://docs.sage.com/docs/en/customer/300erp/2026/open/Sage300_InstallationGuide.pdf) ; [Users Screen](https://help.sage300.com/en-us/2026/classic/Content/Administration/SystemManager/AdministrativeServices/SCREENS/Users.htm)

### Cited Findings
- L’administrateur choisit les tâches autorisées dans chaque groupe. Chaque utilisateur reçoit **un groupe par application** ; il peut appartenir à des groupes différents selon l’application. Les sociétés partageant une base système partagent aussi les groupes. Le guide formule l’application du contrôle d’accès sous condition d’activation de l’option Security : ne pas transformer cette possibilité en affirmation sur un paramétrage obligatoire par défaut. [Guide d’administration 2026, p. 70–71](https://docs.sage.com/docs/en/customer/300erp/2026/open/Sage300_InstallationGuide.pdf)
- Les groupes peuvent être ajoutés, modifiés et supprimés ; leur composition consiste à cocher ou décocher des autorisations de tâches. L’aide web consultée est publiée le **15 septembre 2026**. [Adding, Editing, or Deleting Security Groups](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AddingModifyingSecurityGroups.htm)
- Deux autorisations administratives sont distinguées : **Maintain Users** permet la gestion des utilisateurs ; **Security Groups and User Authorizations** permet la gestion des groupes et de leurs affectations. Ce sont des capacités explicitement accordées aux groupes. [Administrative Services Security Authorizations](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AS_SecurityAuthorizations.htm)
- Le compte Admin **ne peut pas être supprimé** et seul l’administrateur système peut le modifier. L’écran propose l’authentification Sage 300, Windows ou les deux ; il expose aussi des options de désactivation, verrouillage et horaires autorisés. [Users Screen](https://help.sage300.com/en-us/2026/classic/Content/Administration/SystemManager/AdministrativeServices/SCREENS/Users.htm)

### Inferences
- Pour QERP, on peut proposer des rôles personnalisables tout en réservant des règles particulières à l’administration et à la continuité d’accès : Sage montre que ces deux mécanismes coexistent. [Users Screen](https://help.sage300.com/en-us/2026/classic/Content/Administration/SystemManager/AdministrativeServices/SCREENS/Users.htm) ; [Gestion des groupes](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AddingModifyingSecurityGroups.htm)

### Gaps
- Ces pages ne permettent pas d’affirmer une MFA native obligatoire, une détection automatique des conflits de séparation des tâches, ni un journal universel des modifications de permissions. Absence de preuve dans ce périmètre documentaire, et non preuve d’absence de fonctionnalités ou d’extensions.

## SAP : modèles de rôles, restrictions et responsabilités du client

### Takeaway
SAP S/4HANA Cloud Public Edition **2608** distingue des modèles SAP et les rôles réellement attribués. Les modèles sont larges ; SAP préconise leur adaptation avant production et avertit des risques liés au cumul de rôles. [Authorization Model](https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b9fd81647cdf45f5ad462a50222c2caa.html)

### Cited Findings
- Un rôle métier assemble des catalogues et applications IAM, avec des restrictions sur les données, par exemple société ou établissement. La disponibilité des restrictions dépend des applications IAM concernées. Les restrictions provenant de plusieurs rôles s’agrègent : une restriction dans un rôle peut être dépassée par un autre rôle plus permissif. Les modèles trop larges peuvent notamment créer des conflits de séparation des tâches. SAP recommande de créer/modifier les rôles en développement puis de les transporter vers test et production. [Authorization Model, 2608](https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b9fd81647cdf45f5ad462a50222c2caa.html)
- La matrice de responsabilités attribue au client la définition des politiques de mot de passe et exigences MFA, la configuration éventuelle du fournisseur d’identité d’entreprise et le concept d’autorisation. SAP fournit un fournisseur d’identité par défaut. Cela ne démontre pas une MFA obligatoire pour chaque utilisateur dans tout déploiement. La page obtenue est explicitement **2602**. [Protect Your SAP S/4HANA Cloud Public Edition](https://help.sap.com/docs/SAP_S4HANA_CLOUD/55a7cb346519450cb9e6d21c1ecd6ec1?locale=en-US&state=PRODUCTION&version=2602.500)
- SAP documente une **intégration** avec SAP Cloud Identity Access Governance, nécessitant un paramétrage client et l’activation de l’accord de communication SAP_COM_0066 ; un utilisateur administrateur est nécessaire. Ne pas présenter ce produit distinct de gouvernance comme une protection automatiquement activée dans tout ERP. Page officielle disponible en portugais, version **2602**. [SAP Cloud Identity Access Governance Integration](https://help.sap.com/docs/SAP_S4HANA_CLOUD/0f69f8fb28ac4bf48d2b57b9637e81fa/33ad9ed7770b458bbe2feff1da0f91e9.html?locale=pt-BR)
- **Display Security Audit Log**, version **2608**, permet d’examiner des événements de sécurité, notamment des connexions réussies ou échouées et des démarrages de transactions. La conservation est configurable, avec **45 jours par défaut**. Cela ne signifie pas que toute modification métier est intégralement journalisée dans ce journal. [Display Security Audit Log](https://help.sap.com/docs/SAP_S4HANA_CLOUD/55a7cb346519450cb9e6d21c1ecd6ec1/7eed4aba8bcb4d7091e289cf0dc00cf4.html)

### Inferences
- Pour QERP, séparer les actions autorisées des périmètres de données, et contrôler les droits effectifs cumulés par utilisateur, suit directement le problème décrit par SAP. [Authorization Model](https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b9fd81647cdf45f5ad462a50222c2caa.html)

### Gaps
- Aucun fondement trouvé ici pour déclarer un rôle SAP Administrator universellement immuable, un blocage automatique de tous les conflits SoD ou l’inclusion commerciale systématique de SAP GRC/IAG. Les pages SAP renvoyées par recherche étaient lisibles, mais certaines ouvertures directes ne restituaient aucun texte ; les versions sont donc indiquées individuellement.

## QERP : conclusion utilisable sans modifier le code

### Takeaway
La comparaison appuie des rôles métier personnalisables, encadrés par des protections d’administration et des contrôles de périmètre ; elle n’appuie pas une liste de rôles totalement figée. [Sage, gestion des groupes](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AddingModifyingSecurityGroups.htm) ; [SAP, Authorization Model](https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b9fd81647cdf45f5ad462a50222c2caa.html)

### Cited Findings
- Les deux éditeurs documentent la composition des autorisations ; Sage documente en plus un compte ADMIN non supprimable. [Sage, Users Screen](https://help.sage300.com/en-us/2026/classic/Content/Administration/SystemManager/AdministrativeServices/SCREENS/Users.htm) ; [SAP, Authorization Model](https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b9fd81647cdf45f5ad462a50222c2caa.html)

### Inferences
- Proposition pour QERP : permettre les profils métier sur mesure, réserver l’attribution des privilèges administratifs à des droits explicites, protéger la continuité d’accès administrateur, définir la MFA et les événements à auditer. Il s’agit d’un choix de conception inspiré des sources, et non d’une obligation universelle imposée par ces produits. [Sage, autorisations administratives](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AS_SecurityAuthorizations.htm) ; [SAP, responsabilités](https://help.sap.com/docs/SAP_S4HANA_CLOUD/55a7cb346519450cb9e6d21c1ecd6ec1?locale=en-US&state=PRODUCTION&version=2602.500)

### Gaps
- Cette recherche n’est pas un audit de l’implémentation actuelle de QERP et ne justifie aucun changement de code sans examiner ses règles effectives.

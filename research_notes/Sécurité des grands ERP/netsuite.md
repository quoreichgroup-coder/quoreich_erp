# Oracle NetSuite ERP : rôles, administration et contrôles

## Peut-on modifier les rôles fournis et verrouiller l’administration ?

### Takeaway
NetSuite distingue les rôles standard immuables et leurs versions personnalisées modifiables. Le rôle Administrator standard est particulier : ses boutons Edit et Customize sont absents ; Oracle recommande un rôle d’administration personnalisé pour restreindre les accès. [Rôles](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N285436.html) ; [Administrator](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4610746707.html).

### Cited Findings
- Les rôles standard ont des permissions prédéfinies. On ne les modifie pas directement : ils servent de modèles aux rôles personnalisés. Les rôles Retail Clerk constituent une exception supplémentaire : leur personnalisation n’est pas possible. [Rôles](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N285436.html).
- Administrator s’applique à tout le compte NetSuite, avec visibilité globale et accès au Setup Manager ; des administrateurs spécialisés, comme Marketing Administrator, n’ont qu’un périmètre fonctionnel. Oracle recommande peu de titulaires, mais au moins deux pour assurer la continuité. [Administrator](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4610746707.html).
- Core Administration Permissions permet une administration proche d’Administrator avec des restrictions sur les données sensibles. Ce n’est pas une équivalence complète : impossible notamment d’attribuer Administrator, modifier les employés qui le possèdent, fermer le compte ou administrer toutes les recherches privées. [Différences officielles](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1542138282.html).
- Une personnalisation n’hérite pas automatiquement des futures modifications du rôle standard ; les nouvelles permissions demandent une maintenance explicite. [Personnalisation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N285937.html).

### Inferences
- Pour QERP : protéger un rôle système de référence et proposer des copies personnalisables est cohérent avec NetSuite. Prévoir séparément l’administration technique limitée et l’administration souveraine ; ces propositions ne constituent aucune modification du code.

### Gaps
- Ne pas transformer « Administrator immuable » en « tous les administrateurs doivent avoir accès à toutes les données ». Oracle documente précisément l’alternative restreinte. La table des différences emploie aussi une formulation ambiguë sur l’édition d’Administrator ; la page dédiée dit explicitement que le rôle standard n’est pas personnalisable.

## Quels droits s’appliquent réellement à un utilisateur ?

### Takeaway
L’autorisation combine actions permises et périmètre de données. Plusieurs rôles peuvent être attribués, mais la documentation décrit les permissions du rôle actuellement utilisé, avec une exception distincte pour les permissions globales. [Permissions globales](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326630.html).

### Cited Findings
- Les niveaux généraux sont None, View, Create, Edit et Full : Full inclut normalement la suppression ; certaines permissions ne suivent pas exactement cette progression. [Niveaux](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326341.html).
- Une permission autorise un type d’enregistrement ou une tâche ; une restriction détermine les enregistrements accessibles. Exemple officiel : voir seulement les employés de son équipe. [Permissions et restrictions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3781107123.html).
- La fonctionnalité optionnelle Global Permissions applique des droits à travers les rôles d’un employé. Ceux-ci se combinent au rôle actuellement utilisé et prévalent en cas de conflit, même s’ils sont inférieurs. Ils ne peuvent pas réduire Administrator ; Oracle déconseille cette fonctionnalité. [Permissions globales](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326630.html).

### Inferences
- Pour QERP : choisir explicitement entre contexte de rôle actif et cumul des rôles ; NetSuite ne justifie pas un cumul automatique. Vérifier chaque action côté serveur et y joindre le périmètre société/tenant relève d’une conception cohérente avec ces distinctions.

### Gaps
- Les restrictions disponibles dépendent du produit et des fonctionnalités : filiales OneWorld, employés, départements, classes, emplacements, livres comptables. Éviter de promettre leur disponibilité uniforme. [Personnalisation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N285937.html).

## MFA, audit et séparation des tâches sont-ils universels ?

### Takeaway
La MFA est obligatoire pour Administrator et les rôles hautement privilégiés. Les validations métier demandent un paramétrage : la documentation ne permet pas d’affirmer que chaque opération impose deux personnes. [MFA obligatoire](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1532968056.html) ; [Approval Routing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2395258.html).

### Cited Findings
- L’obligation MFA privilégiée ne peut pas être retirée ; elle couvre production, sandbox, développement et Release Preview. [MFA obligatoire](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1532968056.html).
- La note 2026.2, mise à jour le 21 septembre 2026, documente l’option MFA pour tous les rôles Employee, Vendor et Partner. L’activation automatique annoncée en 2027.1 restera désactivable ; Customer Center est exclu. Ce changement futur ne doit pas être présenté comme déjà obligatoire partout. [Authentification 2026.2](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158921905537.html).
- Approval Routing exige activation, approbateurs et plafonds ; les étapes dépendent des montants et de la hiérarchie. Cela établit des circuits configurables, pas une double approbation universelle. [Approval Routing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2395258.html).
- L’historique employé conserve date, auteur et description des changements d’attribution. System Notes classique ne couvre que les champs principaux du rôle, pas tous ses onglets ; System Notes v2 existe aussi. [Traçabilité](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4591976451.html).

### Inferences
- Pour QERP : MFA renforcée sur les privilèges, journal des changements de droits et circuits d’approbation configurés sont trois décisions distinctes. Définir les incompatibilités de fonctions et empêcher l’auto-approbation là où le métier l’exige.

### Gaps
- Ces pages NetSuite, consultées le 21 novembre 2026, ne prouvent pas un moteur universel de conflits SoD activé par défaut. Les règles SSO et les modules spécialisés peuvent changer les modalités ; aucune conclusion n’est étendue à Oracle Fusion.

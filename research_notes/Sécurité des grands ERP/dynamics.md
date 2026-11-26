# Microsoft Dynamics 365 Finance et comparaison Business Central

## 1. Peut-on personnaliser les rôles standards de Finance ?

### Takeaway
Oui. Microsoft recommande de copier les rôles fournis pour adapter les accès. System Administrator constitue une exception privilégiée. [Microsoft Learn — sécuriser Finance et Operations](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/security-strategy-product-oa)

### Cited Findings
- Dans Finance et les applications Finance and Operations, la hiérarchie est **rôle → duties (responsabilités métier) → privilèges → permissions sur les objets**. Les rôles peuvent être affectés pour toutes les entités juridiques ou certaines seulement. Microsoft fournit des standards et permet leur duplication, leur modification, ou la création de rôles. Les standards évoluent lors des mises à jour : travailler sur des copies facilite la distinction entre livrable Microsoft et adaptation client. Cette préférence est une recommandation de maintenance, pas une interdiction de personnaliser. [Microsoft Learn — sécuriser Finance et Operations](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/security-strategy-product-oa)
- Le rôle **System Administrator** donne un accès complet pour gérer les éléments du système ; les autres rôles ne peuvent pas restreindre les utilisateurs qui le possèdent. La licence et l'autorisation restent deux sujets distincts : attribuer une licence ne donne pas à lui seul les permissions applicatives. [Microsoft Learn — conformité des licences utilisateur](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/stay-compliant-user-license-requirement)
- Finance dispose de rapports des affectations et permissions effectives, et de politiques pour restreindre les données accessibles. [Microsoft Learn — sécuriser Finance et Operations](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/security-strategy-product-oa)

### Inferences
- Pour QERP : conserver des modèles standards identifiables, des copies personnalisées et une visualisation des accès effectifs facilite les audits et les mises à jour. Recommandation déduite, pas propriété constatée de QERP.

### Gaps
- Finance autorise l'adaptation des rôles standards. La protection contre modification/suppression du rôle administrateur n'est pas établie ici ; la source confirme son accès privilégié.

## 2. Quelles protections entourent les changements et les connexions ?

### Takeaway
La séparation des tâches repose sur des règles configurées, avec contrôles automatiques, validation de l'existant et dérogations motivées. [Microsoft Learn — identifier et résoudre les conflits](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/sysadmin/identify-resolve-conflicts-segregation-duties)

### Cited Findings
- Après ajout d'une règle, il faut valider les rôles existants, règle par règle, puis les affectations utilisateur. Lors de la création/modification d'un rôle, les règles sont appliquées automatiquement et empêchent d'y réunir des duties incompatibles. Lors d'une affectation utilisateur créant un conflit, une erreur survient ; l'administrateur refuse l'affectation supplémentaire ou l'autorise explicitement. L'autorisation exige une justification et les dérogations sont consultables. Limite documentée : les conflits ne sont pas vérifiés pour les utilisateurs affectés via des groupes Active Directory Domain. [Microsoft Learn — identifier et résoudre les conflits](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/sysadmin/identify-resolve-conflicts-segregation-duties)
- Finance s'appuie sur Microsoft Entra pour l'identité. Entra peut demander une vérification MFA dans son parcours de connexion, sans modification de l'application ; les paramètres de sécurité et les politiques Conditional Access déterminent les contrôles. Ce sont des mécanismes d'authentification distincts des droits métier. [Microsoft Learn — sécuriser Finance et Operations](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/security-strategy-product-oa) ; [Microsoft Learn — fonctionnement MFA Entra](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mfa-howitworks)

### Inferences
- Pour QERP : après modification d'un rôle, contrôler les permissions cumulées de tous les rôles de chaque utilisateur, le périmètre des sociétés et les tâches incompatibles. Prévoir journal d'audit, justification des exceptions et examen périodique. MFA et rôle administrateur protégé complètent ces contrôles, sans les remplacer.

### Gaps
- Éviter « MFA activée par défaut dans tous les ERP Dynamics ». Une page spécialisée RSAT affirme que l'accès aux environnements Finance and Operations exige MFA, mais documente des exemptions de comptes de test et des différences sur site : son contexte ne permet pas une généralisation universelle. [Microsoft Learn — authentification RSAT](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/perf-test/rsat/rsat-user-based-authentication)

## 3. Comparaison distincte : Business Central

### Takeaway
Business Central utilise des **ensembles de permissions**, avec copie/composition personnalisée et un ensemble SUPER protégé. Ne pas lui attribuer automatiquement la hiérarchie et les contrôles de séparation des tâches de Finance. [Microsoft Learn — permissions Business Central](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-define-granular-permissions)

### Cited Findings
- Les ensembles System/Extension originaux ne sont pas modifiés par les exclusions d'un ensemble personnalisé qui les inclut. La copie est disponible ; l'inclusion par référence peut suivre les changements Microsoft. Les exclusions restent locales à l'ensemble composé : ne pas les présenter comme un refus global annulant toutes les autres affectations. [Microsoft Learn — permissions Business Central](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-define-granular-permissions)
- **SUPER n'est pas modifiable**. Il donne tous les accès dans les limites de la licence et doit être affecté à au moins un utilisateur par base. SECURITY permet de déléguer la gestion sans donner plus de permissions que celles détenues par le gestionnaire. Certains ensembles, tels BASIC, sont exclusivement sur site. [Microsoft Learn — ensembles spéciaux](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/administration-special-permission-sets)

### Inferences
- Pour QERP, le couple « administrateur protégé + rôles métier personnalisés » est pertinent, mais la sécurité dépend aussi de qui peut attribuer ces rôles et des droits cumulés.

### Gaps
- Aucune preuve retenue ici d'un contrôle SoD natif Business Central identique à Finance ; ne pas l'affirmer. Ces notes décrivent la documentation disponible au 21 novembre 2026, sans audit de l'instance QERP ni changement applicatif.

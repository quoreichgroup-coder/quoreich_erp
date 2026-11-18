# Administration RH et mouvements Sage

## Comment Sage structure-t-il le dossier d'une personne et son emploi ?

### Takeaway
Sage 300 People sépare l'identité durable de la personne (« Entity ») de ses dossiers d'emploi propres à la société/règle de paie (« Employee »). Les changements de rémunération et de poste sont des transactions datées et motivées, au lieu de remplacer silencieusement le dossier courant.

### Cited Findings
- L'Entity porte notamment l'adresse, les contacts, les coordonnées bancaires, les relations et l'identité; l'Employee porte le code emploi, les dates de service, le statut fiscal et le régime de rémunération. Le code de personne reste stable lorsque plusieurs dossiers d'emploi/code employés sont créés. — [Sage 300 People: Entity vs Employee](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=0&q=entity&solutionid=200428140129907)
- À l'embauche d'une personne déjà connue, Sage recommande de rechercher et de rattacher l'Entity déjà présente plutôt que créer une identité en doublon. La fiche de l'Entity persiste après la fin d'emploi. — [Sage: Locating an existing entity when loading a new employee](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=7&q=entity&solutionid=200410141111005)
- Les augmentations sont des transactions avec identifiant, date d'effet, date de traitement, motif défini dans les paramètres, base (annuel/période/taux horaire/taux journalier), montant ou pourcentage et entité ayant autorisé. Sage conserve l'historique et n'applique une augmentation future qu'à sa période d'effet. — [Sage: Capture employee salary increases](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=0&q=increase&solutionid=200407133708279)
- Les promotions peuvent être rapportées comme événements sur une période, avec un indicateur explicite et un comptage par événement. — [Sage 300 People Release Notes 20.3.1.0](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=200806100835380)

### Inferences
- QERP devrait garder une identité personne durable distincte des affectations d'emploi par société, avec unicité tenant/pays des pièces identitaires sensibles et rattachement lors d'une réembauche.
- Les changements de poste, de département, de responsable, de contrat et de salaire devraient être des événements à date d'effet, motif et auteur; le dossier courant et chaque paie passée doivent pouvoir être reconstruits à la date considérée.
- Les paramètres devraient porter les listes de motifs et les bases de rémunération autorisées. La règle de dates d'effet doit gérer les changements futurs et rétroactifs sans réécrire les cycles déjà comptabilisés.

### Gaps
- Ces articles décrivent le produit Sage 300 People, principalement sa documentation d'assistance Afrique du Sud; ils ne prouvent pas que tous les modules ou champs sont disponibles dans toutes les éditions/pays.
- Les sources examinées ne donnent pas une politique universelle de réembauche, d'identifiants nationaux, de conservation de pièces ou de correction rétroactive applicable aux pays OHADA; les obligations locales doivent rester configurables et validées par pays.

## Comment les mutations d'emploi et la fin de service sont-elles tracées ?

### Takeaway
Sage distingue transfert de poste, augmentation, fin d'emploi et réintégration. Le modèle de transfert documenté date la fin de l'affectation actuelle, date la nouvelle affectation et rattache un motif de transfert et des motifs de poste; les listes de salariés permettent aussi de retrouver les statuts actif, terminé, réintégré et archivé.

### Cited Findings
- Le modèle API de transfert contient le salarié et la règle de société, le poste actuel, sa date de fin et son motif, le motif du transfert, ainsi que le nouveau poste avec date de début et motif. La documentation précise que l'API transfère uniquement le poste principal et ne crée/supprime pas les liens de postes. — [Sage 300 People API Reference, section 4.19](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=200812113016707)
- La navigation produit Sage 300 People comprend des fonctions distinctes Employee Transfer et Position Linking; l'écran d'employés offre notamment les statuts New, Active, Terminated, Re-Instate New et Archived. — [Sage: Employee search including terminated employees](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=251127130215730)
- Les notes de version signalent le comportement attendu après terminaison/recalcul: libérer le poste lié et le rendre vacant. — [Sage 300 People Release Notes 20.3.1.0](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=200806100835380)
- Les modifications, insertions et suppressions peuvent être consultées et exportées avec filtres par période de paie, table, code employé, utilisateur et dates; les résultats incluent l'utilisateur, la date d'effet et les anciennes/nouvelles valeurs, triées chronologiquement. — [Sage: View audit details](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp%3Bjsessionid%3DA134377DB695982060C2A18ADA3C6805?solutionid=200405165247504&view=print)
- Les workflows en libre-service peuvent être reliés à la hiérarchie RH, à une liaison manuelle ou à la configuration du responsable hiérarchique. — [Sage 300 ESS Profile Troubleshooting](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?hypermediatext=null&solutionid=200609144156118)

### Inferences
- Le module QERP devrait faire des statuts d'emploi des transitions contrôlées (brouillon, soumis, approuvé, effectif, terminé, réintégré/annulé), plutôt que de supprimer les employés terminés.
- Pour les mouvements, une table d'événements effective-datés avec ancien/nouveau département, poste, responsable, rémunération et motif peut fournir une chronologie auditable; chaque événement devrait être non destructif et son accès filtré par société et droit.
- À la fin de service, fermer l'affectation et désactiver les accès/self-service selon une règle configurable, tout en conservant les documents, bulletins et traces historiques autorisés. Une terminaison ne devrait pas effacer l'identité de la personne ni libérer un poste avant validation effective.
- Un workflow paramétrable préparateur/approbateur, délégation avec historique et séparation des tâches est cohérent avec les fonctions de transfert et d'audit observées chez Sage; l'approbation préalable de chaque mouvement est une recommandation pour QERP, pas une règle universelle établie par ces pages.

### Gaps
- Les articles fournis ne définissent pas de schéma universel de workflow RH, de délai de conservation ni d'approbation obligatoire; ceux-ci dépendent des règles de l'organisation et de la juridiction.
- Le PDF API consulté est une référence People ancienne et décrit une API hébergée par le client; il sert de preuve des champs et du séquencement validation/traitement documentés, pas de recommandation d'architecture moderne pour QERP.

## Quels documents, historiques et flux RH sont à prévoir ?

### Takeaway
La documentation Sage montre que les documents du personnel sont classés par type et sensibilité puis exposés au libre-service selon un paramètre. Les demandes RH telles que congés utilisent un workflow avec étape d'approbation, état et réaffectation traçable; les soldes doivent être contrôlés et synchronisés avec la paie.

### Cited Findings
- L'administrateur peut régler par catégorie si le contenu est visible dans « Mes documents », les documents société, les deux ou aucun. Sage demande aussi de renseigner la sensibilité du contenu; certains types ne sont pas disponibles au libre-service, les utilisateurs téléchargent sans prévisualiser et l'impersonation n'est pas prise en charge dans cette fonction. — [Sage: Upload Employee Content on Web Self Service](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=230720085554433)
- Une demande de congé peut être réaffectée à un nouvel approbateur; l'ancien approbateur passe à « Reassigned » et une nouvelle étape « New » est créée dans l'historique du workflow. — [Sage: Reassign a leave application approver](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=0&q=Reassign+&solutionid=200609131051822)
- Pour les demandes de congé, Sage Self Service tient compte des soldes disponibles, demandes en attente et de la demande courante; le flux de résolution documenté demande de traiter les transactions en attente, poster les congés acceptés en paie puis synchroniser le solde. Cette page s'applique à Sage Payroll Professional/VIP, pas spécifiquement à Sage 300 People. — [Sage: Resolve leave rule warning in Sage Self Service](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=rule+preventing&solutionid=220607102755430)
- Les documents ou bulletins historiques après transfert dépendent du réglage de workflow autorisant les employés terminés et du lien entre règles de société; l'historique d'emploi doit donc rester consultable via des permissions explicites. — [Sage: Web SS Payslips for a transferred employee](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200811103745347)

### Inferences
- Paramètres QERP à prévoir : catégories et niveau de sensibilité des documents, visibilité salarié/gestionnaire/administrateur, politiques de congé, motifs et types d'absence, règles de solde/report, calendrier de jours ouvrés, approbateurs et délégations.
- Pour une demande d'absence, valider les chevauchements, le solde à la date, les jours ouvrés, les demandes concurrentes et les droits; garder l'historique de soumission, décision, délégation, annulation et transfert à la paie.
- Les documents RH (contrat, pièce, justificatif, certificat) doivent avoir propriétaire salarié, société, type, sensibilité, date, auteur, empreinte/versions et politique de conservation; n'exposer au libre-service que les types configurés et autorisés.
- La présence/temps, les congés et les variables doivent être livrés comme parcours RH approuvés reliés aux périodes de paie, pas comme simples champs libres sans origine.

### Gaps
- La documentation Sage documente différents produits (Sage 300 People, Sage Payroll Professional/VIP) et marchés; elle ne prouve pas que les règles de congés trouvées conviennent à chaque pays OHADA.
- Les sources consultées ne suffisent pas à recommander une politique légale de congé, de temps de travail, de protection des dossiers ou de durée de conservation. QERP doit permettre des paramètres par société/pays et attendre une validation locale.

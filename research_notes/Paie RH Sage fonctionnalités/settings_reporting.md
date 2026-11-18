# Paramètres, sécurité et états Paie/RH

## Quels paramètres de paie et traces de configuration sont montrés dans Sage ?

### Takeaway
Sage 300 Payroll traite la configuration comme des données contrôlables : états de configuration imprimables couvrent options de paie, paramètres de périodes, gains/retenues, plafonds, taxes, comptes G/L, EFT, champs facultatifs et barèmes. Une piste d'audit distincte rend compte de certaines modifications de paramètres; la couverture varie selon pays et version.

### Cited Findings
- Sage 300 Payroll 2027 répertorie des états de paramétrage pour les limites de retenue employé/employeur, les gains et déductions, EFT, intégration G/L, champs facultatifs, options de fréquence/historique, calendriers d'heures supplémentaires, profils fiscaux et codes d'indemnisation. [Sage 300 Payroll — Payroll Setup Reports](https://help.sage300.com/en-us/2027/classic/Content/Payroll_Help/Reports/Setup/AboutPayrollSetupReports.htm)
- Le même index décrit un état d'audit des mises à jour des taxes locales qui enregistre date, type de changement, création/modification et nouvelle valeur applicable; le rapport se vide après impression. [Sage 300 Payroll — Payroll Setup Reports](https://help.sage300.com/en-us/2027/classic/Content/Payroll_Help/Reports/Setup/AboutPayrollSetupReports.htm)
- L'état Sage 300 2024 sur les codes gains/déductions détaille méthodes de calcul, fréquences, dates de validité, comptes de distribution et variantes de rapports (détail, liste des employés associés, usages dans d'autres codes). [Sage 300 Payroll — Earnings and Deductions Report](https://help.sage300.com/en-us/2024/classic/Content/Payroll_Help/Reports/Setup/UsingtheEarningsandDeductionsReport.htm)

### Inferences
- Paramètres QERP à vérifier/compléter : paramètres de fréquence et conservation, rémunérations/déductions configurables avec dates d'effet, comptes par rôle, profils de paiement, limites employé/employeur, et un état de configuration qui permet de relire le paramétrage sans modifier les données.
- L'audit QERP devrait conserver chaque version de configuration sans l'effacer lors d'une consultation ou d'un export, avec auteur, horodatage, valeurs avant/après, date d'effet et motif. C'est une recommandation de conception inspirée des états d'audit Sage, pas une affirmation sur son stockage interne.

### Gaps
- Ces pages décrivent les éditions américaines/canadiennes de Sage 300 Payroll. Elles ne valident aucun taux, retenue, compte ni règle légale d'un pays OHADA.
- Le rapport d'audit Sage cité est limité aux changements de taxes locales et se vide après impression; la documentation consultée ne permet pas de conclure à une piste complète, immuable, couvrant toute la configuration.

## Comment Sage et SAP séparent-ils les droits paie et RH ?

### Takeaway
La sécurité documentée est à plusieurs niveaux : droits par fonction, restriction de population d'employés et droits financiers sur les rapports ou données sensibles. Sage avertit explicitement qu'une restriction de population ne remplace pas la sécurité d'accès aux écrans ou la sécurité de base de données.

### Cited Findings
- Sage 300 Payroll 2026 définit des groupes de sécurité séparés, dont entretien salarié, sécurité employé, accès aux numéros d'identification et accès aux coordonnées EFT; les droits EFT couvrent aussi les exports de fichiers de paiement et le rapport EFT. [Sage 300 Payroll — Payroll Security Groups](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Security/Sage300/AboutPayrolLSecurityGroups.htm)
- Dans Sage 300, Employee Level Security limite les employés visibles/traitables dans les formulaires et rapports à « all employees » ou à des listes assignées. La documentation précise que cette sécurité de population ne restreint pas à elle seule l'accès aux formulaires de paie et doit être combinée à la sécurité Sage 300/base de données. [Sage 300 Payroll — Employee Level Security](https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Security/Sage300/AboutEmployeeLevelSecurity.htm)
- Le rapport Sage 300 sur la sécurité indique le type d'accès de chaque utilisateur, sa liste principale et les listes de rapport. [Sage 300 Payroll — Employee Reports](https://help.sage300.com/en-us/2027/classic/Content/Payroll_Help/Reports/Employee/AboutPayrollEmployeeReports.htm)
- La mise à jour Sage 300 People 23.1.3.2 décrit un rôle « Enabler » qui active les zones sécurisables, puis des accès accordés ou refusés aux autres rôles. Les écrans interdits ne sont pas affichés; il faut reconstruire (Rebuild) après les changements de rôle. [Sage 300 People — Security setup for roles, release 23.1.3.2](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=230321081726310)
- Le cadre d'autorisation SAP ERP HCM permet de réutiliser les autorisations par rôle pour filtrer l'accès à certains résultats et contrôles de paie, en fonction des employés et des niveaux d'autorisation configurés. La page concerne l'Authorization Framework pour Payroll Control Center d'ERP HCM, pas toutes les offres SAP actuelles. [SAP Help — Payroll Control Center Authorization Framework](https://help.sap.com/docs/ERP_HCM/876ce26c5b834545bd5941c9ae1185df/cfef985209274d27e10000000a441470.html)
- Sage 300 People documente que la sécurité financière s'applique aux rapports d'équité salariale, lesquels proposent filtres, détail rémunération, tri et sauts de page. La source est une note de version 20.3.1.0. [Sage 300 People — Release Notes 20.3.1.0](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=200806100835380)

### Inferences
- QERP doit appliquer ses droits centralisés côté serveur/API/RLS et filtrer la population visible avant calcul, consultation ou export; masquer uniquement un bouton ou une colonne ne suffit pas.
- Distinguer au minimum lecture/édition du dossier RH, exécution, approbation et comptabilisation de paie, accès au détail de rémunération, coordonnées bancaires, et export/impression. Vérifier la séparation de fonctions et tracer toute action sensible.
- Un administrateur de rôles doit pouvoir attribuer des droits globaux, périmètres société/département et accès aux données sensibles; produire un état des rôles et autorisations facilite l'audit.

### Gaps
- Les sources Sage/SAP utilisent des modèles de sécurité propres à leurs produits; elles ne prescrivent pas le catalogue de droits QERP.
- Aucune des pages trouvées ne définit les exigences de confidentialité juridique dans les juridictions OHADA ciblées par QERP.

## Quels rapports, exports et impressions de paie sont attendus ?

### Takeaway
Les références séparent la revue avant paiement/comptabilisation, le registre de paie posté, les transactions EFT, l'historique salarié, les états de configuration et les rapports analytiques. Les rapports ont filtres de période/employé/organisation, formes détaillées ou résumées, totaux et protections de données sensibles.

### Cited Findings
- Sage 300 recommande d'examiner un Pre-Check Payroll Register après le calcul et avant l'émission des chèques; l'état liste les erreurs d'exécution et doit être relu, les erreurs corrigées puis la paie recalculée si nécessaire. Les rapports d'exception peuvent être écrasés au prochain calcul, ce qui donne à QERP une raison de préserver ses propres snapshots/audits. [Sage 300 Payroll — Calculate Payroll](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/UsingCalculatePayroll.htm)
- Le registre Payroll Register détaille période/date et séquences de calcul/comptabilisation, employé, gains/déductions/taxes, contributions patronales, comptes G/L et totaux/heures; il permet formats détaillé ou résumé, plages d'employés/dates et inclusion ou exclusion des chèques système, manuels et annulés. [Sage 300 Payroll — Payroll Register](https://help.sage300.com/en-us/2024/classic/Subsystems/UP/Content/Reports/Transaction/UsingthePayrollRegisterReport.htm)
- L'état des transactions EFT permet de choisir employés, dates et banques, et de masquer ou afficher intégralement les numéros de compte selon option d'accès; les groupes de sécurité dédiés contrôlent la capacité de voir les numéros, générer les fichiers et imprimer le rapport EFT. [Sage 300 Payroll — EFT Transactions Report](https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Reports/Transaction/UsingtheEFTTransactionsReport.htm), [Payroll Security Groups](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Security/Sage300/AboutPayrolLSecurityGroups.htm)
- Les rapports d'employés incluent historique des transactions en détail/synthèse et audit des changements d'historique (salarié, date/heure de dernière modification, date de transaction, description, montant). [Sage 300 Payroll — Employee Reports](https://help.sage300.com/en-us/2027/classic/Content/Payroll_Help/Reports/Employee/AboutPayrollEmployeeReports.htm)
- Le Payroll Analysis de Sage 300 People peut filtrer société/règle société, pay run, statut, salarié, lignes de paie, type de fiche (normal/fin d'année/ajustement), congés payés et période; il permet totaux globaux, MTD et YTD, filtres hiérarchiques (division, département, branche), consultation, impression et export. [Sage 300 People — Payroll Analysis](https://za-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?hypermediatext=null&solutionid=200610114010027)
- Le menu Sage 300 Payroll distingue imprimer état/liste/fenêtre, configurer imprimante/destination, cacher des champs selon profil utilisateur, et importer/exporter des enregistrements vers des outils non Sage. [Sage 300 Payroll — File menu](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/GettingStarted/Sage300/UsingtheFileMenu.htm)

### Inferences
- Pour QERP, compléter les rapports actuels par une revue pré-calcul/pré-validation, un état d'exceptions durable, un registre post-comptabilisation, un état de paiement bancaire et un historique des transactions avec journal d'audit.
- Chaque rapport doit montrer sa période et ses filtres, séparer détails/synthèses, agréger par mois (MTD/YTD), salarié, statut, département/section analytique et devise sans convertir ou cumuler les devises implicitement.
- Le masquage d'identifiants bancaires/salariaux et les autorisations d'export doivent être appliqués au serveur, puis vérifiés dans CSV/XLSX/PDF/impression. Les formats précis Sage diffèrent et l'aide consultée ne garantit pas que chaque rapport supporte CSV/XLSX/PDF dans toutes éditions.

### Gaps
- La documentation Sage 300 citée décrit l'impression et les interfaces d'import/export, mais n'indique pas uniformément les formats fichier disponibles par état; vérifier la version/édition concernée avant de copier un contrat d'export.
- Le workflow de paiement bancaire et les champs des fichiers EFT sont spécifiques aux pays/banques. Les sources nord-américaines ne justifient pas un format bancaire générique pour QERP ou une banque d'Afrique de l'Ouest.
- Les termes MTD/YTD et les types de rapports Sage 300 People sont des options du produit; leur pertinence exacte doit être confirmée par les responsables de paie QERP.

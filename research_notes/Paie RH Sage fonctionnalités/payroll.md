# Parcours paie Sage

## Quel cycle de paie complet et contrôlé documente Sage ?

### Takeaway
Les parcours Sage séparent la préparation/calcul, le contrôle avant validation, la validation/posting, puis les registres et l’intégration comptable. Une correction après approbation exige une opération de contrepassation; un cycle QERP devrait donc rendre les états et les transitions explicites et conserver les séquences de calcul et de comptabilisation.

### Cited Findings
- Dans Sage 300 Payroll 2026, le calcul produit les données utilisées par le registre pré-contrôle, les chèques, le registre final, les totaux de paie et les lots de grand livre; un recalcul est possible avant approbation. [About Calculate Payroll](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/AboutCalculatePayroll.htm)
- Sage conseille de revoir le registre pré-contrôle immédiatement après le calcul. Après approbation, le système met à jour les totaux à date et crée les transactions comptables; le registre final inclut les séquences de calcul/posting et détaille gains, retenues, taxes, comptes et montants. [Payroll timecards](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/AboutPayrollTimecards.htm), [Payroll Register](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Reports/Transaction/UsingthePayrollRegisterReport.htm)
- Sage 300 décrit la validation comme un seuil important : les chèques doivent être approuvés après vérification du calcul; une erreur découverte après approbation peut nécessiter l’annulation du paiement ou la restauration d’une sauvegarde. Une transaction reversée par Bank Services remonte dans Payroll pour corriger l’historique et les totaux. [Posting Payroll](https://help.sage300.com/en-us/2027/classic/Content/Payroll_Help/Payroll/AboutPostingPayroll.htm), [Reversing Checks](https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Payroll/AboutReversingChecks.htm)
- Sage 300 People met à disposition un statut de clôture de capture et un statut `Processed` par pay run; lorsque le run est traité, les écrans de détail/définition deviennent en lecture seule, et une modification influant sur le calcul nécessite une réouverture puis un recalcul. Le traitement génère un rapport de paiement. [Process a payment run](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200411085450331), [Company Rule: Stop All and Processed](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200427085414704)
- Les droits sont distincts pour les tâches de paie et les tâches EFT. Sage avertit que le contrôle au niveau employé ne remplace pas la sécurité applicative des fenêtres de paie. [Sage 300 Employee Level Security](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Security/Sage300/SettingUpEmployeeLevelSecurity.htm), [EFT security](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/AboutDirectDepositEFT.htm)

### Inferences
- QERP devrait empêcher la comptabilisation avant prévisualisation/contrôle, enregistrer auteur, horodatage, séquence et photographie des paramètres, verrouiller le cycle après approbation, et proposer une procédure explicite d’annulation/correction plutôt que modifier des lignes comptabilisées.
- Le journal d’audit d’un cycle doit être relié aux registres et à la pièce comptable pour qu’un rapprochement puisse remonter du montant au calcul et à l’employé autorisé.

### Gaps
- Les pages Sage citées concernent principalement les produits nord-américains Sage 300 Payroll (2025–2027) et Sage 300 People. Elles ne définissent pas les étapes juridiques, fiscales ou d’approbation propres aux pays OHADA de QERP.

## Comment rendre les paiements bancaires configurables et sûrs ?

### Takeaway
Sage traite le paiement bancaire comme une étape distincte du calcul et du posting de paie, avec un paramétrage dépendant des instructions de la banque, une revue des bénéficiaires et totaux, puis un fichier exportable. Les formats de fichier ne sont pas universels : ils dépendent du produit, de la banque et du pays.

### Cited Findings
- Pour Sage 300 EFT, les champs et formats de l’employeur doivent suivre le guide de la banque; les options incluent format bancaire, identifiants de l’émetteur, type/numéro de compte et routage. [Setting Up EFT Options](https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Setup/SettingUpEFTOptions.htm)
- La séquence Sage 300 est : calculer en incluant les paiements EFT, imprimer/approuver la paie, générer le fichier EFT, puis remettre ce fichier à la banque. L’accès aux paramètres EFT, aux coordonnées bancaires employé et à la création de fichiers requiert des droits spécifiques; Sage mentionne aussi l’étape de prenote avant certains paiements. [About Direct Deposit](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/AboutDirectDepositEFT.htm)
- `Create EFT File` peut générer un fichier de test avant le calcul/posting définitif et régénérer un fichier de remplacement, mais les étapes d’émission et de validation réelles demeurent après le posting. [Using Create EFT File](https://help.sage300.com/en-us/2024/classic/Content/Payroll_Help/Payroll/UsingCreateEFTFile.htm)
- Les guides Sage 300 People ACB indiquent de vérifier l’achèvement du calcul, les coordonnées bénéficiaires, le rapprochement des totaux et les rapports d’exceptions avant export. Le paramétrage d’un layout de banque demande des champs fixes (longueur, type, obligatoire) et parfois un enregistrement d’en-tête, de détail et de pied. [Export third-party payments](https://za-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?hypermediatext=null&solutionid=200303125909341), [Example bank-file layout](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=260326074433543)
- Dans un exemple de format Ecobank au Ghana, le fichier CSV exige un record d’en-tête, des détails et un pied; le template XML de la banque doit être importé avant de sélectionner le layout. Ceci illustre un format régional particulier, et non un format standard applicable ailleurs. [Sage 300 People Ghana Ecobank layout](https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=250207115212580)

### Inferences
- QERP ne doit pas émettre un « fichier bancaire générique ». Paramètres à centraliser dans Administration/Paramètres : profils versionnés par banque et pays, champs obligatoires et leurs longueurs/formats, encodage, séparateur, séquence tri, date valeur, devise, compte source, types de paiement, limites et règles d’arrondi documentées par la banque.
- Parcours recommandé : paiement uniquement depuis un cycle approuvé/comptabilisé; prévisualisation avec total par devise et contrôles des coordonnées; séparation des rôles préparation/approbation/émission; conservation du fichier, empreinte, paramètres de version et rapport; import des retours bancaires avec rejets, doublons et rapprochement idempotent.
- Les remises d’un même pay run peuvent comprendre salaires et paiements externes (ex. bénéficiaire de retenue), que Sage traite comme éléments exportés distincts. QERP devrait donc éviter de confondre le net dû au salarié avec les retenues reversées à des tiers.

### Gaps
- Le layout Ecobank trouvé est spécifique au Ghana; les pages EFT Sage 300 sont pour des formats de banque et produits particuliers. Il faut le spécimen réel de la banque de QERP avant d’implémenter ou déclarer un format conforme.
- Ces sources n’attestent pas que QERP a une connexion bancaire; elles décrivent surtout la génération et remise de fichiers, pas un règlement confirmé automatiquement par la banque.

## Quels bulletins et rapports doivent être remis avec contrôle d’accès ?

### Takeaway
Sage sépare les bulletins individuels, les rapports de paie/reconciliation et les rapports analytiques. Les filtres portent sur la société, le cycle, la période, le statut salarié, les lignes de paie et les dimensions organisationnelles; la diffusion des bulletins est soumise à des contrôles d’accès et peut offrir un PDF protégé.

### Cited Findings
- Sage 300 People permet de choisir le type de bulletin, les lignes de rémunération, les périodes courante/personnalisée, les montants à zéro, les soldes/contributions, les éléments de congés, les détails de net par compte et les paiements externes; l’utilisateur peut filtrer et trier, prévisualiser, imprimer ou exporter. [Print payslips](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200410151812476&view=print)
- La réconciliation de bulletin présente les montants de période courante et précédente, MTD et YTD par définition de paie et code fiscal, avec totaux par type (gains, retenues, etc.); elle peut filtrer entreprise, règle, employé, statut, hiérarchie et pay run. [Payslip Reconciliation](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=200611120844163&solutionid=200611120844163)
- Payroll Analysis filtre société/règle, run, statut, employé, lignes de paie, type de bulletin, congé, période et hiérarchies; le total peut être présenté globalement, MTD ou YTD puis prévisualisé, imprimé et exporté. [Payroll Analysis](https://za-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?hypermediatext=null&solutionid=200610114010027)
- Les utilisateurs de Self Service peuvent télécharger ou envoyer un bulletin par courriel; Sage documente une option de mot de passe par bulletin. La réimpression de périodes antérieures est aussi prévue avec choix période/employé. [Payslip password](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200513045002019&view=print), [Previous-period payslip](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200306075054360&view=print)
- Sage 300 Payroll masque par défaut une partie des identifiants sensibles sur le registre, avec option de les afficher; la documentation de sécurité signale des permissions particulières pour EFT et le traitement des chèques. [Payroll Register](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Reports/Transaction/UsingthePayrollRegisterReport.htm), [EFT security](https://help.sage300.com/en-us/2026/classic/Content/Payroll_Help/Payroll/AboutDirectDepositEFT.htm)

### Inferences
- Avant réception, QERP devrait offrir au minimum : bulletin individuel par employé/période; réédition historique avec journal d’accès; registre de cycle détaillé et résumé; réconciliation par composante de paie et comparatif période précédente/MTD/YTD; analyse filtrable par société, cycle, département/section, employé et type de rémunération.
- Un export en lot doit employer les filtres visibles, masquer les champs sensibles sans droit, séparer les devises et générer une trace. Un bulletin PDF individuel ne doit pas être téléchargeable par simple filtrage de l’interface si l’API/RLS n’autorise pas cet employé et ce montant.
- Les paramètres de mise en page, langue, date imprimée, éléments inclus et disposition peuvent être configurables; les totaux et libellés doivent toutefois venir des lignes réellement calculées et persistées, pas d’une présentation qui reconstruit des données non stockées.

### Gaps
- Les sources Sage décrivent des options d’interface et de rapports pour diverses versions/régions; elles ne fournissent pas un gabarit universel de bulletin ni un format d’export légal pour tous les pays.
- La génération « mot de passe PDF » est une option de produit citée; on ne peut pas en déduire qu’elle convient au modèle de sécurité QERP. Il faut privilégier droits serveur, RLS, diffusion authentifiée et journalisation; n’ajouter le chiffrement PDF qu’avec une politique de clés et de récupération validée.

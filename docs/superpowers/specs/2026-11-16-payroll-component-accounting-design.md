# Comptabilisation par rubrique de paie

## Intention

Le compte général saisi dans une rubrique doit piloter l’écriture comptable produite lors de la comptabilisation du cycle. Les écritures restent équilibrées, tenant-scoped, dérivées de la photographie calculée, et compatibles avec les anciens cycles sans compte par rubrique.

## Approche retenue

Les lignes de gains et de charges employeur débitent leur compte actif de rubrique lorsqu’il est renseigné. Les lignes de retenues créditent leur compte actif de rubrique. Sans compte spécifique, le rôle comptable de paie existant est utilisé. Le salaire de base, les cotisations légales et l’impôt continuent d’utiliser les rôles globaux configurés. La nature du compte de retenue n’est pas forcée à « dette » : une retenue de remboursement peut créditer une créance. Le code, le tenant, l’activité et l’imputabilité du compte sont contrôlés.

L’autre option considérée était de conserver uniquement les rôles globaux et de réserver `gl_account_code` à l’affichage. Elle ne satisfait pas l’attente du paramètre par rubrique. Une deuxième table de correspondance inspirée des comptes symboliques SAP séparerait la rubrique de la comptabilité, mais serait un changement fonctionnel plus large que le modèle déjà configuré ; elle reste hors de ce lot.

## Contraintes

- Les comptes doivent être actifs, imputables et appartenir au tenant du cycle.
- Les codes de compte proviennent de `definition_snapshot`, jamais de la définition courante après calcul.
- Le précontrôle signale un compte de rubrique absent, inactif, d’un autre tenant ou non imputable avant approbation.
- L’écriture comptable utilise les mêmes résolutions que le précontrôle et échoue de façon atomique si le paramétrage a changé entre les deux étapes.
- Les anciens cycles sans lignes détaillées gardent l’écriture agrégée historique.
- Les migrations Flyway et Supabase restent des jumelles identiques.

## Hors périmètre

Le paiement bancaire des salaires, la création de nouvelles classes de comptes, les paramètres légaux des pays et le déploiement sur les bases métier ne font pas partie de cette modification.

## Références

- SAP explique que les types de rubrique déterminent les comptes de charge ou de dette et que les contributions employeur peuvent alimenter les deux côtés : https://help.sap.com/docs/ERP_HCM_SPV/e09772d353c6445c8cef2d8cbff5c0b0/9018dd5321e8424de10000000a174cb4.html?locale=en-US
- Sage 300 demande un compte général pour chaque code de gain ou de retenue : https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Setup/AddinganEarningorDeductionCode.htm
- QERP photographie déjà le compte du composant dans `payroll_component_lines.definition_snapshot`.

# G-21 — Première tranche : tableau des flux de trésorerie

Le bilan, le résultat et les SIG utilisent le grand livre via `financial_statement` et `report_compute` (V63). Ce dernier agrège le solde par compte avant de le rattacher à une rubrique. Ce mécanisme convient aux états de soldes, mais ne conserve ni la contrepartie ni le détail d'une écriture mixte pour distinguer les flux.

Deux bases sont possibles : les transactions bancaires donnent une vue opérationnelle des mouvements importés, alors que le grand livre permet de rapprocher le tableau du bilan et de couvrir les comptes de trésorerie au-delà des relevés. Retenir le grand livre et une requête dédiée au TFT, avec un périmètre de trésorerie et des règles de classement paramétrables par société. Rapprocher les soldes d'ouverture et de clôture avec les rubriques correspondantes du bilan. Valider la présentation et les règles de classement avec le référent comptable avant de considérer l'état comme publiable.

La première tranche doit restituer l'exercice sélectionné, son comparatif et les flux d'exploitation, d'investissement et de financement. Les virements entre comptes du périmètre ne font pas varier sa trésorerie nette. Une contrepartie ambiguë ou une écriture mixte sans ventilation fiable doit rester visible dans les contrôles, sans classement par défaut. L'état signale tout écart entre la variation des soldes et les flux expliqués.

Critères de recette : isolation entre sociétés ; exclusion des brouillons ; prise en compte de la contrepassation dans sa période ; exercice non civil ; neutralité des virements internes et des écritures d'ouverture dans les flux ; écritures mixtes non ventilables signalées ; cohérence des soldes et continuité entre deux exercices. Les notes annexes et le mécanisme de clôture annuelle restent des tranches distinctes.

Intégration : poursuivre sur une base séparée du chantier Paie/RH. Réserver le numéro de migration avec l'autre session avant d'écrire la migration et reprendre les comparatifs existants avant de modifier `FinancialStatementPanel.tsx`.

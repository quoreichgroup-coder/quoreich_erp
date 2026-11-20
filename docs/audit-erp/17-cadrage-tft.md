# G-21 — Première tranche : tableau des flux de trésorerie

Le bilan, le résultat et les SIG utilisent le grand livre via `financial_statement` et `report_compute` (V63). Ce dernier agrège le solde par compte avant de le rattacher à une rubrique. Ce mécanisme convient aux états de soldes, mais ne conserve ni la contrepartie ni le détail d'une écriture mixte pour distinguer les flux.

Deux bases sont possibles : les transactions bancaires donnent une vue opérationnelle des mouvements importés, alors que le grand livre permet de rapprocher le tableau du bilan et de couvrir les comptes de trésorerie au-delà des relevés. Retenir le grand livre et une requête dédiée au TFT, avec un périmètre de trésorerie et des règles de classement paramétrables par société. Rapprocher les soldes d'ouverture et de clôture avec les rubriques correspondantes du bilan. Valider la présentation et les règles de classement avec le référent comptable avant de considérer l'état comme publiable.

La première tranche doit restituer l'exercice sélectionné, son comparatif et les flux d'exploitation, d'investissement et de financement. Les virements entre comptes du périmètre ne font pas varier sa trésorerie nette. Une contrepartie ambiguë ou une écriture mixte sans ventilation fiable doit rester visible dans les contrôles, sans classement par défaut. L'état signale tout écart entre la variation des soldes et les flux expliqués.

Critères de recette : isolation entre sociétés ; exclusion des brouillons ; prise en compte de la contrepassation dans sa période ; exercice non civil ; neutralité des virements internes et des écritures d'ouverture dans les flux ; écritures mixtes non ventilables signalées ; cohérence des soldes et continuité entre deux exercices. Les notes annexes et le mécanisme de clôture annuelle restent des tranches distinctes.

Intégration : poursuivre sur une base séparée du chantier Paie/RH. Réserver le numéro de migration avec l'autre session avant d'écrire la migration et reprendre les comparatifs existants avant de modifier `FinancialStatementPanel.tsx`.

## Réalisation (V122, 20 nov. 2026)

- **Méthode retenue** : grand livre, sans deviner de contrepartie. Par la partie double, la variation de la trésorerie
  nette du périmètre est égale à la somme crédit − débit des mouvements de tous les autres comptes. Chaque mouvement
  (compte × sens) est rangé dans une rubrique par la règle au préfixe le plus long (`report_line_rules` du modèle
  `TFT_SYSCOHADA`, `balance_side` = sens du mouvement). Une écriture mixte n'a donc pas besoin d'être ventilée : chacune de
  ses lignes est classée par son propre compte.
- **Périmètre** : rubrique ZA, classe 5 par défaut ; une société y place un autre compte par une exception
  (`tenant_report_line_accounts`, ligne ZA). Les virements internes au périmètre sont neutres par construction.
- **Rubriques** : ZA, FA (CAFG = charges et produits hors éléments calculés), FB–FE (BFR), FF–FJ (investissement,
  dettes et créances sur immobilisations dans la rubrique pour obtenir le décaissement / encaissement réel), FK–FN, FO–FQ,
  totaux ZB, ZC, ZD, ZE, ZF, ZG, ZH.
- **Contrôles** : ZK trésorerie au bilan, ZN opérations sans effet de trésorerie (dotations / amortissements, sortie et
  VNC des immobilisations cédées, provisions, quote-part de subvention), ZU non classés, ZX = ZH − ZK = −(ZN + ZU).
  L'écran détaille par compte et par sens tout ce qui rend ZN ou ZU non nul.
- **Critères de recette** couverts par `TableauFluxTresorerieIT` : chaque rubrique sur un jeu connu, brouillon exclu,
  virement interne neutre, écart nul, mouvement déclassé visible, continuité avec la période suivante, refus pour une
  autre société. L'écriture de détermination du résultat (V121) est hors flux ; la contre-passation compte dans sa
  période (date de l'écriture inverse).
- **Données réelles (copie locale)** : écart nul pour les trois sociétés. Pour ROXGOLD SANGO, les ventes passées sur
  4000 (ancien plan, écart G-27) tombent dans « variation du passif circulant » au lieu de la CAFG : le total reste juste,
  le classement sera correct après le reclassement décidé par l'expert-comptable.
- **À valider par l'expert-comptable** : affectation de 481 / 485 (ici dans l'investissement, au décaissement réel ;
  le modèle officiel peut les rattacher au BFR HAO), des comptes 42–47 mixtes, des capitaux propres (incorporation de
  réserves au capital).
- **Restent** : notes annexes (tranche suivante).


# Recette des inventaires physiques S3

À exécuter sur une société de recette, avec un dépôt pouvant être gelé. L’ouverture bloque les mouvements du dépôt jusqu’à validation ou annulation.

1. **Préparer les accès.** Prévoir deux utilisateurs habilités à compter et un troisième habilité à valider. Donner le droit d’export seulement aux profils prévus. Le valideur ne saisit aucune quantité de la campagne.
2. **Paramétrer.** Dans **Stocks → Paramètres → Inventaires**, choisir le dépôt proposé et les articles à inclure, puis renseigner au moins un seuil de recomptage. Un seuil laissé vide est désactivé ; zéro est une règle explicite. Dans **Documents**, renseigner la série si une référence métier est souhaitée. Dans **Comptabilité**, vérifier le mode de stock et les comptes par rôle.
3. **Compter.** Dans **Transactions → Inventaires physiques**, vérifier le nombre d’articles proposé et ouvrir la campagne. Télécharger la feuille Excel, saisir les quantités, importer et confirmer. Un zéro doit être conservé ; une cellule vide reste à traiter. Vérifier qu’un autre opérateur ne peut ni voir la quantité enregistrée dans la feuille, ni la remplacer. L’import contrôle aussi que le code et l’unité correspondent à l’identifiant article.
4. **Contrôler.** Soumettre la campagne. Dans **Contrôle des inventaires**, consulter les écarts, demander le recomptage des lignes signalées et les faire recompter par un autre opérateur. Le second compteur utilise sa propre feuille, sans premier résultat ni stock théorique.
5. **Valider.** Confirmer l’ajustement. Une campagne validée libère son dépôt ; vérifier les quantités, le lien du mouvement vers sa campagne et, en mode permanent, le numéro de pièce comptable. Un article sans écart ne produit pas de mouvement. Si la période est fermée ou qu’une unité a changé depuis l’ouverture, la campagne doit rester soumise et le dépôt gelé.
6. **Suivre.** Dans **Catalogue des campagnes**, filtrer sur le dépôt et vérifier la référence, les dates, l’avancement et l’historique. L’Excel reprend toutes les pages filtrées. Pour le référentiel des produits, utiliser **Données de base → Articles → Exporter Excel**.

Une annulation exige un motif et libère le dépôt sans ajustement. Pour reproduire les contrôles SQL et de concurrence sur un PostgreSQL jetable, lancer `./scripts/schema/verify-inventory-campaign.ps1`. Voir aussi le [cadrage et les références ERP](audit-erp/18-campagnes-inventaire.md).

**Stock global sans dépôt (V100).** Un inventaire ne répartit pas un solde global entre dépôts. Lorsqu’un article présente déjà un reliquat non affecté, un ajustement positif est bloqué : la campagne reste soumise et aucun mouvement n’est généré. Rapprocher les quantités et leur affectation avant de valider. Ce contrôle a été reproduit à partir de la configuration du stock de la copie locale de ROXGOLD SANGO : un dépôt, cinq articles actifs, dont trois avec un solde global positif, aucune localisation. Dans cette configuration, l’aperçu du dépôt et l’analyse ABC ne trouvent aucun article. Le périmètre « Tous les articles actifs » permet de préparer la feuille, mais il ne remplace pas le rapprochement des soldes. Aucun ajustement n’a été passé sur la copie source ni sur la société en ligne.

Pour rejouer les parcours navigateur : `npm run test:e2e -- tests/e2e/inventory-campaign.spec.ts`. Les appels Supabase sont simulés. Le scénario ABC vérifie que, pour le même dépôt, le rapport Stock et le tournant affichent la base configurée, la même classe pour un article et le même nombre d’articles à échéance. Les contrôles de droits, de gel, de concurrence et de comptabilisation en base sont couverts séparément par la recette PostgreSQL.

Pour tester les RPC sans simulation dans Chromium, utiliser le banc local PostgreSQL/PostgREST :

```powershell
docker pull ghcr.io/supabase/postgrest:v14.18
./scripts/e2e/verify-stock-postgres.ps1
```

Il crée une base jetable avec les migrations Flyway, des identités de test distinctes et des articles fictifs. Les requêtes REST passent par PostgREST avec les rôles SQL réels. La connexion Supabase Auth et le service Realtime sont remplacés localement pour ce parcours. Le script vérifie ensuite, depuis une autre session SQL, les comptages, la validation, le mouvement et les soldes réellement enregistrés. L’option `-StockOnly` rejoue le même test sur V1 à V79 plus V91, V92, V93, V94, V96 et V100 pour vérifier les dépendances Stock sans les migrations Paie/RH. Cette option ne déploie rien.

Dans **Stocks → Rapports**, vérifier les onglets **Valorisation**, **Rotation et vieillissement**, **Analyse ABC**, **Clôtures** et **Historique des exports**. L’onglet actif reste sélectionné après rechargement. Dans **Clôtures**, tester les filtres, les exports CSV/PDF et l’annulation. Depuis **Historique des exports**, **Retenter** rouvre les clôtures et relance l’export avec ses filtres enregistrés. Ces parcours se rejouent avec `npm run test:e2e -- tests/e2e/inventory-export.spec.ts tests/e2e/inventory-export-cancel.spec.ts`.

Pour le parcours **connecté à ROXGOLD SANGO**, démarrer QERP sur `http://localhost:8081`, puis lancer sous PowerShell :

```powershell
$env:E2E_ROXGOLD_INTERACTIVE = '1'
npx.cmd playwright test --config playwright.roxgold.config.ts
```

Dans la fenêtre **Google Chrome for Testing**, ouvrir une session puis sélectionner **ROXGOLD SANGO**. Le parcours attend jusqu’à dix minutes que la société s’affiche. Il couvre les articles, le catalogue des campagnes, le périmètre d’un dépôt et le rapport ABC sans effectuer de saisie ni geler de dépôt. Le test ne prend ni capture d’écran, ni vidéo, ni trace, et n’enregistre pas la session interactive.

Pour vérifier les écrans S3 sur la base connectée avec le compte de recette du dépôt, lancer `npx playwright test --config playwright.parcours.config.ts --project=lecture-stock`. Ce parcours vérifie **E2E QUOREICH (société de test)** avant de consulter le catalogue, l’aperçu du dépôt et l’ABC. Il ne crée aucun comptage et ne nécessite pas de compte approbateur. La base connectée doit exposer `inventory_campaign` (V91), `inventory_campaign_catalog` et l’aperçu (V94), ainsi que `inventory_cycle_analysis` (V96). Une fonction absente du cache de schéma Supabase constitue un échec de la recette connectée, même lorsque la recette PostgreSQL locale réussit.

Pour le **tournant ABC**, enregistrer une règle dans **Paramètres → Inventaires**. Dans **Stocks → Rapports**, choisir le dépôt dans l’analyse ABC, puis cliquer sur **Préparer le tournant** avec un profil habilité au comptage. Vérifier que le dépôt est repris, y compris après rechargement, et que l’aperçu classe les articles à échéance sans geler le dépôt. Le dépôt peut aussi être choisi directement dans **Transactions → Tournant ABC**. Si la règle ou la sélection change avant confirmation, actualiser le plan ; une proposition obsolète ne s’ouvre pas. Après une validation, vérifier que les mêmes articles ne sont pas de nouveau proposés avant leur échéance.

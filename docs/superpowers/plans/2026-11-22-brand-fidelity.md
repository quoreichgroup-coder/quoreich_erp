# Priorité : application visible de la charte

L’utilisateur signale que le rendu ne semble pas reprendre sa charte. Le lot Avoirs/Crédits, encore au stade de lecture, passe après cette correction du socle visuel.

**Source :** `docs/charte graphique.pdf`, quatre pages : logo de la société mère, bleu #0062db, orange #ff8a51, Montserrat et Playfair Display. La charte ne décrit pas les composants de l’ERP ni une affectation exhaustive des polices.

**Choix d’application :** Montserrat pour navigation, données et contrôles ; Playfair Display pour titres principaux. Bleu de marque visible dans la navigation et les titres ; orange en accent de rubrique et de navigation active. Le logo du produit reste QERP ; celui de QUOREICH GROUP reste l’identité de la société mère. Présentation sobre et dense pour les données. Les variantes sombres gardent une adaptation lisible.

- [x] Vérifier le document et les écarts réellement présents dans le code/rendu.
- [x] Livrer les deux polices localement, avec leurs licences, pour éviter une dépendance à Google Fonts au chargement.
- [x] Appliquer les choix aux styles globaux, titres partagés, navigation et accueil ; garder la société active identifiable sur mobile.
- [x] Vérifier une même page avant/après sur téléphone et bureau, les deux thèmes, les polices réellement chargées hors réseau, les contrastes et la navigation au clavier.
- [x] Revue indépendante et contrôles de non-régression appropriés ; mettre à jour les conventions.

Aucun changement de données, droits, requêtes, calculs ou actions métier. Les styles fonctionnels responsive déjà validés restent en place.

## Constat et correction

La comparaison navigateur avant modification confirme un titre principal en Montserrat, une navigation bleu nuit et l'absence d'accent orange dans l'en-tête partagé. Les valeurs de la palette et la famille Playfair existaient dans les jetons, mais leur présence dans la configuration ne suffisait pas à appliquer la charte aux écrans.

Le socle affiche maintenant les titres principaux en Playfair bleu, les en-têtes partagés avec un repère orange et la navigation claire en bleu de marque. Les liens restent lisibles au repos, au survol et au clavier. Le logo produit garde ses couleurs dans le menu ; la barre mobile présente QERP et le nom de la société active. Les deux familles sont hébergées localement, avec sources et licences vérifiables.

La vérification au clavier a aussi révélé un retour de focus manquant après fermeture du menu mobile contrôlé. La référence de son bouton est maintenant partagée dans le contexte du menu et restituée explicitement à la fermeture du Sheet.

Les captures et journaux de ce lot se trouvent dans `output/brand-fidelity/`. Les captures initiales sont conservées dans `before/`, indépendamment des résultats de tests.

Les contrastes ont été renforcés jusqu'aux états de survol et de focus dans les deux thèmes. Le survol de CRM produisait transitoirement un ratio de 3,11:1 à cause d'une animation simultanée du texte et du fond. Les inversions de ces couleurs sont maintenant immédiates, et le test exige au moins 4,5:1 dans chaque état vérifié. Les animations de dimensions et de chevrons restent présentes.

## Validation finale

40 scénarios navigateur réussis sur les six suites design/responsive, puis les 3 scénarios charte renforcés repassés après les derniers ajustements. Suite unitaire complète : 129 fichiers et 729 tests réussis, sortie 0. TypeScript, ESLint ciblé et compilation finale : sortie 0 ; avertissement Fast Refresh existant de `ui/sidebar.tsx`. Revue indépendante initiale et du delta final : aucun blocage confirmé.

Les configurations temporaires de contrôle utilisent la transformation intégrée de Vite pour contourner le binaire SWC bloqué par les permissions locales ; les configurations du projet ne sont pas modifiées. Les scénarios utilisent des données simulées, et aucun déploiement n'a été réalisé. Voir `output/brand-fidelity/progress.md` pour les journaux et captures.

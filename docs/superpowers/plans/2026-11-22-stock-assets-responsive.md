# Design system — stocks et immobilisations

Continuation autorisée de la charte et des composants partagés existants.

**Périmètre :** les trois listes de mouvements de stock (ensemble, transferts, ajustements) et la liste des mouvements d’immobilisations ; en-têtes, filtres, formulaires d’ajustement/transfert, contre-passation du dernier calcul d’amortissements.

**Approche :** réutiliser `Table.mobileColumns` sans dupliquer les lignes. Conserver le tri, la pagination, les exports, les droits et le masquage des montants. Utiliser `PageHeader`, des filtres nommés et des champs sur une colonne sur téléphone. Remplacer le seul `window.prompt` de contre-passation par un dialogue du design system, avec motif obligatoire et retour de focus. Le calcul des dotations garde son déclenchement et sa portée actuels.

- [x] Sauvegarder les deux pages et observer l’échec du rendu mobile avant modification.
- [x] Migrer les quatre listes ; garder les valeurs longues entières en cartes et lisibles en tableau.
- [x] Harmoniser en-têtes et filtres ; adapter les formulaires de stock et leur retour de focus.
- [x] Intégrer le dialogue de contre-passation sans modifier le droit requis ni le paramètre envoyé à la mutation.
- [x] Vérifier les largeurs 320/390/767/768/1024/1440 px, tri, pagination, sélection, exports, états vides, montants masqués et redimensionnement.
- [x] Faire une revue indépendante, exécuter les contrôles adaptés et actualiser les conventions/preuves.

**Contraintes :** aucun changement de hook, requête, formule comptable, clé de cache, mutation backend, permission ou portée d’export. Aucun montant masqué ne doit réapparaître dans une légende ou un attribut HTML. Les campagnes d’inventaire et les historiques comptables restent dans leurs composants actuels. Conserver les modifications antérieures du checkout ; aucun commit ni déploiement demandé.

# Design system et responsive — comptes clients et fournisseurs

Continuation autorisée du design system existant, sans nouvelle direction graphique.

**Périmètre :** six listes (factures clients, encaissements, factures fournisseurs, paiements fournisseurs, factures à approuver et décisions d’approbation), en-têtes partagés, formulaires de facture et panneaux de consultation.

**Architecture :** réutiliser `Table.mobileColumns` avec un seul arbre de lignes, les mêmes données et actions ; conserver les filtres et exports. Réutiliser `PageHeader`. Remplacer uniquement l’enveloppe manuelle des panneaux de facture par une `Sheet` Radix nommée, avec fermeture Échap, focus contenu et retour explicite au bouton de référence. Conserver les lignes détaillées à défilement local. Le passage du panneau au règlement doit donner le focus au règlement, puis revenir à la référence après fermeture.

- [x] Sauvegarder l’état initial et écrire les régressions navigateur sur données non vides ; observer les échecs avant migration.
- [x] Migrer les six listes, avec légendes neutres de devise, références accessibles et sélection conservée.
- [x] Appliquer les en-têtes et les grilles de formulaire mobiles ; assurer le focus des dialogues de création, d’annulation et de règlement concernés.
- [x] Remplacer les deux enveloppes de consultation par le composant partagé, sans modifier leur contenu ni leurs actions.
- [x] Vérifier 320/390/767/768/1024/1440 px, textes longs, états vides, recherche, exports, droits, sélection et redimensionnement ; vérifier les transitions de focus.
- [x] Faire relire le diff ; lancer les tests utiles, le typage, le lint et la compilation ; actualiser les conventions et les preuves.

**Contraintes :** préserver les changements antérieurs du checkout. Aucune modification de hook, RPC, requête, permission, calcul, mutation ou portée d’export. Aucune nouvelle dépendance. Les avoirs/crédits et l’historique comptable gardent leurs composants actuels ; leur migration éventuelle constitue un lot suivant.

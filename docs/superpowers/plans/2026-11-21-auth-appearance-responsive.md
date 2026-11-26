# Connexion, inscription et préférences d’apparence

Suite autorisée du design system. L’utilisateur a demandé des interfaces simples et professionnelles et confirmé le choix d’apparence pour **les deux** : l’accueil et l’application.

**Décisions d’implémentation :** conserver React, Tailwind et Radix ; utiliser `next-themes`, déjà installé. Le thème clair/sombre/système s’applique à toute l’application. Les présentations Essentiel (formulaire centré, par défaut) et Entreprise (panneau de présentation sur grand écran) partagent le même formulaire. Les préférences sont locales à l’appareil. Les couleurs et polices restent celles de la charte QUOREICH ; le logo est celui de QERP.

L’alternative de plusieurs palettes arbitraires ferait diverger la charte. Dupliquer les formulaires rendrait leurs validations et leur état incohérents. Un seul formulaire et des jetons sémantiques conviennent au besoin exprimé.

- [x] Tester les appels d’authentification, les erreurs et la conservation des champs pendant un changement d’apparence.
- [x] Ajouter les préférences partagées et leur accès depuis l’accueil et le menu utilisateur.
- [x] Simplifier connexion/inscription/mot de passe oublié et harmoniser la réinitialisation.
- [x] Vérifier clavier, focus, petits écrans, paysages, zoom et thèmes.
- [x] Vérifier typage, lint, tests ciblés, régressions des listes et compilation ; faire relire le diff.

Ne modifier ni les règles d’accès, ni les requêtes métier, ni la gestion de session. Ne pas conserver de mot de passe dans les préférences. Aucune nouvelle dépendance.

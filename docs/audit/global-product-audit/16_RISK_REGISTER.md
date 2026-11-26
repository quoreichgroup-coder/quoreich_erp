# 16 — Registre des risques

Probabilité (P) et impact (I) de 1 à 5 ; criticité = P × I.

| Id | Risque | P | I | Crit. | Mitigation | Lien |
|---|---|---:|---:|---:|---|---|
| R-01 | **Perte de données** : aucune sauvegarde organisée ni restauration testée | 3 | 5 | 15 | Sauvegardes chiffrées hors site + restauration chronométrée (P0) | 12, B-01 |
| R-02 | Les parcours de test écrivent dans le **projet Supabase de production** (société de test) ; une erreur de script ou de migration touche la production | 3 | 4 | 12 | Projet de recette séparé | 12, B-03 |
| R-03 | États financiers ou modèle de clôture non conformes à l'avis d'un expert-comptable / commissaire aux comptes | 3 | 4 | 12 | Validation externe avant pilote | 03, B-05 |
| R-04 | Paie utilisée avec des barèmes erronés (aucun barème saisi, aucun bulletin de comparaison) | 2 | 5 | 10 | Saisie sourcée, comparaison à un bulletin de cabinet, paie hors MVP jusque-là | 03 |
| R-05 | Exposition Internet sans limitation de débit ni MFA (force brute, abus de l'IA) | 3 | 4 | 12 | Limiteur, MFA administrateurs, pentest | 06, B-07/B-08 |
| R-06 | Données financières envoyées à un fournisseur d'IA externe sans activation par société | 4 | 3 | 12 | AUD-04 : désactivé par défaut, minimisation | 10, B-09 |
| R-07 | **Dispersion** : modules en aperçu (mobile, maintenance, arrêts, production, IA) ouverts en même temps que la stabilisation, avec une petite équipe | 4 | 4 | 16 | Séquencer : exploitation et socle d'abord ; périmètres réduits ; spécifications avant code | 14, 18 |
| R-08 | Dépendance à une personne / un agent de développement : connaissance concentrée, logique dense en PL/pgSQL | 4 | 4 | 16 | Recrutement, documentation d'architecture, revue de code humaine | 02 |
| R-09 | `main` non protégée : régressions fusionnées avec une CI rouge (cas constaté : 6 jours) | 4 | 3 | 12 | Protection de branche | 11, B-02 |
| R-10 | Performances inconnues sous volume réel (328 FK sans index, aucun test de charge) | 3 | 3 | 9 | Jeu volumineux, mesures, index | 05, B-14 |
| R-11 | Blocage des approbations en cas d'absence (pas de délégation) | 4 | 3 | 12 | Délégation datée | 03, B-10 |
| R-12 | Spécifications maintenance / arrêts et D-01..D-03 indisponibles : construction sur hypothèses | 4 | 3 | 12 | Fournir et statuer avant code | 09 |
| R-13 | Licences non appliquées côté serveur (activation contournable) | 2 | 3 | 6 | Contrôle côté serveur quand l'offre est fixée | 15 |
| R-14 | Hébergement du front encore chez Lovable | 3 | 3 | 9 | Bascule vers un hébergement maîtrisé | 12 |
| R-15 | Conformité protection des données (CIL Burkina Faso, données de paie hors du pays) | 3 | 4 | 12 | Registre des traitements, avis juridique | 06 |

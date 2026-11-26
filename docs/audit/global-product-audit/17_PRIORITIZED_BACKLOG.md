# 17 — Backlog priorisé

> Efforts en **jours-homme (j·h)**, hypothèse : un développeur expérimenté sur la pile, assisté d'outils IA, plus les
> intervenants externes indiqués. Les dates dépendent des ressources réelles, non connues.

| Id | Prio | Module | Besoin / anomalie | Preuve | Correction | Effort | Version | Acceptation |
|---|---|---|---|---|---|---:|---|---|
| B-01 | **P0** | Exploitation | Aucune sauvegarde / restauration | EV-25 | Sauvegarde chiffrée hors site (base, fichiers, clé de signature), restauration automatisée et chronométrée ; fixer RPO / RTO (DEC-08) | 8 | MVP | Restauration complète d'une copie en moins du RTO fixé |
| B-02 | P1 | CI | `main` non protégée | EV-26 | Protection de branche : CI verte obligatoire | 0,5 | MVP | Fusion refusée si un job est rouge |
| B-03 | P1 | Exploitation | Pas d'environnement de recette ; tests dans le projet de production | EV-16 | Projet Supabase de recette + base de recette sur site ; parcours redirigés | 4 | MVP | Aucun parcours n'écrit en production |
| B-04 | P1 | Exploitation | Pas de production sur VPS (lot 1) | EV-14 | Compose de production, Caddy / TLS, rôle `qerp_migrate`, pare-feu, supervision Prometheus + alertes | 15 | MVP | Installation reproductible depuis un document ; alertes reçues |
| B-05 | P1 | Finance | États, TFT, notes, clôture non validés | 03 | Revue par un expert-comptable ; corrections éventuelles ; G-27 | 10 + externe | MVP | Procès-verbal de validation |
| B-06 | P1 | Sécurité | Fonctions SECURITY DEFINER exécutables par `anon` | EV-17 | AUD-02 : migration jumelle + test | 2 | MVP | Test vert ; conseiller Supabase sans alerte `anon` |
| B-07 | P1 | Sécurité | Pas de limitation de débit | EV-21 | Limiteur (proxy ou filtre) sur connexion, inscription, webhook, IA | 3 | MVP | 429 au-delà du seuil |
| B-08 | P1 | Sécurité | Pas de MFA | 06 | TOTP pour administrateurs et approbateurs | 6 | MVP | Connexion admin impossible sans second facteur |
| B-09 | P1 | IA | Pas d'activation par société, données en clair | EV-23 | AUD-04 : paramètre + droit, minimisation, journal | 4 | MVP | Société non activée : zéro appel externe |
| B-10 | P1 | Workflows | Pas de délégation ; écran `workflow_rules` sans effet | EV-12 | Délégation datée par approbateur ; retirer ou brancher l'écran | 8 | MVP | Suppléant approuve pendant l'absence, piste d'audit |
| B-11 | P1 | Administration | Lecteur sans aucun droit sur site | AUD-01 | Droits `<module>.view` | 4 | MVP | Lecteur consulte sans pouvoir écrire |
| B-12 | P1 | Qualité | Parcours non rejoués ; pas de recette | 11 | Rejouer nuage + sur site en recette ; campagne UAT avec PV | 8 | MVP | 100 % des parcours MUST verts ; PV signés |
| B-13 | P1 | Commercial | Documentation utilisateur, reprise de données | 15 | Guides par processus MUST ; procédure de reprise des soldes | 15 | MVP | Pilote autonome ; reprise réussie |
| B-14 | P2 | Base | 328 FK sans index ; aucun test de charge | EV-15 | Jeu volumineux, mesures, index ciblés | 6 | Pilot | Écrans clés < 2 s sur 5 ans de données |
| B-15 | P1 | Mobile (aperçu) | Aucune application | 08 | DEC-09 ; file d'approbations transverse ; app V1 (approbations, congés, notes de frais, cockpit) | 35 | MVP (aperçu) | Approbation depuis le téléphone avec les mêmes règles |
| B-16 | P1 | Maintenance (aperçu) | Inexistant | 09 | Spécification ; équipements, OT correctifs, pièces, temps, coûts, préventif calendaire | 30 | MVP (aperçu) | Voir 14 |
| B-17 | P1 | Arrêts (aperçu) | Inexistant | 09 | D-01..D-03 ; déclaration, causes, chevauchements, MTTR / MTBF / disponibilité, Pareto | 15 | MVP (aperçu) | Voir 14 |
| B-18 | P1 | Production (aperçu) | Inexistant | 14 | Nomenclature simple, ordre de fabrication, coût de revient | 20 | MVP (aperçu) | Voir 14 |
| B-19 | P2 | Paie | Barèmes BF, déclarations CNSS / IUTS | 03 | Saisie sourcée ; états déclaratifs | 15 + externe | Pilot | Mois réel identique au cabinet |
| B-20 | P2 | Fiscalité | Déclaration de TVA, état des retenues télédéclarable | 03 | États déclaratifs paramétrables | 10 | Pilot | Déclaration d'un mois réel validée |
| B-21 | P2 | Ventes | Relances SMTP non déployées ; impression PDF cloud | EV-14 | Déployer fonctions et secrets, hôte de rendu | 3 | Pilot | Relance reçue ; facture PDF archivée |
| B-22 | P2 | Stocks | Réservation ferme, lots / séries / péremption | G-34, G-49 | Réservation à la commande ; traçabilité | 15 | Stable | — |
| B-23 | P2 | UX | 190 couleurs directes, a11y, tests utilisateurs | EV-22 | Jetons sémantiques, axe en CI, sessions utilisateurs | 8 | Stable | 0 classe de palette directe ; axe sans erreur grave |
| B-24 | P2 | Sécurité | Pentest, en-têtes HTTP, `zod` | 06 | Prestataire ; CSP / HSTS ; montée de version | 3 + externe | Stable | Rapport sans écart élevé |
| B-25 | P2 | Commercial | Licences non appliquées côté serveur ; export complet ; CGU / contrats | 15 | Contrôle serveur ; export de société ; documents juridiques | 8 + externe | Stable | — |
| B-29 | P1 | Commercial | **Autorité de licences** (AUD-06) : licences signées, vérifiées côté serveur (nuage et sur site, hors ligne), modules non licenciés refusés | EV-27 | Table et fonctions de licences signées (clé privée hors base, clé publique dans l'API et la base) ; garde dans l'intercepteur d'accès aux modules et dans `has_permission` ; écran d'émission réservé à QUOREICH ; période de grâce | 12 | MVP | Un module non licencié est refusé par l'API et la base ; une licence altérée est rejetée |
| B-26 | P3 | Architecture | Types Supabase non régénérés ; double chemin de données | 02 | Régénération ; couche d'accès commune | 10 | Stable | `tsc` sans `as any` sur les tables métier |
| B-27 | P4 | International | i18n | 02 | Mise en œuvre du cadrage `docs/i18n` | 30 | Enterprise | — |
| B-28 | P4 | IA | Agents (lecture puis brouillons validés) | 10 | Couche d'outils sur les fonctions existantes ; évaluation | 40 | 2.0+ | Jeux d'évaluation réussis |

**Total MVP (B-01 à B-18 sauf B-14, plus B-29, hors externes)** : ≈ 200 j·h (99,5 socle dont 12 pour l'autorité de
licences + 100 modules en aperçu). Avec un seul développeur (≈ 21 j·h par mois), compter **environ 9 à 10 mois** ; à
deux, environ la moitié, sous réserve des validations externes.

## Plan 30 / 60 / 90 / 180 jours (ordre, pas dates)

| Horizon | Contenu |
|---|---|
| 30 j | B-02, B-01, B-03, B-06, B-07, B-11 ; fusion de la PR #1 ; lancer B-05 (expert-comptable) ; obtenir spécifications et DEC-09 |
| 60 j | B-04, B-08, B-09, B-10 ; démarrer B-15 (mobile) ; spécifier B-16 / B-17 |
| 90 j | B-12, B-13 ; B-16, B-17 en aperçu ; recette interne complète |
| 180 j | B-18 ; pilote(s) en production ; B-19 à B-21 selon le pilote |

# 15 — Préparation commerciale

> Phase 6. Aucun prix ni coût inventé : les montants sont à établir avec des hypothèses validées par QUOREICH GROUP.

## 1. Constat

| Élément (§35) | État | Commentaire |
|---|---|---|
| Création de société | Fait | Inscription → `/onboarding` → société ; rejoindre une société par invitation à usage unique (V31) |
| Paramétrage initial | Fait | Référentiel SYSCOHADA appliqué en une action, rôles de comptabilisation, calendrier fiscal, séries de numérotation |
| Imports / migration de données | Partiel | Imports plan, tiers, articles, budget, RH, relevés ; **reprise des soldes d'ouverture et des encours non outillée de bout en bout** |
| Licences / abonnements | **Non appliqué** | Plans Starter / Professional / Enterprise définis dans le front (`module-manager.ts`) ; table `licenses` sans chemin d'écriture ; l'activation de modules masque la navigation sans bloquer côté serveur (EV-27) |
| Utilisateurs et droits | Fait | 153 droits, rôles système et personnalisés |
| Environnement de démonstration | Absent | La société de test E2E vit dans le projet de production |
| Documentation utilisateur, formation | Absente | Documentation technique abondante, rien pour l'utilisateur final |
| Support, maintenance, incidents, SLA | Absents | DEC-08 ouverte |
| Sauvegardes | Absentes | Voir 12 |
| Protection des données | À formaliser | Loi burkinabè (CIL), données de paie, envoi de données à l'IA externe (AUD-04) |
| CGU, contrats, propriété intellectuelle | Absents du dépôt | Pas de fichier de licence propriétaire ; **inventaire des licences tierces non exécuté** (outil refusé pendant l'audit) ; polices OFL et Gotenberg (Apache 2.0) à mentionner |
| Réversibilité / export | Partiel | Exports par écran (CSV, Excel, PDF) ; pas d'export complet de société |

## 2. Modèles de déploiement

| Modèle | Atouts pour QUOREICH | Contraintes | Adéquation actuelle |
|---|---|---|---|
| SaaS mutualisé (Supabase) | Déjà en service ; isolation par société prouvée ; coût marginal faible | Données hors du pays (eu-west-1) ; dépendance fournisseur ; une erreur touche tous les clients | **Recommandé pour les pilotes**, avec un projet de recette séparé |
| SaaS dédié (un projet par client) | Isolation physique, rassurant | Coût et exploitation multipliés | Pour un client exigeant |
| On-premise (API Java + PostgreSQL) | Souveraineté des données ; demande probable des grands comptes / publics | **Exploitation non outillée** (installation, sauvegarde, mise à jour chez le client) | Après outillage (lot 1 VPS) |
| Cloud privé / hybride | Même pile que l'on-premise sur un VPS géré par QUOREICH | Équipe d'exploitation nécessaire | Cible de la version commerciale stable |

**Recommandation** : pilotes en SaaS mutualisé (capacité d'exploitation actuelle limitée), puis offre « cloud privé
QUOREICH » sur VPS dès que l'installation, la sauvegarde et la mise à jour sont reproductibles ; on-premise chez le client
seulement avec un contrat d'exploitation.

## 3. Release gates (§36)

| Gate | Critères | État | Écarts | Responsable proposé |
|---|---|---|---|---|
| G0 Périmètre et spécifications | MVP validé ; spécifications des modules en aperçu | **Partiel** | MVP validé (AUD-05) ; spécifications maintenance / arrêts, D-01..D-03, DEC-09 manquantes | Propriétaire |
| G1 Processus et E2E | Parcours critiques verts et rejoués ; recette métier | **Non atteint** | Parcours non rejoués ; pas de recette ; états non validés par expert-comptable | Produit + expert-comptable |
| G2 Sécurité et isolation | Isolation prouvée ; durcissement ; pentest | **Partiel** | Isolation prouvée ; AUD-02, limitation de débit, MFA, pentest à faire | Technique + prestataire sécurité |
| G3 Pilotes et support | Environnement de production, sauvegarde / restauration, support | **Non atteint** | Tout reste à faire | Exploitation |
| G4 Documentation et formation | Guides utilisateurs, formation | **Non atteint** | — | Produit |
| G5 Go / No-Go commercial | G0–G4 atteints, seuils | **Non atteint** | — | Direction |

# 08 — Préparation mobile

> Phase 4. Prototypes Mobile V1–V5 **non fournis** : l'alignement sur ces prototypes n'est pas vérifiable.

## 1. État

| Élément | Constat |
|---|---|
| Application mobile (React Native / Expo / Flutter / natif) | **Aucune** — NOT STARTED (lot 7 du plan « non commencé », EV-14) |
| Décision de plateforme | DEC-09 « Plateforme mobile secondaire » **ouverte** (cahier des charges v1.1, EV-09) |
| Web mobile | SPA partiellement responsive (819 classes adaptatives) ; pas de manifeste PWA ni de service worker |
| Hors ligne | Aucun |
| Notifications push | Aucune (temps réel par WebSocket / Supabase Realtime seulement dans le navigateur) |

## 2. Atouts déjà présents pour un client mobile

- **API prête** : toutes les règles sont dans la base ; l'API Java expose chaque module (`/api/v1/<module>`) avec contrat
  OpenAPI versionné ; le nuage expose les mêmes fonctions par PostgREST. Un client mobile n'a aucune règle à réécrire.
- **Identité** compatible GoTrue (supabase-js fonctionne en React Native), jetons courts et rafraîchissement.
- **Cas d'usage naturels déjà modélisés** : approbations (achats, factures, notes de frais, budget, paie, demandes de prix),
  libre-service RH (`/hr/me` : demandes de congé, solde), notes de frais avec photo de justificatif, consultation du cockpit.

## 3. Prérequis avant de construire

1. Trancher DEC-09 (Android d'abord selon le plan ; PWA possible comme première étape à coût réduit).
2. Fournir et valider les prototypes V1–V5 ; définir le périmètre V1 (recommandation : validations + libre-service + notes de frais).
3. Ajouter une boîte de réception d'approbations transverse côté serveur (aujourd'hui chaque module a sa file).
4. Notifications (push) et stratégie hors ligne pour les notes de frais.
5. Sécurité mobile : stockage sécurisé des jetons, verrouillage biométrique, révocation de session à distance.

**Statut : NOT STARTED. Aptitude : prérequis serveur en grande partie présents.**

# 25 — Jumeau sur site : API Java pour tous les modules

Démarré le 19 novembre 2026. Ce document est tenu à jour à chaque module porté.

## 1. Décision

Le propriétaire a tranché :

- **chaque module a son API Java** ;
- **le nuage garde Supabase** ;
- **l'installation sur site tourne sur la pile Java + PostgreSQL locale**, sans dépendre d'aucun
  service Supabase.

La passerelle de données générique (PostgREST sur site) a été écartée.

## 2. État de départ

Seuls les points suivants passaient par l'API :
- clients, factures et encaissements clients, avoirs clients ;
- paramétrage comptable, codes TVA, analytique ;
- autorisations ;
- une partie de la paie.

Le front comptait environ **600 accès directs à Supabase** dans 80 fichiers, plus :
- la connexion (9 appels à Supabase Auth) ;
- le stockage de fichiers (justificatifs de notes de frais) ;
- le temps réel.

## 3. Méthode

Le plan de bascule s'applique : Java appelle d'abord les fonctions SQL existantes, puis les absorbe
domaine par domaine.

**Socle commun `com.quoreich.qerp.platform`**

- **`Sql`** : lectures, écritures et appels de fonctions sur la source de données de l'application.
  Le contexte société et la RLS sont posés sur chaque connexion, si bien que les droits, gardes et
  refus sont ceux du chemin Supabase.
  - Les résultats sont sérialisés par PostgreSQL (`to_jsonb`). Ils ont la forme exacte des réponses
    PostgREST, et l'écran lit la même chose dans les deux déploiements.
  - Écritures : seules les **colonnes autorisées** par le module sont écrites. `tenant_id` est
    toujours posé par le serveur. Les colonnes imposées (auteur, statut initial, type de paiement)
    sont des expressions du module, jamais du client.
  - Zéro ligne touchée est un refus explicite (403), comme le contrôle « touched » du chemin Supabase.
  - Fonctions : appel en notation nommée, chaque argument typé par le catalogue.
  - Aucun identifiant SQL ne vient du client.
- **`DatabaseRefusalAdvice`** : les refus rédigés par la base sont rendus avec leur message.
  - `QGxxx`, `RAISE` et contraintes → 422 ;
  - droit 42501 → 403 ;
  - unicité ou référence → 409 ;
  - le reste est générique (500) et journalisé.
- Une écriture en plusieurs étapes est **une transaction** (service `@Transactional`). Par exemple,
  une facture à lignes avec ses sections analytiques : un refus n'en laisse rien, là où le chemin
  Supabase devait supprimer l'en-tête à la main.

**Modules `com.quoreich.qerp.modules.<domaine>`** : contrôleurs explicites (route, SQL, colonnes
autorisées, fonction appelée), contrat OpenAPI figé, tests d'intégration sur PostgreSQL réel.

**Front** : chaque hook garde son chemin Supabase et gagne une branche
`if (isApiEnabled()) return apiGet/apiPost/…`.

## 4. Définition de « porté »

Pour chaque module :

1. Points d'accès Java pour toutes les lectures et écritures de ses écrans.
2. Test d'intégration HTTP. Il couvre :
   - la société posée par le serveur ;
   - le refus d'un rôle insuffisant ;
   - l'invisibilité depuis une autre société ;
   - le cycle de vie par les fonctions.
3. Contrat OpenAPI et types TypeScript régénérés.
4. **Parcours sur site du module** : il échoue si un seul accès de son périmètre, **lecture
   comprise**, part vers Supabase.

Fin du chantier :
- tous les parcours métier rejoués sur site ;
- connexion locale (fournisseur d'identité sur site) ;
- stockage de fichiers local ;
- temps réel remplacé.

## 5. Avancement

| Module | API Java | Front | Test | Parcours sur site |
|---|---|---|---|---|
| Socle (`Sql`, refus, analytique des pièces, seuils d'approbation) | ✅ | ✅ | `PayableApiIT` | — |
| Comptes fournisseurs (fournisseurs, factures à lignes, approbations, paiements, règlements, avoirs, retours, paramètres AP) | ✅ | ✅ | `PayableApiIT` | ✅ `20-fournisseurs-sur-site` |
| Clients, facturation client, avoirs clients (lot 2) | ✅ | ✅ | existants | ✅ `10-clients-sur-site` |
| Approvisionnement (demandes, commandes, réceptions, suivi, réapprovisionnement) | à faire | | | |
| Grand livre, journaux, plan comptable, référentiels, contrôles | à faire | | | |
| Ventes (devis, commandes, livraisons, retours) | à faire | | | |
| Stocks (articles, entrepôts, mouvements, inventaires, campagnes) | à faire | | | |
| Trésorerie (comptes, mouvements, relevés, rapprochement, clôture) | à faire | | | |
| Immobilisations | à faire | | | |
| Budget (budgets, contrôle, prévisions) | à faire | | | |
| Notes de frais, projets | à faire | | | |
| CRM | à faire | | | |
| RH et paie (reste) | partiel | | | |
| Conformité, risques | à faire | | | |
| Pilotage (tableaux de bord, CFO, alertes, IA), administration (calendrier, sociétés, modules, invitations, import) | à faire | | | |
| Identité sur site (connexion sans Supabase Auth) | à faire | | | |
| Fichiers (justificatifs) et temps réel | à faire | | | |

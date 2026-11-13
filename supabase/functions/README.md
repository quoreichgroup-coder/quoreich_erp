# Edge Functions — Diagnostics & Error Codes

Toutes les edge functions du projet renvoient un message **générique** au client en
cas d'erreur interne (`"Internal server error"`, HTTP 500). C'est délibéré :
les détails (stack trace, message Postgres, payload Gemini…) restent côté serveur
pour éviter toute fuite d'information sensible.

Pour diagnostiquer, lire les **edge function logs** (Lovable Cloud → Backend →
Functions → Logs) ou utiliser l'outil agent `supabase--edge_function_logs`.

## Format d'audit (recherche par `audit:`)

Chaque exécution émet une ligne JSON `console.log` structurée :

```json
{ "audit": "import-data", "user_id": "...", "tenant_id": "...",
  "entity": "ar_invoices", "total": 120, "inserted": 118, "skipped": 2,
  "ts": "2026-06-27T10:12:33.000Z" }
```

```json
{ "audit": "ai-scheduler", "processed": 4, "ok": 4, "failed": 0,
  "ts": "2026-06-27T10:00:00.000Z" }
```

Filtrer les logs avec `search="audit"` pour ne voir que la piste d'audit.

## Codes HTTP

| Code | Signification générique                | Causes fréquentes |
| ---- | -------------------------------------- | ----------------- |
| 200  | Succès                                 | —                 |
| 400  | Payload invalide / contraintes DB      | JSON malformé, entité non supportée, ligne refusée par RLS, contrainte UNIQUE violée |
| 401  | Unauthorized                           | Header `Authorization` absent ou JWT invalide ; pour `ai-scheduler` : ni `Bearer SERVICE_ROLE_KEY` ni `x-scheduler-secret` valide |
| 403  | No tenant assigned                     | L'utilisateur authentifié n'a pas de `tenant_id` dans `profiles` |
| 500  | Internal server error                  | Voir logs : exception non gérée, time-out réseau, secret manquant (`AI_SCHEDULER_SECRET`, `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`) |
| 502 / 503 / 429 / 402 | Refus du fournisseur d'IA (fonctions IA) | 503 : tous les modèles de `AI_MODEL` saturés ; 429 : limite atteinte (offre gratuite) ; 402 : crédits épuisés ; 502 : clé refusée ou modèle introuvable. Message en clair dans `error`. |

## Par fonction

### `import-data`

- **Sécurité.** Un *allowlist* de colonnes par entité (`lib.ts › allowedFields`)
  filtre tout champ non autorisé **avant l'insertion** (anti mass-assignment).
  Couvert par `index.test.ts`.
- **Erreur 400 fréquente.** « Import failed — vérifiez le format des données. »
  → conflit de clé unique, FK manquante (customer_id/supplier_id inconnu), ou
  type invalide (date non ISO). Le détail Postgres est dans les logs sous
  `import-data insert error`.
- **Audit.** Une ligne `audit:"import-data"` par requête réussie.

### `ai-scheduler`

- **Auth.** Endpoint public (`verify_jwt = false` côté Edge Runtime) qui
  s'authentifie lui-même : `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  **ou** `x-scheduler-secret: ${AI_SCHEDULER_SECRET}`. Tout le reste → 401.
- **Audit.** Une ligne `audit:"ai-scheduler"` par tick de pg_cron.
- **Diagnostic d'un schedule en échec.** Inspecter `results[].msg` dans les
  logs : `status_4xx` = downstream rejette, `downstream_error` = fetch échoué.

### `ai-cashflow-forecast` / `ai-gl-anomaly-detection`

- **Auth.** JWT utilisateur requis (`getClaims`). 401 sinon.
- **Fournisseur d'IA** (`_shared/ai-provider.ts`) : tout point d'accès compatible OpenAI, choisi par
  trois secrets — `AI_BASE_URL` (ex. `https://generativelanguage.googleapis.com/v1beta/openai` pour
  Gemini, `https://openrouter.ai/api/v1`, ou LiteLLM sur site), `AI_API_KEY`, `AI_MODEL` (liste
  séparée par des virgules : un modèle saturé, limité ou retiré passe la main au suivant, ex.
  `gemini-3.8-flash,gemini-3.5-flash`). Sans `AI_API_KEY`, repli sur `LOVABLE_API_KEY` (Lovable Cloud).
  Offre gratuite Gemini : les contenus envoyés peuvent servir à Google — données de recette seulement.
- **500 fréquente.** Configuration IA incomplète, ou réponse JSON non parsable. Voir le log `ai-cashflow-forecast error` / `ai-gl-anomaly-detection error`.
- Les résultats sont persistés dans `ai_analysis_history` même en cas d'erreur
  partielle (statut `failed` avec `error_message` côté serveur uniquement).

## Lancer les tests

```bash
# Tests unitaires (allowlist import-data) — pas de réseau requis
deno test supabase/functions/import-data/index.test.ts

# Tests d'authentification (réseau requis, appelle les fonctions déployées)
deno test --allow-net --allow-env --allow-read supabase/functions
```

Les tests d'auth lisent `VITE_SUPABASE_URL` depuis `.env` via
`std/dotenv/load.ts`.

# Doublons hérités des déclencheurs en double

## Le défaut

Le schéma de production branchait la même fonction plusieurs fois sur le même
événement (constaté le 12 novembre 2026, sur le dump du 9 novembre) :

| Table | Fonction | Branchements | Effet par opération |
|---|---|---|---|
| `payments` | `on_ap_payment_recorded` | 3 | 3 écritures identiques par encaissement AR / paiement AP |
| `goods_receipts` | `on_gr_completed` | 2 | stock (`quantity_on_hand`) augmenté deux fois, 2 mouvements |
| `journal_entries` | `log_journal_entry_audit` | 2 | 2 lignes d'audit par événement |

La cause est corrigée pour l'avenir par une migration qui retire les branchements
en trop — `V16__suppression_declencheurs_en_double.sql` (API) et
`supabase/migrations/20261112120000_5f0c2a4e-…sql` (Supabase, contenu identique).
`SchemaMigrationIT.aucuneFonctionDeclencheeEnDouble` empêche qu'il revienne.

Ce dossier traite **le passé** : ce que les déclencheurs en double ont déjà écrit.

## Ce qui est corrigé, et ce qui ne l'est pas

| Effet | Traitement | Pourquoi |
|---|---|---|
| Écritures d'encaissement / paiement en double | **contre-passées** par `reverse_journal_entry` | une écriture comptabilisée ne se supprime pas ; la RPC officielle passe par l'équilibre, le verrou de période et l'audit |
| Stock des réceptions compté deux fois | **constaté seulement** | un ajustement de stock suppose un constat physique ; le stock a pu être corrigé depuis par inventaire |
| Lignes d'audit en double | **constatées seulement** | `gl_audit_logs` est une piste d'audit chaînée : on n'en retire rien |

## Procédure (production)

Dans cet ordre, en propriétaire du schéma :

1. **Appliquer la migration** (Supabase, via Lovable) — sinon chaque nouveau
   paiement recrée des doublons pendant la correction.
2. **Simuler** — aucune écriture n'est enregistrée (ROLLBACK final) :
   ```bash
   psql "$URL" -f scripts/data/doublons-declencheurs/corriger.psql
   ```
   Lire le constat AVANT : nombre d'écritures à contre-passer et montant en trop
   par source, réceptions doublées, audit en double.
3. Si `en_periode_close` > 0, **le script refuse tout** : une période GL close
   ne se modifie pas sans réouverture autorisée. Décision métier, pas technique.
4. **Appliquer**, après validation du constat par la comptabilité :
   ```bash
   psql "$URL" -v appliquer=1 -f scripts/data/doublons-declencheurs/corriger.psql
   ```
   Le constat APRÈS doit afficher `a_contrepasser = 0`.

Propriétés : tout ou rien (une erreur annule l'ensemble) ; rejouable sans effet
(un doublon déjà `reversed` n'est plus sélectionné) ; chaque contre-passation est
datée du jour et attribuée à l'auteur de l'écriture d'origine, dans sa société.

## Fichiers

- `01-constat.sql` — lecture seule ; crée la vue temporaire `qerp_doublons_ecritures`.
- `02-contrepassation.sql` — la correction (bloc `DO`), sans commande psql, pour
  que `CorrectionDoublonsIT` exécute exactement ce fichier.
- `corriger.psql` — l'enveloppe : transaction, constats avant/après, simulation par défaut.

Testé par `services/api/src/test/java/com/quoreich/qerp/CorrectionDoublonsIT.java`
(défaut recréé, refus en période close sans effet, correction exacte, idempotence).

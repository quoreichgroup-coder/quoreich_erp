-- V16 — Suppression des déclencheurs branchés en double. Écrit à la main.
--
-- Première migration postérieure à la base de référence V1..V15 (= dump de
-- production). Le dump branche la même fonction plusieurs fois sur le même
-- événement de la même table ; chaque branchement l'exécute une fois de plus :
--
--   payments         AFTER INSERT  on_ap_payment_recorded  ×3
--       → chaque encaissement AR / paiement AP est comptabilisé trois fois
--         (banque, clients, fournisseurs mouvementés trois fois).
--   goods_receipts   AFTER INSERT OR UPDATE  on_gr_completed  ×2
--       → chaque réception ajoute deux fois la quantité au stock et crée deux
--         mouvements de stock.
--   journal_entries  AFTER INSERT OR UPDATE  log_journal_entry_audit  ×2
--       → chaque événement d'écriture est journalisé deux fois dans
--         gl_audit_logs.
--
-- On garde un déclencheur par fonction, et on retire les autres. Les fonctions
-- ne changent pas. Les définitions retirées étaient strictement identiques à
-- celles conservées (même moment, mêmes événements, même fonction, aucune
-- clause WHEN), si bien que le comportement restant est exactement celui d'une
-- exécution unique.
--
-- La même migration existe côté Supabase :
--   supabase/migrations/20261112120000_5f0c2a4e-9d1b-4c7a-8e3f-6b2d1a0c9e71.sql
-- Les données déjà dupliquées ne sont PAS touchées ici : la correction est un
-- geste explicite, relu et journalisé — voir scripts/data/doublons-declencheurs/.
--
-- `IF EXISTS` : idempotent, et applicable sur une base où un déclencheur aurait
-- déjà été retiré à la main.

DROP TRIGGER IF EXISTS trg_payment_gl ON public.payments;
DROP TRIGGER IF EXISTS trg_payment_gl_posting ON public.payments;     -- garde trg_on_payment_recorded
DROP TRIGGER IF EXISTS trg_gr_completed ON public.goods_receipts;     -- garde trg_on_gr_completed
DROP TRIGGER IF EXISTS trg_journal_entry_audit ON public.journal_entries; -- garde trg_log_journal_entry_audit

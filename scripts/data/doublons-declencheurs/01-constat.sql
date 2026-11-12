-- Constat des effets des déclencheurs en double (voir V16). LECTURE SEULE.
--
-- Rejouable à volonté. Crée une vue temporaire de session, utilisée aussi par
-- 02-contrepassation.sql, puis affiche trois constats.

-- Écritures d'encaissement/paiement produites en plusieurs exemplaires.
-- Les copies d'un même déclenchement partagent tout : société, source, numéro
-- (date + 8 premiers caractères de l'UUID du paiement), libellé et created_at
-- (now() est figé pour la transaction qui a inséré le paiement). Rang 1 =
-- l'écriture conservée ; rang > 1 = doublon.
CREATE OR REPLACE TEMP VIEW qerp_doublons_ecritures AS
SELECT je.id, je.tenant_id, je.source, je.entry_number, je.entry_date,
       je.created_by, je.status,
       (SELECT COALESCE(SUM(l.debit), 0) FROM public.journal_lines l WHERE l.entry_id = je.id)
         AS montant,
       row_number() OVER (
         PARTITION BY je.tenant_id, je.source, je.entry_number, je.description, je.created_at
         ORDER BY je.id) AS rang
FROM public.journal_entries je
WHERE je.source IN ('ar_receipt', 'ap_payment');

-- 1. Écritures en double : à contre-passer, déjà contre-passées, et bloquées
--    par une période GL close (ces dernières empêchent toute correction).
SELECT 'ecritures' AS constat, d.source,
       count(*) FILTER (WHERE d.status = 'posted')   AS a_contrepasser,
       count(*) FILTER (WHERE d.status = 'reversed') AS deja_contrepassees,
       count(*) FILTER (WHERE d.status = 'posted' AND p.period IS NOT NULL) AS en_periode_close,
       COALESCE(SUM(d.montant) FILTER (WHERE d.status = 'posted'), 0) AS montant_en_trop
FROM qerp_doublons_ecritures d
LEFT JOIN public.period_locks p
  ON p.tenant_id = d.tenant_id AND p.module = 'GL' AND p.status = 'closed'
 AND p.period = to_char(d.entry_date, 'YYYY-MM')
WHERE d.rang > 1
GROUP BY d.source
ORDER BY d.source;

-- 2. Réceptions de marchandises dont le stock a été mouvementé en double.
--    NON corrigé automatiquement : un ajustement de stock suppose un constat
--    physique (le stock a pu être corrigé depuis par inventaire).
WITH attendu AS (
  SELECT gr_id, count(*) AS n, SUM(quantity_received) AS qte
  FROM public.gr_lines WHERE item_id IS NOT NULL GROUP BY gr_id),
constate AS (
  SELECT reference_id, count(*) AS n, SUM(quantity) AS qte
  FROM public.stock_movements WHERE reference_type = 'goods_receipt' GROUP BY reference_id)
SELECT 'receptions' AS constat, count(*) AS receptions_doublees,
       COALESCE(SUM(c.qte - a.qte), 0) AS quantite_en_trop
FROM attendu a JOIN constate c ON c.reference_id = a.gr_id
WHERE c.n > a.n;

-- 3. Événements d'audit journalisés en double. NON corrigé : gl_audit_logs est
--    une piste d'audit chaînée ; on n'en supprime rien, on constate.
SELECT 'audit' AS constat, count(*) AS evenements_en_double
FROM (
  SELECT entry_id, action, details, created_at, count(*) AS n
  FROM public.gl_audit_logs
  GROUP BY entry_id, action, details, created_at
  HAVING count(*) > 1) x;

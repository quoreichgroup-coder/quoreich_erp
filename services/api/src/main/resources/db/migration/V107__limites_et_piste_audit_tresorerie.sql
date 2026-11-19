-- V107 — Trésorerie → Contrôle : limites réelles par compte et piste d'audit réelle.
--
-- Les onglets « Limit Monitoring » et « Audit Trail » affichaient des lignes écrites en dur (banques,
-- découverts, opérations de change fictifs). Références : Sage 300 / X3 et SAP (gestion de trésorerie) :
-- solde minimal, solde maximal (excédent à placer) et découvert autorisé par compte, suivis contre le
-- solde réel. Chaque seuil est un paramètre du compte, vide = non suivi (aucune valeur imposée).

ALTER TABLE public.bank_accounts
  ADD COLUMN min_balance numeric(18, 2),
  ADD COLUMN max_balance numeric(18, 2),
  ADD COLUMN overdraft_limit numeric(18, 2) CHECK (overdraft_limit IS NULL OR overdraft_limit >= 0),
  ADD CONSTRAINT bank_accounts_min_max_check CHECK (min_balance IS NULL OR max_balance IS NULL OR min_balance <= max_balance);
COMMENT ON COLUMN public.bank_accounts.min_balance IS 'Solde minimal à maintenir ; NULL = non suivi.';
COMMENT ON COLUMN public.bank_accounts.max_balance IS 'Solde au-delà duquel l''excédent est à placer ; NULL = non suivi.';
COMMENT ON COLUMN public.bank_accounts.overdraft_limit IS 'Découvert autorisé par la banque ; NULL ou 0 = aucun découvert.';

-- État des limites (vue en sécurité de l'appelant : RLS des comptes de trésorerie).
CREATE VIEW public.treasury_limit_status WITH (security_invoker = true) AS
SELECT b.id AS bank_account_id, b.tenant_id, b.name, b.account_type, b.currency, b.balance,
       b.min_balance, b.max_balance, b.overdraft_limit,
       b.balance + COALESCE(b.overdraft_limit, 0) AS available,
       CASE WHEN COALESCE(b.overdraft_limit, 0) > 0 THEN round(100 * greatest(0, -b.balance) / b.overdraft_limit, 1) END AS overdraft_used_pct,
       CASE
         WHEN b.balance < -COALESCE(b.overdraft_limit, 0) THEN 'overdraft_exceeded'
         WHEN b.balance < 0 THEN 'overdraft_used'
         WHEN b.min_balance IS NOT NULL AND b.balance < b.min_balance THEN 'below_min'
         WHEN b.max_balance IS NOT NULL AND b.balance > b.max_balance THEN 'above_max'
         WHEN b.min_balance IS NULL AND b.max_balance IS NULL AND b.overdraft_limit IS NULL THEN 'not_monitored'
         ELSE 'ok' END AS status
  FROM public.bank_accounts b
 WHERE b.is_active;
GRANT SELECT ON public.treasury_limit_status TO authenticated;
REVOKE ALL ON public.treasury_limit_status FROM anon;

-- Piste d'audit de la trésorerie : événements réels des tables existantes.
CREATE VIEW public.treasury_audit_trail WITH (security_invoker = true) AS
SELECT t.tenant_id, t.created_at AS occurred_at, t.created_by AS actor_id, 'movement'::text AS kind,
       COALESCE(t.source, 'manual') AS action, b.name AS account_name, t.amount,
       concat_ws(' · ', t.description, t.reference, je.piece_number) AS detail
  FROM public.bank_transactions t
  JOIN public.bank_accounts b ON b.id = t.bank_account_id
  LEFT JOIN public.journal_entries je ON je.id = t.journal_entry_id
UNION ALL
SELECT s.tenant_id, s.created_at, s.imported_by, 'statement', 'imported', b.name, s.closing_balance,
       concat_ws(' · ', 'Relevé du ' || to_char(s.period_start, 'DD/MM/YYYY') || ' au ' || to_char(s.period_end, 'DD/MM/YYYY'), s.file_name, s.status)
  FROM public.bank_statements s JOIN public.bank_accounts b ON b.id = s.bank_account_id
UNION ALL
SELECT r.tenant_id, COALESCE(r.validated_at, r.created_at), r.validated_by, 'reconciliation', r.status, b.name, r.bank_balance,
       'Rapprochement au ' || to_char(r.period_end, 'DD/MM/YYYY') || ' — écart ' || r.difference
  FROM public.bank_reconciliations r JOIN public.bank_accounts b ON b.id = r.bank_account_id
UNION ALL
SELECT c.tenant_id, COALESCE(c.closed_at, c.created_at), c.closed_by, 'close', c.status, NULL, c.total_balance,
       'Clôture de la période ' || c.period || COALESCE(' — ' || c.error_message, '')
  FROM public.treasury_period_closes c;
GRANT SELECT ON public.treasury_audit_trail TO authenticated;
REVOKE ALL ON public.treasury_audit_trail FROM anon;

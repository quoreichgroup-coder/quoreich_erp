-- V106 — Contrôle du grand livre : anomalies, intégrité, concordance des livres auxiliaires, piste d'audit.
--
-- L'écran Grand livre → Contrôle n'affichait que des données de démonstration (anomalies, rapprochements,
-- contrôles d'intégrité et piste d'audit écrits en dur). Références : SAP (contrôles de clôture, concordance
-- comptes collectifs / postes individuels), Sage X3 (contrôle de cohérence comptable), AUDCIF art. 17-19
-- (pièce justificative, intangibilité, concordance des livres). Tous les seuils sont des paramètres de la
-- société, chaque contrôle se désactive, et l'examen d'une anomalie est tracé (commentaire, auteur, date).
--
-- Les trois fonctions de lecture sont SECURITY INVOKER : la RLS les limite à la société de l'appelant.
--
-- Écart de sécurité fermé au passage (audit du 14 nov. 2026, S6) : la piste d'audit comptable
-- gl_audit_logs avait une politique FOR ALL ouverte à tout membre, lecteur compris (suppression possible).
-- Elle n'est plus écrite que par le déclencheur log_journal_entry_audit (SECURITY DEFINER).

-- ─── Piste d'audit en lecture seule ───
DROP POLICY "Tenant isolation" ON public.gl_audit_logs;
CREATE POLICY "Lecture société" ON public.gl_audit_logs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gl_audit_logs FROM anon, authenticated;

-- Compteurs de pièces lisibles par la société (contrôle de continuité de la numérotation) ; écrits
-- seulement par trg_assign_journal_batch (SECURITY DEFINER).
ALTER TABLE public.journal_piece_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.journal_piece_counters FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE ALL ON public.journal_piece_counters FROM anon, authenticated;
GRANT SELECT ON public.journal_piece_counters TO authenticated;

-- ─── Paramètres ───
CREATE TABLE public.gl_control_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  large_entry_threshold numeric(18, 2) CHECK (large_entry_threshold IS NULL OR large_entry_threshold > 0),
  duplicate_window_days integer NOT NULL DEFAULT 3 CHECK (duplicate_window_days BETWEEN 0 AND 60),
  backdating_days integer CHECK (backdating_days IS NULL OR backdating_days BETWEEN 1 AND 366),
  subledger_tolerance numeric(18, 2) NOT NULL DEFAULT 0 CHECK (subledger_tolerance >= 0),
  disabled_checks text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
COMMENT ON COLUMN public.gl_control_settings.large_entry_threshold IS 'Montant à partir duquel une écriture est signalée ; NULL = contrôle désactivé (aucun seuil imposé).';
COMMENT ON COLUMN public.gl_control_settings.backdating_days IS 'Écart maximal entre date de pièce et date de comptabilisation d''une écriture manuelle ; NULL = désactivé.';

-- Examen d'une anomalie : justification tracée (l'anomalie reste visible, marquée « examinée »).
CREATE TABLE public.gl_control_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  check_code text NOT NULL,
  entry_id uuid NOT NULL,
  comment text NOT NULL CHECK (btrim(comment) <> ''),
  reviewed_by uuid NOT NULL DEFAULT auth.uid(),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, check_code, entry_id),
  FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE
);

-- ─── Droit du catalogue ───
INSERT INTO public.erp_permission_catalog (code, module, action, label)
VALUES ('accounting.controls', 'accounting', 'controls', 'Paramétrer les contrôles du grand livre et examiner les anomalies')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.erp_system_role_permissions (role_code, permission_code)
VALUES ('admin', 'accounting.controls'), ('accountant', 'accounting.controls'), ('compliance_auditor', 'accounting.controls')
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'on', true) IS NOT NULL AS alimentation;
INSERT INTO public.erp_role_permissions (role_id, permission_code)
SELECT r.id, sp.permission_code
  FROM public.erp_roles r
  JOIN public.erp_system_role_permissions sp ON sp.role_code = r.code
 WHERE r.is_system AND r.code IN ('admin', 'accountant', 'compliance_auditor') AND sp.permission_code = 'accounting.controls'
ON CONFLICT DO NOTHING;
SELECT set_config('qerp.system_roles_seed', 'off', true) IS NOT NULL AS fin_alimentation;

ALTER TABLE public.gl_control_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_control_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.gl_control_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Écriture habilitée" ON public.gl_control_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.controls'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.controls'));
CREATE POLICY "Lecture société" ON public.gl_control_reviews FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Examen habilité" ON public.gl_control_reviews FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'accounting.controls')
              AND reviewed_by = auth.uid());
REVOKE ALL ON public.gl_control_settings, public.gl_control_reviews FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_control_settings TO authenticated;
GRANT SELECT, INSERT ON public.gl_control_reviews TO authenticated;

-- Paramètres effectifs (défauts si la société n'a pas de ligne).
CREATE FUNCTION public.gl_control_setting() RETURNS public.gl_control_settings
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT s FROM public.gl_control_settings s WHERE s.tenant_id = public.get_user_tenant_id(auth.uid())),
    ROW(public.get_user_tenant_id(auth.uid()), NULL, 3, NULL, 0, '{}'::text[], now(), NULL)::public.gl_control_settings)
$$;

-- ─── Anomalies par écriture ───
CREATE FUNCTION public.gl_control_findings(_from date, _to date)
RETURNS TABLE (check_code text, severity text, entry_id uuid, piece_number text, entry_date date, amount numeric,
               detail text, reviewed boolean, review_comment text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.gl_control_setting()),
  e AS (
    SELECT je.id, je.piece_number, je.entry_date, je.source, je.status, je.description, je.created_by, je.posted_by, je.posted_at,
           COALESCE((SELECT SUM(l.debit) FROM public.journal_lines l WHERE l.entry_id = je.id), 0) AS debit,
           COALESCE((SELECT SUM(l.credit) FROM public.journal_lines l WHERE l.entry_id = je.id), 0) AS credit
      FROM public.journal_entries je
     WHERE je.tenant_id = public.get_user_tenant_id(auth.uid()) AND je.entry_date BETWEEN _from AND _to
  ),
  f AS (
    SELECT 'UNBALANCED'::text AS check_code, 'critical'::text AS severity, e.id, e.piece_number, e.entry_date, e.debit AS amount,
           format('Débit %s ≠ crédit %s', e.debit, e.credit) AS detail
      FROM e WHERE e.status IN ('posted', 'reversed') AND e.debit <> e.credit
    UNION ALL
    SELECT 'EMPTY_POSTED', 'critical', e.id, e.piece_number, e.entry_date, 0, 'Écriture comptabilisée sans ligne'
      FROM e WHERE e.status IN ('posted', 'reversed') AND NOT EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.entry_id = e.id)
    UNION ALL
    SELECT 'LARGE_ENTRY', 'warning', e.id, e.piece_number, e.entry_date, e.debit,
           format('Montant au-delà du seuil paramétré (%s)', s.large_entry_threshold)
      FROM e, s WHERE s.large_entry_threshold IS NOT NULL AND e.status = 'posted' AND e.debit >= s.large_entry_threshold
    UNION ALL
    SELECT 'DUPLICATE', 'warning', e.id, e.piece_number, e.entry_date, e.debit,
           'Écriture manuelle semblable : ' || (SELECT string_agg(d.piece_number, ', ' ORDER BY d.piece_number) FROM e d
             WHERE d.id <> e.id AND d.source = 'manual' AND d.status = 'posted' AND d.debit = e.debit
               AND lower(btrim(COALESCE(d.description, ''))) = lower(btrim(COALESCE(e.description, '')))
               AND abs(d.entry_date - e.entry_date) <= s.duplicate_window_days)
      FROM e, s WHERE e.source = 'manual' AND e.status = 'posted' AND e.debit > 0
       AND EXISTS (SELECT 1 FROM e d WHERE d.id <> e.id AND d.source = 'manual' AND d.status = 'posted' AND d.debit = e.debit
                     AND lower(btrim(COALESCE(d.description, ''))) = lower(btrim(COALESCE(e.description, '')))
                     AND abs(d.entry_date - e.entry_date) <= s.duplicate_window_days)
    UNION ALL
    SELECT 'SOD', 'warning', e.id, e.piece_number, e.entry_date, e.debit, 'Écriture manuelle saisie et comptabilisée par la même personne'
      FROM e WHERE e.source = 'manual' AND e.status = 'posted' AND e.created_by IS NOT NULL AND e.created_by = e.posted_by
    UNION ALL
    SELECT 'BACKDATED', 'info', e.id, e.piece_number, e.entry_date, e.debit,
           format('Comptabilisée %s jour(s) après la date de pièce', (e.posted_at::date - e.entry_date))
      FROM e, s WHERE s.backdating_days IS NOT NULL AND e.source = 'manual' AND e.status = 'posted'
       AND e.posted_at IS NOT NULL AND e.posted_at::date - e.entry_date > s.backdating_days
    UNION ALL
    SELECT 'INACTIVE_ACCOUNT', 'info', e.id, e.piece_number, e.entry_date, e.debit,
           'Ligne sur un compte désormais inactif : ' || (SELECT string_agg(DISTINCT g.code, ', ') FROM public.journal_lines l
             JOIN public.gl_accounts g ON g.id = l.account_id WHERE l.entry_id = e.id AND NOT g.is_active)
      FROM e WHERE e.status = 'posted' AND EXISTS (SELECT 1 FROM public.journal_lines l JOIN public.gl_accounts g ON g.id = l.account_id
                                                     WHERE l.entry_id = e.id AND NOT g.is_active)
  )
  SELECT f.check_code, f.severity, f.id, f.piece_number, f.entry_date, f.amount, f.detail,
         r.id IS NOT NULL, r.comment
    FROM f CROSS JOIN s
    LEFT JOIN public.gl_control_reviews r ON r.tenant_id = s.tenant_id AND r.check_code = f.check_code AND r.entry_id = f.id
   WHERE NOT (f.check_code = ANY (s.disabled_checks))
   ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.entry_date DESC, f.piece_number
$$;

-- ─── Intégrité de la comptabilité (société entière) ───
CREATE FUNCTION public.gl_integrity_checks()
RETURNS TABLE (check_code text, label text, status text, issues bigint, detail text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  c AS (
    SELECT 'BALANCED'::text AS check_code, 'Écritures comptabilisées équilibrées (débit = crédit)'::text AS label,
           (SELECT count(*) FROM public.journal_entries je, t WHERE je.tenant_id = t.id AND je.status IN ('posted', 'reversed')
              AND (SELECT COALESCE(SUM(debit - credit), 0) FROM public.journal_lines l WHERE l.entry_id = je.id) <> 0) AS issues,
           'fail'::text AS level, 'Toute écriture comptabilisée doit être équilibrée.'::text AS detail
    UNION ALL
    SELECT 'NOT_EMPTY', 'Aucune écriture comptabilisée sans ligne',
           (SELECT count(*) FROM public.journal_entries je, t WHERE je.tenant_id = t.id AND je.status IN ('posted', 'reversed')
              AND NOT EXISTS (SELECT 1 FROM public.journal_lines l WHERE l.entry_id = je.id)), 'fail', 'Une pièce sans ligne ne justifie rien.'
    UNION ALL
    SELECT 'PIECE_SEQUENCE', 'Numérotation continue des pièces par journal et par année',
           (SELECT COALESCE(SUM(pc.last_value - (SELECT count(*) FROM public.journal_entries je
                     WHERE je.tenant_id = pc.tenant_id AND je.journal_code = pc.journal_code
                       AND je.piece_number LIKE pc.journal_code || '-' || pc.year || '-%')), 0)
              FROM public.journal_piece_counters pc, t WHERE pc.tenant_id = t.id),
           'warning', 'Numéros attribués puis disparus (brouillons supprimés) : trous à justifier.'
    UNION ALL
    SELECT 'AUDIT_TRAIL', 'Chaque écriture comptabilisée a sa trace d''audit',
           (SELECT count(*) FROM public.journal_entries je, t WHERE je.tenant_id = t.id AND je.status IN ('posted', 'reversed')
              AND NOT EXISTS (SELECT 1 FROM public.gl_audit_logs a WHERE a.entry_id = je.id AND a.action = 'Posted')),
           'warning', 'Écritures sans événement « Posted » dans la piste d''audit (données antérieures au journal d''audit).'
    UNION ALL
    SELECT 'SUBLEDGER_LINKS', 'Pièces des livres auxiliaires reliées à leur écriture',
           (SELECT count(*) FROM public.ar_invoices i, t WHERE i.tenant_id = t.id AND i.status NOT IN ('draft', 'cancelled') AND i.journal_entry_id IS NULL)
           + (SELECT count(*) FROM public.ap_invoices i, t WHERE i.tenant_id = t.id AND i.approval_status = 'approved' AND i.journal_entry_id IS NULL)
           + (SELECT count(*) FROM public.payments p, t WHERE p.tenant_id = t.id AND p.payment_type IN ('ar_receipt', 'ap_payment') AND p.journal_entry_id IS NULL),
           'fail', 'Factures émises ou approuvées et règlements sans écriture comptable.'
    UNION ALL
    SELECT 'CHART', 'Plan comptable conforme au référentiel (erreurs)',
           (SELECT count(*) FROM public.chart_of_accounts_issues() x WHERE x.severity = 'error'),
           'warning', 'Détail et corrections : Grand livre → Données de base → Contrôle du plan.'
  )
  SELECT c.check_code, c.label, CASE WHEN c.issues = 0 THEN 'pass' ELSE c.level END, c.issues, c.detail
    FROM c, public.gl_control_setting() s
   WHERE NOT (c.check_code = ANY (s.disabled_checks))
$$;

-- ─── Concordance livres auxiliaires / comptes collectifs ───
-- Comptes d'un rôle : compte par défaut + comptes des jeux de comptes (V105).
CREATE FUNCTION public.posting_role_accounts(_role text) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT gl_account_id FROM public.tenant_posting_accounts WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND role_code = _role
  UNION
  SELECT gl_account_id FROM public.posting_account_set_lines WHERE tenant_id = public.get_user_tenant_id(auth.uid()) AND role_code = _role
$$;

CREATE FUNCTION public.gl_subledger_reconciliation(_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (area text, label text, subledger numeric, ledger numeric, difference numeric, status text, detail text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT public.get_user_tenant_id(auth.uid()) AS id),
  s AS (SELECT * FROM public.gl_control_setting()),
  gl AS (
    SELECT l.account_id, SUM(l.debit - l.credit) AS solde
      FROM public.journal_lines l JOIN public.journal_entries je ON je.id = l.entry_id, t
     WHERE je.tenant_id = t.id AND je.status IN ('posted', 'reversed') AND je.entry_date <= _as_of
     GROUP BY l.account_id
  ),
  r AS (
    SELECT 'AR'::text AS area, 'Clients : factures ouvertes − crédits non imputés / comptes clients'::text AS label,
      (SELECT COALESCE(SUM(i.total - COALESCE(i.amount_paid, 0)), 0) FROM public.ar_invoices i, t
        WHERE i.tenant_id = t.id AND i.status NOT IN ('draft', 'cancelled') AND i.invoice_date <= _as_of)
      - (SELECT COALESCE(SUM(c.total - c.amount_allocated - c.amount_refunded), 0) FROM public.ar_credit_notes c, t
          WHERE c.tenant_id = t.id AND c.credit_date <= _as_of) AS subledger,
      (SELECT COALESCE(SUM(gl.solde), 0) FROM gl WHERE gl.account_id IN (SELECT public.posting_role_accounts('AR_RECEIVABLE'))) AS ledger,
      'Comptes du rôle « Compte clients » (défaut et jeux de comptes).'::text AS detail
    UNION ALL
    SELECT 'ADVANCES', 'Acomptes clients non imputés / comptes d''avances',
      (SELECT COALESCE(SUM(a.amount - a.amount_applied - a.amount_refunded), 0) FROM public.ar_customer_advances a, t
        WHERE a.tenant_id = t.id AND a.received_date <= _as_of),
      -(SELECT COALESCE(SUM(gl.solde), 0) FROM gl WHERE gl.account_id IN (SELECT public.posting_role_accounts('CUSTOMER_ADVANCE'))),
      'Solde créditeur des comptes du rôle « Avances clients ».'
    UNION ALL
    SELECT 'AP', 'Fournisseurs : factures approuvées non payées − avoirs non imputés / comptes fournisseurs',
      (SELECT COALESCE(SUM(i.total - COALESCE(i.amount_paid, 0)), 0) FROM public.ap_invoices i, t
        WHERE i.tenant_id = t.id AND i.approval_status = 'approved' AND i.invoice_date <= _as_of)
      - (SELECT COALESCE(SUM(c.total - c.amount_allocated), 0) FROM public.ap_credit_notes c, t
          WHERE c.tenant_id = t.id AND c.credit_date <= _as_of),
      -(SELECT COALESCE(SUM(gl.solde), 0) FROM gl WHERE gl.account_id IN (SELECT public.posting_role_accounts('AP_PAYABLE'))),
      'Solde créditeur des comptes du rôle « Compte fournisseurs ».'
    UNION ALL
    SELECT 'TRE', 'Trésorerie : ' || b.name || ' / compte ' || g.code,
      b.balance, COALESCE((SELECT gl.solde FROM gl WHERE gl.account_id = b.gl_account_id), 0),
      CASE WHEN COALESCE(b.opening_balance, 0) <> 0
           THEN format('Solde du compte de trésorerie (dont solde d''ouverture %s, à comptabiliser par écriture d''à-nouveau si ce n''est pas fait).', b.opening_balance)
           ELSE 'Solde du compte de trésorerie et de son compte du plan.' END
      FROM public.bank_accounts b JOIN public.gl_accounts g ON g.id = b.gl_account_id, t
     WHERE b.tenant_id = t.id AND b.is_active
    UNION ALL
    SELECT 'STK', 'Stock : valeur (quantité × coût moyen) / comptes de stock',
      (SELECT COALESCE(SUM(COALESCE(it.quantity_on_hand, 0) * COALESCE(it.average_cost, 0)), 0) FROM public.items it, t WHERE it.tenant_id = t.id),
      (SELECT COALESCE(SUM(gl.solde), 0) FROM gl WHERE gl.account_id IN (SELECT public.posting_role_accounts('INVENTORY'))),
      'Valeur à la date du jour ; en inventaire intermittent, le compte de stock ne bouge qu''à l''inventaire.'
  )
  SELECT r.area, r.label, round(r.subledger, 2), round(r.ledger, 2), round(r.subledger - r.ledger, 2),
         CASE WHEN abs(r.subledger - r.ledger) <= s.subledger_tolerance THEN 'pass' ELSE 'warning' END, r.detail
    FROM r, s
   WHERE NOT (('RECON_' || r.area) = ANY (s.disabled_checks))
$$;

GRANT EXECUTE ON FUNCTION public.gl_control_setting(), public.gl_control_findings(date, date), public.gl_integrity_checks(),
  public.posting_role_accounts(text), public.gl_subledger_reconciliation(date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.gl_control_setting(), public.gl_control_findings(date, date), public.gl_integrity_checks(),
  public.posting_role_accounts(text), public.gl_subledger_reconciliation(date) FROM anon;

SELECT public.install_tenant_isolation_triggers();

-- Jumelle Supabase de services/api/src/main/resources/db/migration/V38__journaux_et_lots_comptables.sql (même SQL exécutable).
-- V38 — Journaux, numéros de pièce et lots du grand livre ; intangibilité des écritures. Écrit à la main.
--
-- Constaté le 14 nov. 2026 (demande du propriétaire : « vérifie si les journaux postés depuis les
-- livres auxiliaires créent des lots dans le GL ») :
--   - aucune notion de journal ni de lot en base ; les écrans « GL Posting Batches » regroupaient
--     dans le navigateur les 200 dernières écritures par module et par jour, avec des numéros de lot
--     et des codes journal inventés ;
--   - protect_posted_entry n'interdisait que le changement de STATUT d'une écriture comptabilisée :
--     sa date, son libellé, sa source restaient modifiables (contraire à l'intangibilité, AUDCIF).
--
-- Références : SYSCOHADA (journaux auxiliaires achats, ventes, banque, opérations diverses,
-- centralisés au journal général) ; Sage 300 (chaque module auxiliaire crée des lots du grand
-- livre, chaque écriture porte un code source) ; SAP (type de pièce KR / KZ / DR / DZ / SA et
-- plage de numéros par type).
--
-- Modèle :
--   - accounting_journals : référentiel (VT ventes, AC achats, BQ banque, PA paie, OD opérations
--     diverses), lisible par tous ; journal_for_source() rattache chaque origine d'écriture ;
--   - à l'INSERTION de chaque écriture (déclencheur trg_assign_journal_batch, premier des BEFORE) :
--     journal, lot (un par société, journal et période AAAA-MM : LOT-AC-2026-11) et numéro de pièce
--     par journal et exercice civil (AC-2026-000001), dans l'ordre d'enregistrement, sans trou (le
--     compteur est dans la transaction : une écriture refusée ne consomme pas de numéro) ;
--   - journal_batch_summary (security_invoker) : lot, nombre d'écritures, débit, crédit, première et
--     dernière pièce, statut « ouvert » ou « clôturé » (période GL close au registre des périodes) ;
--   - une écriture comptabilisée ne change plus que de statut (contre-passée, annulée).
-- Les écritures existantes reçoivent journal, lot et numéro dans l'ordre de leur création.
--
-- Jumelle : supabase/migrations/20261114110000_5f8a2d6c-3e1b-4c9a-8d7e-0b6f4a2c9e13.sql

-- ─── Référentiel des journaux ───
CREATE TABLE public.accounting_journals (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,4}$'),
  label text NOT NULL,
  sort_order integer NOT NULL
);
INSERT INTO public.accounting_journals (code, label, sort_order) VALUES
  ('VT', 'Journal des ventes', 10),
  ('AC', 'Journal des achats', 20),
  ('BQ', 'Journal de banque', 30),
  ('PA', 'Journal de paie', 40),
  ('OD', 'Opérations diverses', 90);
ALTER TABLE public.accounting_journals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture du référentiel" ON public.accounting_journals FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.accounting_journals TO authenticated;

CREATE FUNCTION public.journal_for_source(_source text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE _source
    WHEN 'ar_invoice' THEN 'VT'
    WHEN 'ap_invoice' THEN 'AC'
    WHEN 'ar_receipt' THEN 'BQ'
    WHEN 'ap_payment' THEN 'BQ'
    WHEN 'treasury' THEN 'BQ'
    WHEN 'payroll' THEN 'PA'
    ELSE 'OD'
  END
$$;

-- ─── Lots ───
CREATE TABLE public.journal_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_code text NOT NULL REFERENCES public.accounting_journals(code),
  period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  batch_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, journal_code, period),
  UNIQUE (tenant_id, batch_number)
);
ALTER TABLE public.journal_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.journal_batches FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
GRANT SELECT ON public.journal_batches TO authenticated;

-- Compteurs de pièces par société, journal et exercice civil : internes (aucun accès direct).
CREATE TABLE public.journal_piece_counters (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journal_code text NOT NULL REFERENCES public.accounting_journals(code),
  year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, journal_code, year)
);
ALTER TABLE public.journal_piece_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_piece_counters FROM PUBLIC, anon, authenticated;

ALTER TABLE public.journal_entries
  ADD COLUMN journal_code text REFERENCES public.accounting_journals(code),
  ADD COLUMN batch_id uuid REFERENCES public.journal_batches(id),
  ADD COLUMN piece_number text;

CREATE FUNCTION public.assign_journal_batch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _period text := to_char(NEW.entry_date, 'YYYY-MM');
  _year integer := extract(year FROM NEW.entry_date)::integer;
  _n integer;
BEGIN
  NEW.journal_code := public.journal_for_source(NEW.source);

  INSERT INTO public.journal_batches (tenant_id, journal_code, period, batch_number)
  VALUES (NEW.tenant_id, NEW.journal_code, _period, 'LOT-' || NEW.journal_code || '-' || _period)
  ON CONFLICT (tenant_id, journal_code, period) DO NOTHING;
  SELECT id INTO NEW.batch_id FROM public.journal_batches
   WHERE tenant_id = NEW.tenant_id AND journal_code = NEW.journal_code AND period = _period;

  INSERT INTO public.journal_piece_counters AS c (tenant_id, journal_code, year, last_value)
  VALUES (NEW.tenant_id, NEW.journal_code, _year, 1)
  ON CONFLICT (tenant_id, journal_code, year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING last_value INTO _n;
  NEW.piece_number := NEW.journal_code || '-' || _year || '-' || lpad(_n::text, 6, '0');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_journal_batch() FROM PUBLIC, anon, authenticated;

-- ─── Écritures existantes : journal, lot et numéro dans l'ordre de création ───
INSERT INTO public.journal_batches (tenant_id, journal_code, period, batch_number)
SELECT DISTINCT tenant_id, public.journal_for_source(source), to_char(entry_date, 'YYYY-MM'),
       'LOT-' || public.journal_for_source(source) || '-' || to_char(entry_date, 'YYYY-MM')
  FROM public.journal_entries
ON CONFLICT (tenant_id, journal_code, period) DO NOTHING;

-- Remplissage unique, hors contrôles métier : les déclencheurs de période, d'équilibre, d'analytique
-- et d'audit se déclencheraient sur une mise à jour qui ne change que les colonnes ajoutées (une
-- période close la refuserait). Ils sont suspendus pour CETTE instruction seulement.
ALTER TABLE public.journal_entries DISABLE TRIGGER USER;
WITH numerotees AS (
  SELECT e.id, public.journal_for_source(e.source) AS jc, to_char(e.entry_date, 'YYYY-MM') AS period,
         extract(year FROM e.entry_date)::integer AS yr,
         row_number() OVER (PARTITION BY e.tenant_id, public.journal_for_source(e.source), extract(year FROM e.entry_date)
                            ORDER BY e.created_at, e.entry_number, e.id) AS n
    FROM public.journal_entries e
)
UPDATE public.journal_entries e
   SET journal_code = n.jc,
       batch_id = b.id,
       piece_number = n.jc || '-' || n.yr || '-' || lpad(n.n::text, 6, '0')
  FROM numerotees n
  JOIN public.journal_batches b ON b.journal_code = n.jc AND b.period = n.period
 WHERE e.id = n.id AND b.tenant_id = e.tenant_id;
ALTER TABLE public.journal_entries ENABLE TRIGGER USER;

INSERT INTO public.journal_piece_counters (tenant_id, journal_code, year, last_value)
SELECT tenant_id, journal_code, extract(year FROM entry_date)::integer, count(*)
  FROM public.journal_entries GROUP BY 1, 2, 3;

ALTER TABLE public.journal_entries
  ALTER COLUMN journal_code SET NOT NULL,
  ALTER COLUMN batch_id SET NOT NULL,
  ALTER COLUMN piece_number SET NOT NULL;
CREATE UNIQUE INDEX journal_entries_piece_number_key ON public.journal_entries (tenant_id, piece_number);
CREATE INDEX journal_entries_batch_id_idx ON public.journal_entries (batch_id);

-- Premier des déclencheurs BEFORE (ordre alphabétique) : les contrôles suivants voient le journal.
CREATE TRIGGER trg_assign_journal_batch BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.assign_journal_batch();

-- ─── Intangibilité d'une écriture comptabilisée ───
CREATE OR REPLACE FUNCTION public.protect_posted_entry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Écriture % : une écriture comptabilisée ne se supprime pas (contre-passation)', OLD.piece_number;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed', 'cancelled') THEN
    IF NEW.status NOT IN ('posted', 'reversed', 'cancelled') THEN
      RAISE EXCEPTION 'Écriture % : une écriture comptabilisée ne peut être que contre-passée ou annulée', OLD.piece_number;
    END IF;
    IF (NEW.tenant_id, NEW.entry_number, NEW.entry_date, NEW.description, NEW.source, NEW.journal_code, NEW.batch_id,
        NEW.piece_number, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.entry_number, OLD.entry_date, OLD.description, OLD.source, OLD.journal_code, OLD.batch_id,
        OLD.piece_number, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'Écriture % : une écriture comptabilisée est intangible (seul son statut évolue)', OLD.piece_number;
    END IF;
  END IF;
  -- Journal, lot et numéro de pièce sont attribués à l'insertion et ne se modifient jamais.
  IF TG_OP = 'UPDATE' AND (NEW.journal_code, NEW.batch_id, NEW.piece_number) IS DISTINCT FROM (OLD.journal_code, OLD.batch_id, OLD.piece_number) THEN
    RAISE EXCEPTION 'Écriture % : journal, lot et numéro de pièce ne se modifient pas', OLD.piece_number;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ─── Lots : synthèse pour les écrans et les états ───
CREATE VIEW public.journal_batch_summary WITH (security_invoker = true) AS
SELECT b.id, b.tenant_id, b.batch_number, b.journal_code, j.label AS journal_label, b.period,
       count(DISTINCT e.id) AS entry_count,
       COALESCE(sum(l.debit), 0) AS total_debit,
       COALESCE(sum(l.credit), 0) AS total_credit,
       min(e.piece_number) AS first_piece,
       max(e.piece_number) AS last_piece,
       CASE WHEN EXISTS (SELECT 1 FROM public.period_locks pl WHERE pl.tenant_id = b.tenant_id AND pl.period = b.period
                           AND pl.module = 'GL' AND pl.status = 'closed') THEN 'closed' ELSE 'open' END AS status,
       b.created_at
  FROM public.journal_batches b
  JOIN public.accounting_journals j ON j.code = b.journal_code
  LEFT JOIN public.journal_entries e ON e.batch_id = b.id AND e.status IN ('posted', 'reversed')
  LEFT JOIN public.journal_lines l ON l.entry_id = e.id
 GROUP BY b.id, j.label;
GRANT SELECT ON public.journal_batch_summary TO authenticated;

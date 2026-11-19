-- V120 — Piste d'audit du grand livre chaînée et vérifiable (écart G-04, P0).
--
-- Avant : log_journal_entry_audit chaînait chaque événement par LEFT(md5(...), 8) — 32 bits, collisions triviales —
-- calculé sur l'action, l'identifiant de l'écriture et now() (jamais enregistré : l'empreinte ne pouvait pas être
-- recalculée), sans le contenu (auteur, libellé, montants) ; le maillon précédent était choisi par created_at, valeur
-- commune à tous les événements d'une même transaction (piège de V28). Rien ne vérifiait la chaîne.
-- Références : AUDCIF art. 19 et 24 (piste d'audit, caractère intangible des enregistrements), NF Z42-013 /
-- ISO 14641 (intégrité par chaînage d'empreintes), FEC français (fichier des écritures, à titre de comparaison),
-- SAP / Sage X3 (journal d'événements non modifiable).
--
-- Désormais :
--   • numéro d'ordre seq (identité) : l'ordre de la chaîne ne dépend plus d'une date ;
--   • empreinte SHA-256 (gl_audit_hash) sur tout le contenu de l'événement : société, ordre, lot, écriture, action,
--     auteur, détail, instantané de l'écriture (numéro, pièce, journal, date, statut, origine, totaux débit et crédit),
--     horodatage enregistré, empreinte précédente ; une chaîne par société, verrouillée pendant l'ajout (verrou
--     transactionnel : deux comptabilisations simultanées ne la font pas bifurquer) ;
--   • journal intangible : aucune modification ni suppression, même par le propriétaire de la base, hors de cette
--     migration (indicateur de session qerp.audit_reseal) ; une altération faite en désactivant le déclencheur est
--     détectée par la vérification ;
--   • historique rescellé une fois en SHA-256 dans l'ordre (created_at, id) ; les anciennes empreintes MD5 restent dans
--     legacy_hash / legacy_prev_hash ;
--   • gl_audit_chain_breaks() liste les maillons dont l'empreinte ne se recalcule pas ; contrôle « Chaîne de la piste
--     d'audit intacte » ajouté à gl_integrity_checks, non désactivable.

ALTER TABLE public.gl_audit_logs
  ADD COLUMN seq bigint,
  ADD COLUMN snapshot jsonb,
  ADD COLUMN hash_version smallint NOT NULL DEFAULT 2,
  ADD COLUMN legacy_hash text,
  ADD COLUMN legacy_prev_hash text;

CREATE FUNCTION public.gl_audit_hash(_tenant uuid, _seq bigint, _batch text, _entry uuid, _action text, _user text,
                                     _details text, _snapshot jsonb, _at timestamptz, _prev text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT encode(pg_catalog.sha256(convert_to(concat_ws('|', 'qerp-audit-v2', _tenant::text, _seq::text, COALESCE(_batch, ''),
           COALESCE(_entry::text, ''), COALESCE(_action, ''), COALESCE(_user, ''), COALESCE(_details, ''),
           COALESCE(_snapshot::text, ''), to_char(_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), COALESCE(_prev, '')), 'UTF8')), 'hex')
$$;

-- Intangibilité : seule cette migration (indicateur de session) peut réécrire le journal.
CREATE FUNCTION public.guard_gl_audit_log()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF COALESCE(current_setting('qerp.audit_reseal', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'La piste d''audit est intangible : aucune modification ni suppression' USING ERRCODE = '42501';
END;
$$;

-- Rescellement de l'historique : ordre (created_at, id), chaîne par société.
SELECT set_config('qerp.audit_reseal', 'on', true) IS NOT NULL AS rescellement;
UPDATE public.gl_audit_logs g SET seq = o.n, legacy_hash = g.hash, legacy_prev_hash = g.prev_hash
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM public.gl_audit_logs) o
 WHERE o.id = g.id;

DO $$
DECLARE
  _r record;
  _prev text;
  _tenant uuid;
  _h text;
  _max bigint;
BEGIN
  FOR _r IN SELECT * FROM public.gl_audit_logs ORDER BY tenant_id, seq LOOP
    IF _tenant IS DISTINCT FROM _r.tenant_id THEN
      _tenant := _r.tenant_id;
      _prev := repeat('0', 64);
    END IF;
    _h := public.gl_audit_hash(_r.tenant_id, _r.seq, _r.batch_id, _r.entry_id, _r.action, _r.user_name, _r.details, NULL, _r.created_at, _prev);
    UPDATE public.gl_audit_logs SET hash = _h, prev_hash = _prev, hash_version = 2 WHERE id = _r.id;
    _prev := _h;
  END LOOP;
  SELECT COALESCE(max(seq), 0) INTO _max FROM public.gl_audit_logs;
  EXECUTE format('ALTER TABLE public.gl_audit_logs ALTER COLUMN seq SET NOT NULL, ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)', _max + 1);
END;
$$;
SELECT set_config('qerp.audit_reseal', 'off', true) IS NOT NULL AS fin_rescellement;

CREATE UNIQUE INDEX gl_audit_logs_seq_key ON public.gl_audit_logs (seq);
CREATE INDEX gl_audit_logs_tenant_seq_idx ON public.gl_audit_logs (tenant_id, seq);

CREATE TRIGGER trg_guard_gl_audit_log BEFORE UPDATE OR DELETE ON public.gl_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_gl_audit_log();

-- Événement d'écriture : même logique d'action qu'avant, empreinte SHA-256 sur le contenu complet.
CREATE OR REPLACE FUNCTION public.log_journal_entry_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _action text;
  _details text;
  _batch_id text;
  _prev text;
  _seq bigint;
  _at timestamptz := clock_timestamp();
  _snapshot jsonb;
  _debit numeric;
  _credit numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _action := 'Created';
    _details := 'Journal entry created: ' || NEW.entry_number || COALESCE(' — ' || NEW.description, '');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> NEW.status THEN
      CASE NEW.status
        WHEN 'posted' THEN _action := 'Posted'; _details := 'Posted to GL by ' || COALESCE(NEW.posted_by::text, 'System');
        WHEN 'validated' THEN _action := 'Approved'; _details := 'Approved for posting';
        WHEN 'rejected' THEN _action := 'Rejected'; _details := 'Entry rejected';
        WHEN 'cancelled' THEN _action := 'Cancelled'; _details := 'Entry cancelled';
        WHEN 'reversed' THEN _action := 'Reversed'; _details := 'Entry reversed — compensating entry created';
        ELSE _action := 'Updated'; _details := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
      END CASE;
    ELSE
      _action := 'Updated';
      _details := 'Entry modified: ' || NEW.entry_number;
    END IF;
  END IF;

  _batch_id := 'GLB-' || UPPER(COALESCE(
    CASE NEW.source
      WHEN 'ar_receipt' THEN 'AR'
      WHEN 'ar_invoice' THEN 'AR'
      WHEN 'ap_payment' THEN 'AP'
      WHEN 'ap_invoice' THEN 'AP'
      WHEN 'manual' THEN 'GL'
      ELSE UPPER(LEFT(NEW.source, 4))
    END, 'GL')) || '-' || to_char(NEW.entry_date, 'YYYYMMDD');

  SELECT COALESCE(sum(l.debit), 0), COALESCE(sum(l.credit), 0) INTO _debit, _credit
    FROM public.journal_lines l WHERE l.entry_id = NEW.id;
  _snapshot := jsonb_build_object('entry_number', NEW.entry_number, 'piece_number', NEW.piece_number, 'journal_code', NEW.journal_code,
    'entry_date', NEW.entry_date, 'status', NEW.status, 'source', NEW.source, 'description', NEW.description,
    'total_debit', _debit, 'total_credit', _credit);

  -- Une chaîne par société : verrou transactionnel le temps de lire le dernier maillon et d'ajouter le nouveau.
  PERFORM pg_advisory_xact_lock(hashtextextended('qerp.gl_audit:' || NEW.tenant_id::text, 0));
  SELECT a.hash INTO _prev FROM public.gl_audit_logs a WHERE a.tenant_id = NEW.tenant_id ORDER BY a.seq DESC LIMIT 1;
  _prev := COALESCE(_prev, repeat('0', 64));
  _seq := nextval(pg_get_serial_sequence('public.gl_audit_logs', 'seq'));

  INSERT INTO public.gl_audit_logs (seq, tenant_id, batch_id, entry_id, action, user_name, details, snapshot, created_at, hash, prev_hash, hash_version)
  OVERRIDING SYSTEM VALUE
  VALUES (_seq, NEW.tenant_id, _batch_id, NEW.id, _action, COALESCE(NEW.created_by::text, 'System'), _details, _snapshot, _at,
          public.gl_audit_hash(NEW.tenant_id, _seq, _batch_id, NEW.id, _action, COALESCE(NEW.created_by::text, 'System'), _details, _snapshot, _at, _prev),
          _prev, 2);
  RETURN NEW;
END;
$function$;

-- Vérification : maillons de la société dont l'empreinte ou le lien ne se recalcule pas (lecture sous la RLS).
CREATE FUNCTION public.gl_audit_chain_breaks()
RETURNS TABLE (seq bigint, created_at timestamptz, action text, entry_id uuid, problem text)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  _r record;
  _prev text := repeat('0', 64);
BEGIN
  FOR _r IN SELECT a.* FROM public.gl_audit_logs a WHERE a.tenant_id = public.get_user_tenant_id(auth.uid()) ORDER BY a.seq LOOP
    IF _r.prev_hash IS DISTINCT FROM _prev THEN
      seq := _r.seq; created_at := _r.created_at; action := _r.action; entry_id := _r.entry_id;
      problem := 'Lien rompu : le maillon ne cite pas l''empreinte du précédent (événement supprimé ou inséré)';
      RETURN NEXT;
    END IF;
    IF _r.hash IS DISTINCT FROM public.gl_audit_hash(_r.tenant_id, _r.seq, _r.batch_id, _r.entry_id, _r.action, _r.user_name,
                                                      _r.details, _r.snapshot, _r.created_at, _r.prev_hash) THEN
      seq := _r.seq; created_at := _r.created_at; action := _r.action; entry_id := _r.entry_id;
      problem := 'Contenu modifié : l''empreinte ne correspond plus à l''événement';
      RETURN NEXT;
    END IF;
    _prev := _r.hash;
  END LOOP;
END;
$$;

-- Contrôles d'intégrité (V106) : ajout de la vérification de la chaîne, non désactivable.
CREATE OR REPLACE FUNCTION public.gl_integrity_checks()
 RETURNS TABLE(check_code text, label text, status text, issues bigint, detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    SELECT 'AUDIT_CHAIN', 'Chaîne de la piste d''audit intacte (SHA-256)',
           (SELECT count(*) FROM public.gl_audit_chain_breaks()),
           'fail', 'Événement modifié, supprimé ou inséré hors du journal : voir Contrôle → Piste d''audit (contrôle non désactivable).'
    UNION ALL
    SELECT 'CHART', 'Plan comptable conforme au référentiel (erreurs)',
           (SELECT count(*) FROM public.chart_of_accounts_issues() x WHERE x.severity = 'error'),
           'warning', 'Détail et corrections : Grand livre → Données de base → Contrôle du plan.'
  )
  SELECT c.check_code, c.label, CASE WHEN c.issues = 0 THEN 'pass' ELSE c.level END, c.issues, c.detail
    FROM c, public.gl_control_setting() s
   WHERE c.check_code = 'AUDIT_CHAIN' OR NOT (c.check_code = ANY (s.disabled_checks))
$function$;

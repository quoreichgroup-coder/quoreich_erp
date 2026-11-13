-- V22 — Numérotation des factures clients : unique, continue, attribuée à l'émission.
-- Écrit à la main.
--
-- POURQUOI
-- Rien n'imposait l'unicité de ar_invoices.invoice_number, et le navigateur
-- fabriquait des numéros aléatoires (INV-MMI2DRA9). La série ar_numbering_series
-- (préfixe, format, remise à zéro annuelle) existait et se paramétrait, mais rien
-- ne la consommait. Le droit OHADA comme la pratique (tranches de numéros SAP,
-- numérotation automatique Sage) exigent une numérotation unique et continue.
--
-- RÈGLES
--   - unicité par société : index unique (tenant_id, invoice_number) ;
--   - si ar_general_settings.auto_numbering (vrai par défaut), le numéro définitif
--     est attribué par la base AU PASSAGE en facture émise, depuis la série
--     « invoice » ; le brouillon garde un numéro provisoire. L'attribution a lieu
--     dans la transaction d'émission : si l'émission est refusée (paramétrage,
--     analytique, période close), tout est annulé, compteur compris — aucun trou ;
--   - un compteur PAR PÉRIODE (année de la facture si remise annuelle, sinon une
--     seule) : une facture datée de l'année N émise en N+1 prend le numéro suivant
--     de N, jamais un numéro déjà donné ;
--   - le premier compteur d'une société part de next_number de la série (reprise
--     d'une numérotation existante) ; les années suivantes repartent à 1 ;
--   - le numéro d'une facture émise ne change plus.
--
-- Format de la série : PREFIX → préfixe, YYYY / YY → année, MM → mois, une suite de
-- # → numéro complété de zéros (#### → 0001). Les factures existantes gardent leur
-- numéro : seules les émissions à venir sont numérotées.
--
-- Jumelle : services/api/src/main/resources/db/migration/V22__numerotation_des_factures.sql

-- Refus explicite si des doublons existent déjà : l'index ne peut pas être posé.
DO $$
DECLARE _doublons text;
BEGIN
  SELECT string_agg(DISTINCT invoice_number, ', ') INTO _doublons
  FROM (SELECT tenant_id, invoice_number FROM public.ar_invoices
        GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF _doublons IS NOT NULL THEN
    RAISE EXCEPTION 'Numéros de facture en double dans une même société : % — à renuméroter avant cette migration', _doublons;
  END IF;
END $$;

CREATE UNIQUE INDEX ar_invoices_tenant_number_key ON public.ar_invoices (tenant_id, invoice_number);

CREATE TABLE public.document_counters (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doc_type text NOT NULL,
    period text NOT NULL,
    next_number integer NOT NULL CHECK (next_number > 0),
    PRIMARY KEY (tenant_id, doc_type, period)
);

-- Prochain numéro d'un type de document, pour une date. Verrouille la ligne du compteur
-- jusqu'à la fin de la transaction : deux émissions simultanées ne prennent jamais le
-- même numéro, et un refus d'émission rend le numéro.
CREATE FUNCTION public.next_document_number(_tenant uuid, _doc_type text, _date date) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _serie public.ar_numbering_series%ROWTYPE;
  _period text;
  _n integer;
  _out text;
  _width integer;
BEGIN
  SELECT * INTO _serie FROM public.ar_numbering_series
   WHERE tenant_id = _tenant AND doc_type = _doc_type
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune série de numérotation « % » pour la société', _doc_type
      USING ERRCODE = 'QG001', HINT = 'Définir la série dans les paramètres AR → Numérotation.';
  END IF;

  _period := CASE WHEN _serie.reset_frequency = 'yearly' THEN to_char(_date, 'YYYY') ELSE 'ALL' END;

  INSERT INTO public.document_counters (tenant_id, doc_type, period, next_number)
  VALUES (_tenant, _doc_type, _period,
          CASE WHEN EXISTS (SELECT 1 FROM public.document_counters
                            WHERE tenant_id = _tenant AND doc_type = _doc_type)
               THEN 1 ELSE GREATEST(_serie.next_number, 1) END)
  ON CONFLICT (tenant_id, doc_type, period) DO NOTHING;

  UPDATE public.document_counters SET next_number = next_number + 1
   WHERE tenant_id = _tenant AND doc_type = _doc_type AND period = _period
  RETURNING next_number - 1 INTO _n;

  _out := replace(_serie.format, 'PREFIX', rtrim(_serie.prefix, '-'));
  _out := replace(_out, 'YYYY', to_char(_date, 'YYYY'));
  _out := replace(_out, 'YY', to_char(_date, 'YY'));
  _out := replace(_out, 'MM', to_char(_date, 'MM'));
  _width := length(substring(_out from '#+'));
  IF _width IS NULL THEN
    _out := _out || _n::text;
  ELSE
    _out := regexp_replace(_out, '#+', lpad(_n::text, GREATEST(_width, length(_n::text)), '0'));
  END IF;
  RETURN _out;
END; $$;

-- BEFORE INSERT OR UPDATE sur ar_invoices. Nommé pour passer AVANT trg_on_ar_invoice_posted
-- (ordre alphabétique) : l'écriture comptable porte ainsi le numéro définitif.
CREATE FUNCTION public.assign_ar_invoice_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _auto boolean;
  _emise boolean := NEW.status NOT IN ('draft');
  _etait_emise boolean := TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft');
BEGIN
  IF _etait_emise THEN
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
      RAISE EXCEPTION 'Le numéro d''une facture émise ne se modifie pas (%)', OLD.invoice_number
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT _emise THEN RETURN NEW; END IF;

  SELECT auto_numbering INTO _auto FROM public.ar_general_settings WHERE tenant_id = NEW.tenant_id;
  IF COALESCE(_auto, true) THEN
    NEW.invoice_number := public.next_document_number(NEW.tenant_id, 'invoice', COALESCE(NEW.invoice_date, CURRENT_DATE));
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_assign_ar_invoice_number BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_ar_invoice_number();

-- Compteurs : lisibles dans la société, écrits seulement par next_document_number().
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.document_counters FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.document_counters FROM authenticated;

REVOKE ALL ON FUNCTION public.next_document_number(uuid, text, date), public.assign_ar_invoice_number() FROM PUBLIC;
REVOKE ALL ON public.document_counters FROM anon;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text, date), public.assign_ar_invoice_number() FROM anon;

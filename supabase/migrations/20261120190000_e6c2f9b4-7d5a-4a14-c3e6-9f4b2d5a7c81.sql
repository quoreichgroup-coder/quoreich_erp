-- V130 — Cours de change BCEAO importés automatiquement (moins de saisie ; lot I1).
-- La BCEAO publie chaque jour ouvré les « cours des devises contre franc CFA à appliquer aux transferts » (achat et
-- vente, en FCFA pour une unité : dollar US, livre sterling, franc suisse, dollar canadien, yen, yuan, dirham des EAU ;
-- l'euro reste à la parité fixe), consultables à une date (bceao.int, Statistiques → Cours des devises). Une tâche les
-- lit chaque jour (sur site : l'API Java ; dans le nuage : la fonction bceao-rates) et les enregistre comme cours de
-- référence (sans société, reference_kind = 'published') ; un cours passé se reprend à la demande.
--   exchange_rates.buy_rate / sell_rate      achat et vente publiés ; rate = milieu ;
--   currency_settings                        par société : cours retenu (milieu, achat ou vente) et utilisation ou non
--                                            des cours publiés (la parité fixe de l'euro s'applique toujours) ;
--   import_reference_rates(base, date, source, rates)   écriture des cours publiés, réservée à la tâche (service_role
--                                            dans le nuage, qerp_api sur site), jamais aux utilisateurs.

ALTER TABLE public.exchange_rates
  ADD COLUMN buy_rate numeric(20, 8) CHECK (buy_rate > 0),
  ADD COLUMN sell_rate numeric(20, 8) CHECK (sell_rate > 0),
  ADD COLUMN reference_kind text CHECK (reference_kind IN ('parity', 'published'));
UPDATE public.exchange_rates SET reference_kind = 'parity' WHERE tenant_id IS NULL;
ALTER TABLE public.exchange_rates ADD CONSTRAINT exchange_rates_reference_kind CHECK ((tenant_id IS NULL) = (reference_kind IS NOT NULL));

CREATE TABLE public.currency_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  reference_rate text NOT NULL DEFAULT 'mid' CHECK (reference_rate IN ('mid', 'buy', 'sell')),
  use_published_rates boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.currency_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture société" ON public.currency_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));
CREATE POLICY "Paramétrage habilité" ON public.currency_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'currency.rates'))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()) AND public.has_permission(auth.uid(), 'currency.rates'));
GRANT SELECT, INSERT, UPDATE ON public.currency_settings TO authenticated;

-- Dernier cours connu à une date : cours de la société, sinon cours de référence (parité fixe, puis cours publiés si la
-- société les utilise, au type retenu : milieu, achat ou vente) ; 1 pour la devise de la société.
CREATE OR REPLACE FUNCTION public.exchange_rate_at(_tenant uuid, _currency text, _date date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  WITH base AS (SELECT t.currency AS c FROM public.tenants t WHERE t.id = _tenant),
  cfg AS (SELECT COALESCE((SELECT s.reference_rate FROM public.currency_settings s WHERE s.tenant_id = _tenant), 'mid') AS kind,
                 COALESCE((SELECT s.use_published_rates FROM public.currency_settings s WHERE s.tenant_id = _tenant), true) AS published)
  SELECT CASE WHEN upper(_currency) = (SELECT c FROM base) THEN 1::numeric ELSE (
    SELECT CASE WHEN r.tenant_id IS NULL AND r.reference_kind = 'published' THEN
                  CASE (SELECT kind FROM cfg) WHEN 'buy' THEN COALESCE(r.buy_rate, r.rate) WHEN 'sell' THEN COALESCE(r.sell_rate, r.rate) ELSE r.rate END
                ELSE r.rate END
      FROM public.exchange_rates r
     WHERE r.currency = upper(_currency) AND r.base_currency = (SELECT c FROM base) AND r.rate_date <= _date
       AND (r.tenant_id = _tenant
            OR (r.tenant_id IS NULL AND (r.reference_kind = 'parity' OR (SELECT published FROM cfg))))
     ORDER BY r.rate_date DESC, (r.tenant_id IS NULL) ASC LIMIT 1) END
$$;

CREATE FUNCTION public.import_reference_rates(_base text, _date date, _source text, _rates jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb; _n integer := 0; _buy numeric; _sell numeric; _cur text;
BEGIN
  IF _base !~ '^[A-Z]{3}$' OR _date IS NULL OR jsonb_typeof(_rates) <> 'array' THEN
    RAISE EXCEPTION 'Cours publiés : devise de base, date et liste de cours requises' USING ERRCODE = '22023';
  END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(_rates) LOOP
    _cur := upper(_r ->> 'currency'); _buy := (_r ->> 'buy')::numeric; _sell := (_r ->> 'sell')::numeric;
    CONTINUE WHEN _cur !~ '^[A-Z]{3}$' OR _cur = _base OR COALESCE(_buy, 0) <= 0 OR COALESCE(_sell, 0) <= 0;
    -- La parité fixe (euro) n'est jamais remplacée par un cours publié.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.exchange_rates p WHERE p.tenant_id IS NULL AND p.reference_kind = 'parity'
                           AND p.base_currency = _base AND p.currency = _cur);
    INSERT INTO public.exchange_rates (tenant_id, base_currency, currency, rate_date, rate, buy_rate, sell_rate, source, reference_kind, created_by)
    VALUES (NULL, _base, _cur, _date, round((_buy + _sell) / 2, 6), _buy, _sell, left(COALESCE(_source, 'BCEAO'), 120), 'published', NULL)
    ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), base_currency, currency, rate_date)
    DO UPDATE SET rate = EXCLUDED.rate, buy_rate = EXCLUDED.buy_rate, sell_rate = EXCLUDED.sell_rate, source = EXCLUDED.source;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.import_reference_rates(text, date, text, jsonb) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.import_reference_rates(text, date, text, jsonb) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qerp_api') THEN
    GRANT EXECUTE ON FUNCTION public.import_reference_rates(text, date, text, jsonb) TO qerp_api;
  END IF;
END $$;

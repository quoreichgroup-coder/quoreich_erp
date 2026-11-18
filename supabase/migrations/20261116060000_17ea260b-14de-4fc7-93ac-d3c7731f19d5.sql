-- V97: reject NULL/non-numeric bracket values before a payroll profile can be confirmed.
CREATE OR REPLACE FUNCTION public.payroll_rules_valid(_settings public.hr_payroll_settings)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _band jsonb;
  _rate numeric;
  _up_to numeric;
  _previous numeric := 0;
  _index integer := 0;
  _count integer;
BEGIN
  IF _settings.country_code IS NULL OR _settings.country_code !~ '^[A-Z]{2}$'
     OR _settings.currency_code IS NULL OR _settings.currency_code !~ '^[A-Z]{3}$'
     OR _settings.employee_contribution_pct IS NULL
     OR _settings.employee_contribution_pct NOT BETWEEN 0 AND 100
     OR _settings.employer_contribution_pct NOT BETWEEN 0 AND 100
     OR (_settings.employee_contribution_cap IS NOT NULL AND _settings.employee_contribution_cap <= 0)
     OR (_settings.employer_contribution_cap IS NOT NULL AND _settings.employer_contribution_cap <= 0)
     OR _settings.rules_effective_from IS NULL
     OR NULLIF(btrim(_settings.rules_reference), '') IS NULL
     OR jsonb_typeof(_settings.income_tax_bands) <> 'array' THEN
    RETURN false;
  END IF;
  _count := jsonb_array_length(_settings.income_tax_bands);
  IF _count = 0 THEN RETURN false; END IF;

  FOR _band IN SELECT value FROM jsonb_array_elements(_settings.income_tax_bands) LOOP
    _index := _index + 1;
    IF jsonb_typeof(_band) <> 'object'
       OR NOT (_band ? 'rate_pct')
       OR jsonb_typeof(_band -> 'rate_pct') <> 'number'
       OR NOT (_band ? 'up_to') THEN
      RETURN false;
    END IF;
    BEGIN
      _rate := (_band ->> 'rate_pct')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF _rate IS NULL OR _rate < 0 OR _rate > 100 THEN RETURN false; END IF;

    IF jsonb_typeof(_band -> 'up_to') = 'null' THEN
      IF _index <> _count THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(_band -> 'up_to') <> 'number' THEN RETURN false; END IF;
      BEGIN
        _up_to := (_band ->> 'up_to')::numeric;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
      IF _up_to IS NULL OR _up_to <= _previous OR _index = _count THEN RETURN false; END IF;
      _previous := _up_to;
    END IF;
  END LOOP;
  RETURN true;
END
$function$;

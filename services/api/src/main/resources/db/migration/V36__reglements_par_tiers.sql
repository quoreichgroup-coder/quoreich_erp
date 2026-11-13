-- V36 — Règlements par tiers (encaissements clients, paiements fournisseurs). Écrit à la main.
--
-- Références : SAP F-28 / F-53 (on saisit le compte du tiers, puis on traite SES postes ouverts),
-- Sage 100 « Règlements » et Sage X3 « Règlement » (tiers d'abord, puis imputation / lettrage sur
-- ses échéances). Demandé par le propriétaire le 13 nov. 2026 : « lorsqu'on choisit un fournisseur
-- pour paiement, on ne doit avoir que les factures liées à ce fournisseur ; de même côté client ».
--
-- Avant : l'écran AR ouvrait l'encaissement sur la première facture non soldée, tous clients
-- confondus ; rien n'empêchait, en base, d'imputer un règlement saisi pour un tiers sur la facture
-- d'un autre. Désormais record_settlement enregistre un règlement réparti sur plusieurs factures en
-- UNE transaction (tout ou rien) et refuse (SQLSTATE QG005) :
--   - une facture qui n'appartient pas au tiers choisi (ou à une autre société) ;
--   - une facture non ouverte (brouillon, soldée, annulée) ; côté fournisseur, non approuvée ;
--   - un montant nul, négatif ou supérieur au restant dû ; la même facture deux fois.
-- SECURITY INVOKER : la RLS et les déclencheurs existants (écriture comptable, recalcul de la
-- facture, période fiscale, garde d'approbation) s'appliquent comme pour une saisie directe.
--
-- Jumelle : supabase/migrations/20261114090000_3e7a9c1d-5b2f-4d8e-9a6c-2f1b0d8e4c73.sql

CREATE FUNCTION public.record_settlement(
  _kind text,
  _party_id uuid,
  _payment_date date,
  _payment_method text,
  _reference text,
  _allocations jsonb
) RETURNS uuid[]
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _tenant uuid := public.get_user_tenant_id(auth.uid());
  _a jsonb;
  _invoice uuid;
  _amount numeric;
  _number text;
  _party uuid;
  _status text;
  _approval text;
  _outstanding numeric;
  _seen uuid[] := '{}';
  _ids uuid[] := '{}';
  _id uuid;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'Connexion et société requises' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('ar', 'ap') THEN
    RAISE EXCEPTION 'Type de règlement inconnu : % (ar ou ap)', _kind USING ERRCODE = '22023';
  END IF;
  IF _party_id IS NULL THEN
    RAISE EXCEPTION 'Choisissez d''abord le %', CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END
      USING ERRCODE = 'QG005';
  END IF;
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RAISE EXCEPTION 'Imputez le règlement sur au moins une facture' USING ERRCODE = 'QG005';
  END IF;

  FOR _a IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    _invoice := (_a ->> 'invoice_id')::uuid;
    _amount := round((_a ->> 'amount')::numeric, 2);
    IF _invoice = ANY (_seen) THEN
      RAISE EXCEPTION 'La même facture apparaît deux fois dans le règlement' USING ERRCODE = 'QG005';
    END IF;
    _seen := _seen || _invoice;

    IF _kind = 'ar' THEN
      SELECT invoice_number, customer_id, status, NULL, total - amount_paid
        INTO _number, _party, _status, _approval, _outstanding
        FROM public.ar_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    ELSE
      SELECT invoice_number, supplier_id, status, approval_status, total - amount_paid
        INTO _number, _party, _status, _approval, _outstanding
        FROM public.ap_invoices WHERE id = _invoice AND tenant_id = _tenant FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Facture introuvable dans la société' USING ERRCODE = 'QG005';
    END IF;
    IF _party IS DISTINCT FROM _party_id THEN
      RAISE EXCEPTION 'La facture % n''appartient pas au % choisi', _number,
        CASE WHEN _kind = 'ar' THEN 'client' ELSE 'fournisseur' END USING ERRCODE = 'QG005';
    END IF;
    IF _status IN ('draft', 'paid', 'cancelled', 'void') THEN
      RAISE EXCEPTION 'La facture % n''est pas ouverte au règlement (statut : %)', _number, _status USING ERRCODE = 'QG005';
    END IF;
    IF _kind = 'ap' AND _approval IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'La facture fournisseur % n''est pas approuvée : paiement refusé', _number USING ERRCODE = 'QG005';
    END IF;
    IF _amount IS NULL OR _amount <= 0 THEN
      RAISE EXCEPTION 'Montant imputé invalide sur la facture %', _number USING ERRCODE = 'QG005';
    END IF;
    IF _amount > _outstanding THEN
      RAISE EXCEPTION 'Facture % : % imputé pour un restant dû de %', _number, _amount, _outstanding USING ERRCODE = 'QG005';
    END IF;

    INSERT INTO public.payments (tenant_id, payment_type, ar_invoice_id, ap_invoice_id, amount, payment_date,
                                 payment_method, reference, created_by)
    VALUES (_tenant, CASE WHEN _kind = 'ar' THEN 'ar_receipt' ELSE 'ap_payment' END,
            CASE WHEN _kind = 'ar' THEN _invoice END, CASE WHEN _kind = 'ap' THEN _invoice END,
            _amount, COALESCE(_payment_date, CURRENT_DATE), COALESCE(NULLIF(_payment_method, ''), 'bank_transfer'),
            NULLIF(btrim(_reference), ''), auth.uid())
    RETURNING id INTO _id;
    _ids := _ids || _id;
  END LOOP;
  RETURN _ids;
END $$;

REVOKE ALL ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_settlement(text, uuid, date, text, text, jsonb) TO authenticated;

-- ─── Pièce d'origine du même tiers ───
-- Une facture fournisseur ne peut citer qu'une commande de SON fournisseur, une facture client
-- qu'une commande de SON client, dans la même société (même règle que le règlement).
CREATE FUNCTION public.guard_invoice_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'ap_invoices' THEN
    IF NEW.po_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.po_id IS DISTINCT FROM OLD.po_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id)
       AND NOT EXISTS (SELECT 1 FROM public.purchase_orders p
                        WHERE p.id = NEW.po_id AND p.tenant_id = NEW.tenant_id AND p.supplier_id = NEW.supplier_id) THEN
      RAISE EXCEPTION 'La commande citée n''est pas une commande de ce fournisseur' USING ERRCODE = 'QG005';
    END IF;
  ELSIF TG_TABLE_NAME = 'ar_invoices' THEN
    IF NEW.so_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.so_id IS DISTINCT FROM OLD.so_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id)
       AND NOT EXISTS (SELECT 1 FROM public.sales_orders s
                        WHERE s.id = NEW.so_id AND s.tenant_id = NEW.tenant_id AND s.customer_id = NEW.customer_id) THEN
      RAISE EXCEPTION 'La commande citée n''est pas une commande de ce client' USING ERRCODE = 'QG005';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_ap_invoice_origin BEFORE INSERT OR UPDATE ON public.ap_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_origin();
CREATE TRIGGER trg_guard_ar_invoice_origin BEFORE INSERT OR UPDATE ON public.ar_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_origin();

-- V17 — La comptabilisation automatique AR refuse au lieu de sauter. Écrit à la main.
--
-- Avant : quand un compte du plan manquait, on_ar_invoice_posted émettait un
-- WARNING (invisible pour l'utilisateur) et laissait passer la facture sans
-- écriture ; on_ap_payment_recorded sautait l'écriture sans rien dire. Résultat
-- constaté sur le dump du 9 novembre 2026 : une société sans plan comptable a
-- trois paiements (325 010 XOF) qui n'existent pas en comptabilité générale.
--
-- Référence métier : SAP (« détermination de compte impossible » bloque la
-- comptabilisation du document), Sage 300 et Sage X3 (un lot dont le compte de
-- contrôle ou de banque manque ne se reporte pas et reste en erreur). Aucun ne
-- laisse exister une créance ou un encaissement sans écriture. On fait de même :
-- l'opération est refusée, entièrement, avec un message qui nomme les comptes.
--
-- Ce qui ne change pas :
--   - une facture en 'draft' n'est pas comptabilisée, donc jamais refusée pour
--     ce motif : la saisie reste possible avant paramétrage ;
--   - les numéros, libellés, lignes et montants des écritures sont identiques ;
--   - SECURITY DEFINER et search_path ; CREATE OR REPLACE conserve propriétaire
--     et droits (V15).
--
-- Code d'erreur dédié QG001 (classe QG, « QUOREICH GL ») : l'API le traduit en
-- 422 avec ce message, qui ne contient que des codes de comptes. TVA : une
-- facture avec TVA exige le 4310 ; auparavant la ligne de TVA était omise et
-- l'écriture échouait plus loin sur « unbalanced », message incompréhensible.
--
-- Jumelle : services/api/src/main/resources/db/migration/V17__comptabilisation_ar_refus_si_plan_incomplet.sql
-- (contenu identique). Les fonctions on_ap_invoice_posted et on_stock_movement_je
-- ont le même défaut ; elles seront traitées avec la recette des lots 3 et 4.

CREATE OR REPLACE FUNCTION public.on_ar_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _ar uuid; _rev uuid; _vat uuid;
  _manquants text[] := '{}';
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','open','posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT id INTO _ar  FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;
  SELECT id INTO _rev FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4000' LIMIT 1;
  SELECT id INTO _vat FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4310' LIMIT 1;

  IF _ar  IS NULL THEN _manquants := _manquants || '4110 Clients'::text; END IF;
  IF _rev IS NULL THEN _manquants := _manquants || '4000 Ventes'::text; END IF;
  IF COALESCE(NEW.tax_amount,0) > 0 AND _vat IS NULL THEN
    _manquants := _manquants || '4310 TVA collectée'::text;
  END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Plan comptable incomplet : compte(s) % absent(s) ; la facture % ne peut pas être émise',
      array_to_string(_manquants, ', '), NEW.invoice_number
      USING ERRCODE = 'QG001',
            HINT = 'Créer les comptes manquants dans le plan comptable, ou enregistrer la facture en brouillon.';
  END IF;

  _entry_number := 'JE-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, _entry_number, NEW.invoice_date, 'AR Invoice: '||NEW.invoice_number, 'ar_invoice', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _ar, NEW.total, 0, 'DR Clients');
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _rev, 0, NEW.subtotal, 'CR Ventes HT');
  IF COALESCE(NEW.tax_amount,0) > 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, 0, NEW.tax_amount, 'CR TVA collectée');
  END IF;

  UPDATE public.journal_entries
    SET status = 'posted', posted_by = NEW.created_by, posted_at = now()
    WHERE id = _entry_id;

  NEW.journal_entry_id := _entry_id;
  RETURN NEW;
END; $$;


CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
  _manquants text[] := '{}';
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    SELECT id INTO _payable FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4010' LIMIT 1;
    SELECT id INTO _bank    FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;

    IF _payable IS NULL THEN _manquants := _manquants || '4010 Fournisseurs'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || '5210 Banque'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Plan comptable incomplet : compte(s) % absent(s) ; le paiement fournisseur ne peut pas être enregistré',
        array_to_string(_manquants, ', ')
        USING ERRCODE = 'QG001',
              HINT = 'Créer les comptes manquants dans le plan comptable.';
    END IF;

    _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Banque');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    SELECT id INTO _bank FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '5210' LIMIT 1;
    SELECT id INTO _ar   FROM public.gl_accounts WHERE tenant_id = NEW.tenant_id AND code = '4110' LIMIT 1;

    IF _bank IS NULL THEN _manquants := _manquants || '5210 Banque'::text; END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || '4110 Clients'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Plan comptable incomplet : compte(s) % absent(s) ; l''encaissement ne peut pas être enregistré',
        array_to_string(_manquants, ', ')
        USING ERRCODE = 'QG001',
              HINT = 'Créer les comptes manquants dans le plan comptable.';
    END IF;

    _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Banque');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  RETURN NEW;
END; $$;

-- Jumelle Supabase de services/api/src/main/resources/db/migration/V37__comptabilisation_factures_fournisseurs.sql (même SQL exécutable).
-- V37 — Comptabilisation des factures fournisseurs par rôles (Lot 3, étape 3). Écrit à la main.
--
-- Constaté par les parcours de bout en bout (14 nov. 2026) et sur les données réelles :
-- on_ap_invoice_posted cherchait les comptes 4010 / 6010 / 4320 par leur numéro et, s'ils
-- manquaient, abandonnait en silence (RAISE WARNING) : facture approuvée SANS écriture. Le plan
-- SYSCOHADA (V18) utilise 401 / 601 / 4452, donc toute société au plan SYSCOHADA était concernée
-- (24 factures sur 24 dans la société de test) ; les paiements, eux, passaient au débit du compte
-- fournisseur (V17/V18), qui finissait débiteur. Une société réelle a 6 factures approuvées sans
-- écriture (rattrapage : scripts/data/rattrapage-ecritures-ap/, simulation par défaut).
--
-- Désormais, comme la facture client depuis V17/V18 (SAP / Sage : pas de pièce validée sans
-- écriture) :
--   - les comptes viennent des rôles de comptabilisation : PURCHASES (débit HT), VAT_INPUT (débit
--     TVA déductible, si la facture en porte), AP_PAYABLE (crédit TTC) ;
--   - un rôle manquant ou inactif REFUSE l'approbation (SQLSTATE QG001, rôles nommés) ;
--   - l'écriture est datée de la facture ; une période comptable close la refuse (contrôles des
--     écritures existants, V33).
-- La construction de l'écriture est isolée dans ap_invoice_journal_entry(), interne (droits
-- retirés aux rôles applicatifs), que le script de rattrapage réutilise.
--
-- Jumelle : supabase/migrations/20261114100000_9d2c4e7a-1b3f-4a8e-b6d5-7e0f2c9a1b46.sql

CREATE FUNCTION public.ap_invoice_journal_entry(_inv public.ap_invoices) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _entry_id uuid;
  _payable uuid := public.posting_account(_inv.tenant_id, 'AP_PAYABLE');
  _purchases uuid := public.posting_account(_inv.tenant_id, 'PURCHASES');
  _vat uuid := public.posting_account(_inv.tenant_id, 'VAT_INPUT');
  _tax numeric := COALESCE(_inv.tax_amount, 0);
  _net numeric := COALESCE(_inv.subtotal, 0);
  -- Total recalculé ici : trg_on_ap_invoice_posted s'exécute AVANT trg_validate_ap_invoice (ordre
  -- alphabétique des déclencheurs BEFORE), qui recalcule ensuite le même total sur la facture.
  _total numeric := round(COALESCE(_inv.subtotal, 0) + COALESCE(_inv.tax_amount, 0), 2);
  _manquants text[] := '{}';
BEGIN
  IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
  IF _purchases IS NULL THEN _manquants := _manquants || 'PURCHASES'::text; END IF;
  IF _tax <> 0 AND _vat IS NULL THEN _manquants := _manquants || 'VAT_INPUT'::text; END IF;
  IF cardinality(_manquants) > 0 THEN
    RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; la facture fournisseur % ne peut pas être comptabilisée',
      public.posting_roles_label(_manquants), _inv.invoice_number
      USING ERRCODE = 'QG001',
            HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
  END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (_inv.tenant_id, 'JE-AP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(_inv.id::text, 1, 8),
          _inv.invoice_date, 'AP Invoice: ' || _inv.invoice_number, 'ap_invoice', 'draft', _inv.created_by)
  RETURNING id INTO _entry_id;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _purchases, _net, 0, 'DR Achats HT');
  IF _tax <> 0 THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _vat, _tax, 0, 'DR TVA déductible');
  END IF;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES (_entry_id, _payable, 0, _total, 'CR Fournisseurs');

  UPDATE public.journal_entries SET status = 'posted', posted_by = _inv.created_by, posted_at = now()
   WHERE id = _entry_id;
  RETURN _entry_id;
END $$;

REVOKE ALL ON FUNCTION public.ap_invoice_journal_entry(public.ap_invoices) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.on_ap_invoice_posted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.approval_status <> 'approved' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'open', 'posted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.approval_status = NEW.approval_status THEN RETURN NEW; END IF;

  NEW.journal_entry_id := public.ap_invoice_journal_entry(NEW);
  RETURN NEW;
END; $$;

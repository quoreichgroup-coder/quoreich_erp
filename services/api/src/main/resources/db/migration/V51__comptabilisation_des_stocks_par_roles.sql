-- V51 — Comptabilisation des stocks par rôles (audit G-19, Lot 3).
--
-- Avant : on_stock_movement_je cherchait les comptes 3100 / 6010 / 6580 / 4010 par leur numéro,
-- sortait en silence s'ils n'existaient pas, et créditait le compte FOURNISSEUR (4010) à chaque
-- réception — alors que la facture fournisseur (V37) crédite déjà 401 : le jour où le compte de
-- stock aurait existé, chaque achat stocké aurait été une dette comptée deux fois. Les transferts
-- entre dépôts passaient eux aussi par 4010 (deux écritures parasites).
--
-- Après — inventaire permanent compatible SYSCOHADA (comptes 31 / 6031), sans toucher la
-- comptabilisation des factures fournisseurs (achats en 601) :
--   entrée en stock (réception, retour client, ajustement +) : DR Stocks (INVENTORY) / CR Variation des stocks (STOCK_VARIATION)
--   sortie de stock (livraison, sortie, ajustement −)        : DR Variation des stocks / CR Stocks
--   transfert entre dépôts                                   : aucune écriture (même compte de stock)
-- Achats (601) + variation (6031) = coût des marchandises vendues ; 401 n'est plus jamais touché
-- par un mouvement de stock. Même schéma que l'inventaire permanent « à la française » de Sage X3.
--
-- Mode de suivi : inventory_settings.auto_je_on_movement = inventaire permanent (écriture à chaque
-- mouvement, rôles obligatoires, refus QG001 s'il en manque un) ; à faux = inventaire intermittent
-- (variation constatée à l'inventaire de clôture, aucune écriture par mouvement). Les sociétés
-- existantes sans compte de stock passent explicitement en intermittent : c'est exactement ce
-- qu'elles avaient (aucun compte → aucune écriture), mais dit au lieu d'être silencieux.
-- Constat avant migration : 0 écriture de stock sur les deux bases, rien à corriger.

-- ─── Rôles et référentiel ───
INSERT INTO public.posting_roles (code, label, module, description) VALUES
  ('INVENTORY', 'Stocks de marchandises', 'STK', 'Débité des entrées en stock (réception, retour client, ajustement positif), crédité des sorties'),
  ('STOCK_VARIATION', 'Variation des stocks', 'STK', 'Contrepartie des mouvements de stock en inventaire permanent ; avec les achats, donne le coût des marchandises vendues')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.accounting_framework_accounts (framework_code, code, name, account_type)
SELECT 'SYSCOHADA_REVISE', v.code, v.name, v.account_type
  FROM (VALUES ('311', 'Marchandises', 'asset'), ('6031', 'Variations des stocks de marchandises', 'expense')) AS v(code, name, account_type)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_accounts a WHERE a.framework_code = 'SYSCOHADA_REVISE' AND a.code = v.code);
INSERT INTO public.accounting_framework_role_defaults (framework_code, role_code, account_code)
SELECT 'SYSCOHADA_REVISE', v.role_code, v.account_code
  FROM (VALUES ('INVENTORY', '311'), ('STOCK_VARIATION', '6031')) AS v(role_code, account_code)
 WHERE EXISTS (SELECT 1 FROM public.accounting_frameworks WHERE code = 'SYSCOHADA_REVISE')
   AND NOT EXISTS (SELECT 1 FROM public.accounting_framework_role_defaults d WHERE d.framework_code = 'SYSCOHADA_REVISE' AND d.role_code = v.role_code);

-- Sociétés ayant déjà appliqué SYSCOHADA : comptes et rôles ajoutés (jamais de choix écrasé).
INSERT INTO public.gl_accounts (tenant_id, code, name, account_type)
SELECT s.tenant_id, v.code, v.name, v.account_type
  FROM public.tenant_accounting_settings s
 CROSS JOIN (VALUES ('311', 'Marchandises', 'asset'), ('6031', 'Variations des stocks de marchandises', 'expense')) AS v(code, name, account_type)
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO public.tenant_posting_accounts (tenant_id, role_code, gl_account_id)
SELECT s.tenant_id, v.role_code, g.id
  FROM public.tenant_accounting_settings s
 CROSS JOIN (VALUES ('INVENTORY', '311'), ('STOCK_VARIATION', '6031')) AS v(role_code, account_code)
  JOIN public.gl_accounts g ON g.tenant_id = s.tenant_id AND g.code = v.account_code
 WHERE s.framework_code = 'SYSCOHADA_REVISE'
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- Sociétés sans les deux rôles : inventaire intermittent explicite (comportement inchangé).
UPDATE public.inventory_settings i SET auto_je_on_movement = false, updated_at = now()
 WHERE auto_je_on_movement
   AND (public.posting_account(i.tenant_id, 'INVENTORY') IS NULL OR public.posting_account(i.tenant_id, 'STOCK_VARIATION') IS NULL);
INSERT INTO public.inventory_settings (tenant_id, auto_je_on_movement)
SELECT t.id, false FROM public.tenants t
 WHERE NOT EXISTS (SELECT 1 FROM public.inventory_settings i WHERE i.tenant_id = t.id)
   AND (public.posting_account(t.id, 'INVENTORY') IS NULL OR public.posting_account(t.id, 'STOCK_VARIATION') IS NULL);

COMMENT ON COLUMN public.inventory_settings.auto_je_on_movement IS
  'Vrai : inventaire permanent (écriture Stocks / Variation des stocks à chaque mouvement, rôles INVENTORY et STOCK_VARIATION obligatoires, QG001 sinon). Faux : inventaire intermittent.';
COMMENT ON COLUMN public.inventory_settings.stock_account_code IS 'Obsolète depuis V51 (rôle INVENTORY) ; plus lu.';
COMMENT ON COLUMN public.inventory_settings.cogs_account_code IS 'Obsolète depuis V51 (rôle STOCK_VARIATION) ; plus lu.';
COMMENT ON COLUMN public.inventory_settings.variance_account_code IS 'Obsolète depuis V51 (rôle STOCK_VARIATION) ; plus lu.';

-- ─── Écriture de stock ───
CREATE OR REPLACE FUNCTION public.on_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _permanent boolean;
  _stock_acc uuid; _variation_acc uuid;
  _entry_id uuid;
  _value numeric := COALESCE(NEW.total_value, 0);
  _is_in boolean := COALESCE(NEW.quantity, 0) > 0;
  _label text;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.status <> 'posted' OR _value <= 0 THEN RETURN NEW; END IF;
  -- Un transfert entre dépôts ne change pas la valeur du stock de la société.
  IF NEW.movement_type LIKE 'transfer%' THEN RETURN NEW; END IF;

  SELECT auto_je_on_movement INTO _permanent FROM public.inventory_settings WHERE tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_permanent, true) THEN RETURN NEW; END IF;   -- inventaire intermittent

  _stock_acc := public.require_posting_account(NEW.tenant_id, 'INVENTORY');
  _variation_acc := public.require_posting_account(NEW.tenant_id, 'STOCK_VARIATION');

  _label := CASE NEW.movement_type
              WHEN 'receipt' THEN 'Entrée en stock — réception'
              WHEN 'customer_return' THEN 'Entrée en stock — retour client'
              WHEN 'delivery' THEN 'Sortie de stock — livraison'
              WHEN 'supplier_return' THEN 'Sortie de stock — retour fournisseur'
              WHEN 'adjustment' THEN CASE WHEN _is_in THEN 'Ajustement de stock (excédent)' ELSE 'Ajustement de stock (manquant)' END
              ELSE CASE WHEN _is_in THEN 'Entrée en stock' ELSE 'Sortie de stock' END || ' — ' || NEW.movement_type
            END;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
  VALUES (NEW.tenant_id, 'JE-STK-' || to_char(now(), 'YYYYMMDD') || '-' || substr(NEW.id::text, 1, 8),
          COALESCE(NEW.movement_date, CURRENT_DATE), _label, 'stock_movement', 'draft', NEW.created_by)
  RETURNING id INTO _entry_id;

  IF _is_in THEN
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _stock_acc, _value, 0, _label), (_entry_id, _variation_acc, 0, _value, _label);
  ELSE
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _variation_acc, _value, 0, _label), (_entry_id, _stock_acc, 0, _value, _label);
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_by = NEW.created_by, posted_at = now() WHERE id = _entry_id;
  UPDATE public.stock_movements SET journal_entry_id = _entry_id WHERE id = NEW.id;
  RETURN NEW;
END $function$;

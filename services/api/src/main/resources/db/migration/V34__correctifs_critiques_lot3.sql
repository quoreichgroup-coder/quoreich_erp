-- V34 — Lot 3, correctifs critiques (audit docs/audit-lot3.md). Écrit à la main.
--
-- Constatés sur la copie réelle, en transaction annulée :
--   ACH-1  la réception de marchandises comptait le stock deux fois : on_gr_completed insérait un
--          mouvement de stock (que apply_stock_movement ajoute déjà à quantity_on_hand) ET mettait
--          la quantité à jour directement — 5 unités reçues, stock de 0 à 10 ;
--          le mouvement était valorisé à 0 (coût de la ligne de commande non repris) : le coût
--          moyen pondéré, base de la marge réelle (Lot 1), ignorait les achats ;
--   ACH-2  une commande déjà « reçue » acceptait une nouvelle réception (sur-réception) ; une
--          réception partielle passait la commande à « reçue » ; une réception validée pouvait
--          être remise en attente puis revalidée (stock compté à nouveau) ;
--   AP-8   les écritures de paiement (fournisseur et client) n'avaient pas de date : la valeur par
--          défaut (date du jour) au lieu de payment_date — un paiement antidaté tombait dans la
--          mauvaise période ;
--   GL-1   la politique « Access via entry » FOR ALL sur journal_lines s'ajoutait aux politiques
--          comptable / administrateur et les annulait : tout membre modifiait les lignes d'une
--          écriture en brouillon.
--
-- Jumelle : supabase/migrations/20261113220000_6c2e9a4b-8d1f-4e7a-b5c3-0a9d4f2e7b18.sql

-- ─── Réception de marchandises ───
CREATE OR REPLACE FUNCTION public.on_gr_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _po public.purchase_orders%ROWTYPE;
  _ligne record;
  _lignes integer;
  _restant numeric;
BEGIN
  -- En-tête figé et création « en attente » : garde_goods_receipt (BEFORE). Ici, la validation.
  IF TG_OP <> 'UPDATE' OR NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _po FROM public.purchase_orders WHERE id = NEW.po_id FOR UPDATE;
  IF NOT FOUND OR _po.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Réception % : commande introuvable', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;
  IF _po.status NOT IN ('approved', 'ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Réception refusée : la commande % est « % » (approuvée, commandée ou partiellement reçue requise)',
      _po.po_number, _po.status USING ERRCODE = 'QG004';
  END IF;

  -- La réception est datée : elle tombe dans une période ouverte des achats (calendrier V33).
  PERFORM public.assert_fiscal_period_open(NEW.tenant_id, NEW.receipt_date, 'PURCHASING');

  SELECT count(*) INTO _lignes FROM public.gr_lines WHERE gr_id = NEW.id;
  IF _lignes = 0 THEN
    RAISE EXCEPTION 'Réception % sans ligne', NEW.gr_number USING ERRCODE = 'QG004';
  END IF;

  -- Chaque ligne reçue se rapporte à une ligne de CETTE commande, sans dépasser le restant dû.
  FOR _ligne IN
    SELECT gl.id, gl.po_line_id, gl.item_id AS gr_item, gl.quantity_received, gl.quantity_rejected, pl.po_id, pl.quantity AS commande,
           pl.item_id, pl.unit_cost, pl.description,
           COALESCE((SELECT sum(g2.quantity_received) FROM public.gr_lines g2
                       JOIN public.goods_receipts r2 ON r2.id = g2.gr_id
                      WHERE g2.po_line_id = gl.po_line_id AND r2.status = 'completed' AND r2.id <> NEW.id), 0) AS deja_recu
    FROM public.gr_lines gl
    LEFT JOIN public.po_lines pl ON pl.id = gl.po_line_id
    WHERE gl.gr_id = NEW.id
  LOOP
    IF _ligne.po_line_id IS NULL OR _ligne.po_id IS DISTINCT FROM NEW.po_id THEN
      RAISE EXCEPTION 'Réception % : chaque ligne doit se rapporter à une ligne de la commande %', NEW.gr_number, _po.po_number
        USING ERRCODE = 'QG004';
    END IF;
    IF _ligne.gr_item IS NOT NULL AND _ligne.item_id IS NOT NULL AND _ligne.gr_item <> _ligne.item_id THEN
      RAISE EXCEPTION 'Réception % : l''article reçu diffère de celui de la ligne de commande « % »', NEW.gr_number,
        COALESCE(_ligne.description, 'ligne') USING ERRCODE = 'QG004';
    END IF;
    IF COALESCE(_ligne.quantity_received, 0) < 0 OR COALESCE(_ligne.quantity_rejected, 0) < 0 THEN
      RAISE EXCEPTION 'Réception % : quantités négatives refusées', NEW.gr_number USING ERRCODE = 'QG004';
    END IF;
    _restant := _ligne.commande - _ligne.deja_recu;
    IF _ligne.quantity_received > _restant THEN
      RAISE EXCEPTION 'Sur-réception refusée (« % ») : commandé %, déjà reçu %, reçu maintenant %',
        COALESCE(_ligne.description, 'ligne'), _ligne.commande, _ligne.deja_recu, _ligne.quantity_received
        USING ERRCODE = 'QG004';
    END IF;
  END LOOP;

  -- Stock : un seul mouvement par ligne, valorisé au coût de la commande ; apply_stock_movement met
  -- à jour la quantité et le coût moyen (plus de mise à jour directe de items).
  INSERT INTO public.stock_movements (tenant_id, item_id, movement_type, quantity, unit_cost, movement_date,
                                      reference_type, reference_id, created_by)
  SELECT NEW.tenant_id, COALESCE(gl.item_id, pl.item_id), 'receipt', gl.quantity_received, COALESCE(pl.unit_cost, 0),
         COALESCE(NEW.receipt_date, CURRENT_DATE), 'goods_receipt', NEW.id, NEW.received_by
  FROM public.gr_lines gl
  JOIN public.po_lines pl ON pl.id = gl.po_line_id
  WHERE gl.gr_id = NEW.id AND COALESCE(gl.item_id, pl.item_id) IS NOT NULL AND gl.quantity_received > 0;

  -- Statut de la commande : entièrement reçue ou partiellement reçue.
  UPDATE public.purchase_orders p
     SET status = CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.po_lines pl
            WHERE pl.po_id = p.id
              AND pl.quantity > COALESCE((SELECT sum(g.quantity_received) FROM public.gr_lines g
                                            JOIN public.goods_receipts r ON r.id = g.gr_id
                                           WHERE g.po_line_id = pl.id AND r.status = 'completed'), 0)
         ) THEN 'received' ELSE 'partially_received' END
   WHERE p.id = NEW.po_id;
  RETURN NEW;
END;
$function$;

-- En-tête : une réception naît en attente (ses lignes s'ajoutent ensuite) ; validée, elle ne se
-- modifie ni ne se supprime plus — une erreur se corrige par un retour fournisseur.
CREATE FUNCTION public.guard_goods_receipt() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Une réception se crée en attente, avec ses lignes, puis se valide' USING ERRCODE = 'QG004';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'La réception % est validée : elle ne se modifie plus', OLD.gr_number USING ERRCODE = 'QG004';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status NOT IN ('pending', 'completed') THEN
    RAISE EXCEPTION 'Statut de réception inconnu : %', NEW.status USING ERRCODE = 'QG004';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_goods_receipt BEFORE INSERT OR UPDATE OR DELETE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_goods_receipt();

-- Les lignes d'une réception validée sont figées.
CREATE FUNCTION public.guard_gr_lines() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _gr uuid := COALESCE(NEW.gr_id, OLD.gr_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.goods_receipts WHERE id = _gr AND status = 'completed')
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.goods_receipts WHERE id = OLD.gr_id AND status = 'completed')) THEN
    RAISE EXCEPTION 'Les lignes d''une réception validée ne se modifient plus' USING ERRCODE = 'QG004';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_gr_lines BEFORE INSERT OR UPDATE OR DELETE ON public.gr_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_gr_lines();

-- ─── Écritures de paiement datées du paiement ───
CREATE OR REPLACE FUNCTION public.on_ap_payment_recorded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _entry_id uuid; _entry_number text;
  _payable uuid; _bank uuid; _ar uuid;
  _manquants text[] := '{}';
  _date date := COALESCE(NEW.payment_date, CURRENT_DATE);
BEGIN
  IF NEW.payment_type = 'ap_payment' AND NEW.ap_invoice_id IS NOT NULL THEN
    _payable := public.posting_account(NEW.tenant_id, 'AP_PAYABLE');
    _bank    := public.posting_account(NEW.tenant_id, 'BANK');

    IF _payable IS NULL THEN _manquants := _manquants || 'AP_PAYABLE'::text; END IF;
    IF _bank    IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; le paiement fournisseur ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-PAY-AP-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AP Payment: '||COALESCE(NEW.reference, NEW.id::text), 'ap_payment', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _payable, NEW.amount, 0, 'DR Fournisseurs');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, 0, NEW.amount, 'CR Banque');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  IF NEW.payment_type = 'ar_receipt' AND NEW.ar_invoice_id IS NOT NULL THEN
    _bank := public.posting_account(NEW.tenant_id, 'BANK');
    _ar   := public.posting_account(NEW.tenant_id, 'AR_RECEIVABLE');

    IF _bank IS NULL THEN _manquants := _manquants || 'BANK'::text; END IF;
    IF _ar   IS NULL THEN _manquants := _manquants || 'AR_RECEIVABLE'::text; END IF;
    IF cardinality(_manquants) > 0 THEN
      RAISE EXCEPTION 'Paramétrage comptable incomplet : % ; l''encaissement ne peut pas être enregistré',
        public.posting_roles_label(_manquants)
        USING ERRCODE = 'QG001',
              HINT = 'Associer un compte actif à chaque rôle dans le paramétrage comptable.';
    END IF;

    _entry_number := 'JE-REC-AR-' || to_char(now(),'YYYYMMDD') || '-' || substr(NEW.id::text,1,8);
    INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source, status, created_by)
    VALUES (NEW.tenant_id, _entry_number, _date, 'AR Receipt: '||COALESCE(NEW.reference, NEW.id::text), 'ar_receipt', 'draft', NEW.created_by)
    RETURNING id INTO _entry_id;
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _bank, NEW.amount, 0, 'DR Banque');
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (_entry_id, _ar, 0, NEW.amount, 'CR Clients');
    UPDATE public.journal_entries SET status='posted', posted_by=NEW.created_by, posted_at=now() WHERE id=_entry_id;
  END IF;

  RETURN NEW;
END; $function$;

-- ─── Lignes d'écriture : plus de politique FOR ALL qui annule les droits ───
DROP POLICY "Access via entry" ON public.journal_lines;

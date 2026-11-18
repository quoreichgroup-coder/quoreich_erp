-- Run after all Flyway migrations and fixtures/reference-dataset.sql on a disposable database.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000091');
INSERT INTO public.profiles(id,tenant_id,full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000091','11111111-1111-1111-1111-111111111111','Compteur S3');
INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001', r.id, r.tenant_id
FROM public.erp_roles r WHERE r.tenant_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'admin'
ON CONFLICT (user_id, role_id) DO NOTHING;
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000091',r.id,r.tenant_id
FROM public.erp_roles r WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code='inventory_clerk';

DO $$
DECLARE
  tenant_a uuid := '11111111-1111-1111-1111-111111111111';
  tenant_b uuid := '22222222-2222-2222-2222-222222222222';
  depot_a uuid := gen_random_uuid();
  depot_open uuid := gen_random_uuid();
  depot_b uuid := gen_random_uuid();
  item_a uuid := gen_random_uuid();
  item_b uuid := gen_random_uuid();
  _campaign_id uuid;
  response jsonb;
BEGIN
  INSERT INTO public.warehouses (id,tenant_id,code,name)
  VALUES (depot_a,tenant_a,'S3-CLOSED','S3 dépôt gelé'),
         (depot_open,tenant_a,'S3-OPEN','S3 dépôt ouvert'),
         (depot_b,tenant_b,'S3-B','S3 autre société');
  INSERT INTO public.items (id,tenant_id,code,name,quantity_on_hand,average_cost)
  VALUES (item_a,tenant_a,'S3-ITEM','Article S3',7,1000),
         (item_b,tenant_b,'S3-ITEM-B','Article autre société',0,0);
  INSERT INTO public.item_locations (tenant_id,item_id,warehouse_id,quantity_on_hand)
  VALUES (tenant_a,item_a,depot_a,7);
  INSERT INTO public.inventory_settings (tenant_id,auto_je_on_movement)
  VALUES (tenant_a,false) ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement = false;

  PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000091","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.inventory_campaign('open',depot_b);
    RAISE EXCEPTION 'Cross-tenant opening unexpectedly succeeded';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  response := public.inventory_campaign('open',depot_a);
  _campaign_id := (response->>'id')::uuid;
  IF _campaign_id IS NULL OR (response->'lines'->0) ? 'expected' THEN RAISE EXCEPTION 'Blind response invalid'; END IF;
  IF response#>>'{lines,0,name}' IS DISTINCT FROM 'Article S3' OR response#>>'{lines,0,unit}' IS NULL
    THEN RAISE EXCEPTION 'Missing item label or unit'; END IF;
  BEGIN
    PERFORM public.inventory_campaign('count',_campaign_id,item_a,1.001);
    RAISE EXCEPTION 'Quantity with more than two decimals unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.transfer_stock(item_a,depot_a,depot_open,1,'S3 frozen transfer');
    RAISE EXCEPTION 'Frozen transfer unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM public.inventory_campaign('count',_campaign_id,item_a,0);
  response := public.inventory_campaign('submit',_campaign_id);
  IF response->>'state' <> 'submitted' THEN RAISE EXCEPTION 'Submission failed'; END IF;
  BEGIN
    PERFORM public.inventory_campaign('cancel',_campaign_id,_reason => '   ');
    RAISE EXCEPTION 'Cancellation without a reason unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
  IF public.inventory_campaign('read',_campaign_id)->>'can_cancel' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'Inventory approver cannot recover a campaign opened by a different user'; END IF;
  PERFORM public.inventory_campaign('cancel',_campaign_id,_reason => 'Fin de recette S3');
  PERFORM public.transfer_stock(item_a,depot_a,depot_open,1,'S3 after cancellation');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_campaigns c WHERE c.id = _campaign_id
    AND c.cancel_reason = 'Fin de recette S3' AND c.decided_by = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND c.decided_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Cancellation audit incomplete'; END IF;
  BEGIN
    INSERT INTO public.inventory_campaign_lines(tenant_id,campaign_id,item_id,expected)
    VALUES (tenant_a,_campaign_id,item_b,0);
    RAISE EXCEPTION 'A campaign line accepted an item from another company';
  EXCEPTION WHEN SQLSTATE 'QG017' THEN NULL; END;
  BEGIN
    INSERT INTO public.inventory_campaign_lines(tenant_id,campaign_id,item_id,expected)
    VALUES (tenant_b,_campaign_id,item_b,0);
    RAISE EXCEPTION 'A campaign line accepted a campaign from another company';
  EXCEPTION WHEN SQLSTATE 'QG017' THEN NULL; END;
  IF (SELECT l.quantity_on_hand FROM public.item_locations l WHERE l.item_id = item_a AND l.warehouse_id = depot_a) <> 6
    THEN RAISE EXCEPTION 'Unexpected source quantity after transfer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_campaign_lines l WHERE l.campaign_id = _campaign_id AND l.expected = 7 AND l.counted = 0)
    THEN RAISE EXCEPTION 'Campaign snapshot did not remain intact'; END IF;
  RAISE NOTICE 'S3 full-schema campaign scenario passed';
END $$;
ROLLBACK;

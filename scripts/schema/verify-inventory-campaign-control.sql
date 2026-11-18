-- Run with the V93+ schema and the reference dataset in a disposable database.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000193'),('aaaaaaaa-0000-0000-0000-000000000293');
INSERT INTO public.profiles(id,tenant_id,full_name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000193','11111111-1111-1111-1111-111111111111','Premier compteur'),
 ('aaaaaaaa-0000-0000-0000-000000000293','11111111-1111-1111-1111-111111111111','Second compteur');
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT u.id,r.id,r.tenant_id FROM public.erp_roles r CROSS JOIN
 (VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid,'admin'),
         ('aaaaaaaa-0000-0000-0000-000000000193'::uuid,'inventory_manager'),
         ('aaaaaaaa-0000-0000-0000-000000000293'::uuid,'inventory_clerk')) u(id,role)
 WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code=u.role
ON CONFLICT (user_id,role_id) DO NOTHING;
SELECT public.apply_accounting_framework_to('11111111-1111-1111-1111-111111111111','SYSCOHADA_REVISE',NULL);
INSERT INTO public.inventory_settings(tenant_id,auto_je_on_movement)
 VALUES ('11111111-1111-1111-1111-111111111111',true)
 ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement=true;

DO $$
DECLARE
 t uuid := '11111111-1111-1111-1111-111111111111';
 depot uuid := gen_random_uuid();
 item uuid := gen_random_uuid();
 exact_item uuid := gen_random_uuid();
 c uuid;
 r jsonb;
 admin_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
 first_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000193","role":"authenticated"}';
 second_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000293","role":"authenticated"}';
BEGIN
 INSERT INTO public.warehouses(id,tenant_id,code,name) VALUES (depot,t,'S3-CONTROL','Contrôle S3');
 INSERT INTO public.items(id,tenant_id,code,name,quantity_on_hand,average_cost)
  VALUES (item,t,'S3-CONTROL','Article contrôle',7,1000),(exact_item,t,'S3-ZERO-DIFFERENCE','Article sans écart',1,1000);
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES (t,item,depot,7);
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES (t,exact_item,depot,1);
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM set_config('request.jwt.claims',first_claims,true);
 c := (public.inventory_campaign('open',depot)->>'id')::uuid;
 PERFORM public.inventory_campaign('count',c,item,4);
 PERFORM set_config('request.jwt.claims',second_claims,true);
 r := public.inventory_campaign('read',c);
 IF r#>>'{lines,0,can_edit}' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'An existing count is open to another actor'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_save_counts(c,'first',jsonb_build_array(
     jsonb_build_object('item_id',item,'quantity',7),jsonb_build_object('item_id',exact_item,'quantity',1)));
   RAISE EXCEPTION 'A bulk import overwrote the first counter';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.inventory_campaign('read',c)#>>'{lines,1,is_counted}' IS DISTINCT FROM 'false'
   THEN RAISE EXCEPTION 'Rejected count import was partially written'; END IF;
 PERFORM set_config('request.jwt.claims',first_claims,true);
 PERFORM public.inventory_campaign('count',c,exact_item,1);
 PERFORM public.inventory_campaign('submit',c);
 BEGIN
   PERFORM public.inventory_campaign_control('review',c);
   RAISE EXCEPTION 'A counter can review the campaign';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 BEGIN
   PERFORM public.inventory_campaign_control('review',c);
   RAISE EXCEPTION 'A company with no thresholds could review the campaign';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM public.inventory_campaign_policy('save',20,1000);
 r := public.inventory_campaign_control('review',c);
 IF (r#>>'{lines,0,requires_recount}') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Tolerance not applied'; END IF;
 PERFORM public.inventory_campaign_policy('save',100,1000000);
 r := public.inventory_campaign_control('review',c);
 IF r->>'percent' IS DISTINCT FROM '20' THEN RAISE EXCEPTION 'The frozen campaign policy changed'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_control('validate',c);
   RAISE EXCEPTION 'Validation bypassed the recount';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM public.inventory_campaign_control('request_recount',c);
 PERFORM set_config('request.jwt.claims',first_claims,true);
 BEGIN
   PERFORM public.inventory_campaign_control('count_again',c,item,5);
   RAISE EXCEPTION 'First counter repeated the count';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',second_claims,true);
 r := public.inventory_campaign('active',depot);
 IF r#>>'{lines,0,counted}' IS NOT NULL THEN RAISE EXCEPTION 'First count visible in base RPC'; END IF;
 r := public.inventory_campaign_control('recount_tasks',c);
 IF (r->'lines'->0) ?| ARRAY['expected','first_count'] OR r#>>'{lines,0,item_id}' IS DISTINCT FROM item::text
   THEN RAISE EXCEPTION 'Recount is not blind'; END IF;
 PERFORM public.inventory_campaign_control('count_again',c,item,5);
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 RESET ROLE;
 INSERT INTO public.period_locks(tenant_id,module,period,status) VALUES (t,'INVENTORY',to_char(CURRENT_DATE,'YYYY-MM'),'closed')
 ON CONFLICT (tenant_id,period,module) DO UPDATE SET status='closed';
 SET LOCAL ROLE authenticated;
 BEGIN
   PERFORM public.inventory_campaign_control('validate',c);
   RAISE EXCEPTION 'Validation ignored the closed inventory period';
 EXCEPTION WHEN SQLSTATE 'QG003' THEN NULL; END;
 r := public.inventory_campaign('active',depot);
 IF r->>'state' IS DISTINCT FROM 'submitted' THEN RAISE EXCEPTION 'A rejected validation released the campaign'; END IF;
 IF jsonb_array_length(public.inventory_campaign_timeline(c,t)) <> 2
   THEN RAISE EXCEPTION 'Rejected validation left an audit event'; END IF;
 RESET ROLE;
 IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=c)
   THEN RAISE EXCEPTION 'A rejected validation left a partial stock movement'; END IF;
 UPDATE public.period_locks p SET status='open' WHERE p.tenant_id=t AND p.module='INVENTORY' AND p.period=to_char(CURRENT_DATE,'YYYY-MM');
 UPDATE public.items i SET unit='carton' WHERE i.id=item;
 SET LOCAL ROLE authenticated;
 IF public.inventory_campaign('read',c)#>>'{lines,0,unit}' IS DISTINCT FROM 'unit'
   THEN RAISE EXCEPTION 'The count sheet unit was not kept stable'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_control('validate',c);
   RAISE EXCEPTION 'Validation used a different unit than the opening snapshot';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 RESET ROLE;
 UPDATE public.items i SET unit='unit' WHERE i.id=item;
 SET LOCAL ROLE authenticated;
 r := public.inventory_campaign_control('validate',c);
 IF r->>'state' IS DISTINCT FROM 'validated' THEN RAISE EXCEPTION 'Campaign was not validated'; END IF;
 IF r#>>'{lines,0,movement_id}' IS NULL OR r#>>'{lines,0,journal_piece_number}' IS NULL
   OR r#>>'{lines,1,movement_id}' IS NOT NULL THEN
   RAISE EXCEPTION 'The reconciliation report does not match actual movements and journal pieces';
 END IF;
 IF public.inventory_campaign_timeline(c,t)#>>'{2,event}' IS DISTINCT FROM 'validated'
   THEN RAISE EXCEPTION 'Successful validation was not audited'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_control('validate',c);
   RAISE EXCEPTION 'Campaign validated twice';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 RESET ROLE;
 IF NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=c AND m.item_id=item
   AND m.warehouse_id=depot AND m.quantity=-2 AND m.unit_cost=1000 AND m.journal_entry_id IS NOT NULL)
   THEN RAISE EXCEPTION 'Inventory adjustment or resulting journal entry missing'; END IF;
 IF (SELECT count(*) FROM public.stock_movements m WHERE m.reference_id=c) <> 1
   THEN RAISE EXCEPTION 'More than one adjustment posted'; END IF;
 IF (SELECT l.quantity_on_hand FROM public.item_locations l WHERE l.item_id=item AND l.warehouse_id=depot) <> 5
   THEN RAISE EXCEPTION 'Unexpected depot quantity after validation'; END IF;
 RAISE NOTICE 'S3 control, blind recount, single validation and accounting passed';
END $$;
ROLLBACK;

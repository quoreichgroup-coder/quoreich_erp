-- V96: real value-based classes, no automatic freeze, and no repeat before a configured interval.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000496');
INSERT INTO public.profiles(id,tenant_id,full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000496','11111111-1111-1111-1111-111111111111','Compteur tournant');
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT u.id,r.id,r.tenant_id FROM public.erp_roles r CROSS JOIN
 (VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid,'admin'),
         ('aaaaaaaa-0000-0000-0000-000000000496'::uuid,'inventory_clerk')) u(id,role)
 WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code=u.role
ON CONFLICT (user_id,role_id) DO NOTHING;

DO $$
DECLARE
 t uuid := '11111111-1111-1111-1111-111111111111';
 depot uuid := gen_random_uuid();
 depot_out uuid := gen_random_uuid();
 a uuid := gen_random_uuid();
 b uuid := gen_random_uuid();
 c uuid := gen_random_uuid();
 zero uuid := gen_random_uuid();
 campaign uuid;
 p jsonb;
 plan jsonb;
 analysis jsonb;
 admin_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
 count_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000496","role":"authenticated"}';
BEGIN
 INSERT INTO public.warehouses(id,tenant_id,code,name) VALUES (depot,t,'S3-ABC','Dépôt tournant');
 INSERT INTO public.items(id,tenant_id,code,name,quantity_on_hand,average_cost) VALUES
   (a,t,'ABC-A','Classe A',8,100),(b,t,'ABC-B','Classe B',3,50),
   (c,t,'ABC-C','Classe C',50,1),(zero,t,'ABC-Z','Non valorisé',0,0);
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand)
 VALUES (t,a,depot,8),(t,b,depot,3),(t,c,depot,50),(t,zero,depot,0);
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 IF (public.inventory_cycle_policy('read',t)->>'configured') IS DISTINCT FROM 'false'
   THEN RAISE EXCEPTION 'Cycle settings should not have implicit frequencies'; END IF;
 p := '{"basis":"stock_value","lookback_months":null,"a_percent":70,"b_percent":90,"a_days":30,"b_days":60,"c_days":90,"unvalued_days":null,"batch_size":2}';
 PERFORM public.inventory_cycle_policy('save',t,p);
 PERFORM public.inventory_campaign_policy('save',100,NULL);
 PERFORM set_config('request.jwt.claims',count_claims,true);
 plan := public.inventory_cycle_prepare('preview',depot,t);
 analysis := public.inventory_cycle_analysis(depot,t);
 IF analysis->>'total_articles' IS DISTINCT FROM '4' OR analysis->>'due_total' IS DISTINCT FROM plan->>'due_total'
   OR analysis#>>'{top,0,class}' IS DISTINCT FROM plan#>>'{lines,0,class}' THEN
   RAISE EXCEPTION 'ABC reporting and the cycle plan use different classifications';
 END IF;
 IF plan->>'due_total' IS DISTINCT FROM '3' OR (plan->'lines'->0) ? 'quantity'
   OR plan#>>'{lines,0,class}' IS DISTINCT FROM 'A' OR plan#>>'{lines,1,class}' IS DISTINCT FROM 'B' THEN
   RAISE EXCEPTION 'Cycle classification, ordering or blind data is wrong';
 END IF;
 IF public.inventory_campaign('active',depot) IS NOT NULL THEN RAISE EXCEPTION 'Preview unexpectedly froze the depot'; END IF;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM public.inventory_cycle_policy('save',t,jsonb_set(p,'{batch_size}','1'::jsonb));
 PERFORM set_config('request.jwt.claims',count_claims,true);
 BEGIN
   PERFORM public.inventory_cycle_prepare('open',depot,t,plan->>'signature');
   RAISE EXCEPTION 'A stale preview opened a campaign';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM public.inventory_cycle_policy('save',t,p);
 PERFORM set_config('request.jwt.claims',count_claims,true);
 plan := public.inventory_cycle_prepare('preview',depot,t);
 plan := public.inventory_cycle_prepare('open',depot,t,plan->>'signature');
 campaign := (plan->>'id')::uuid;
 IF plan->>'item_scope' IS DISTINCT FROM 'cycle' OR jsonb_array_length(plan->'lines') <> 2
   THEN RAISE EXCEPTION 'The opened campaign did not preserve the planned scope'; END IF;
 PERFORM public.inventory_campaign_save_counts(campaign,'first',jsonb_build_array(
   jsonb_build_object('item_id',a,'quantity',8),jsonb_build_object('item_id',b,'quantity',3)));
 PERFORM public.inventory_campaign('submit',campaign);
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM public.inventory_campaign_control('validate',campaign);
 plan := public.inventory_cycle_prepare('preview',depot,t);
 IF plan->>'due_total' IS DISTINCT FROM '1' OR plan#>>'{lines,0,item_id}' IS DISTINCT FROM c::text
   THEN RAISE EXCEPTION 'A newly validated count was incorrectly proposed again'; END IF;
 RESET ROLE;
 INSERT INTO public.warehouses(id,tenant_id,code,name) VALUES (depot_out,t,'S3-ABC-OUT','Sorties du dépôt tournant');
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand)
 VALUES (t,a,depot_out,4),(t,b,depot_out,4),(t,c,depot_out,4);
 UPDATE public.inventory_settings s SET auto_je_on_movement=false WHERE s.tenant_id=t;
 INSERT INTO public.stock_movements(tenant_id,item_id,warehouse_id,movement_type,quantity,unit_cost,
   movement_date,created_by,status)
 VALUES
   (t,a,depot_out,'issue',-1,80,CURRENT_DATE,'aaaaaaaa-0000-0000-0000-000000000001','posted'),
   (t,b,depot_out,'issue',-1,20,CURRENT_DATE,'aaaaaaaa-0000-0000-0000-000000000001','posted'),
   (t,c,depot_out,'adjustment',-1,1000,CURRENT_DATE,'aaaaaaaa-0000-0000-0000-000000000001','posted'),
   (t,c,depot_out,'transfer_out',-1,1000,CURRENT_DATE,'aaaaaaaa-0000-0000-0000-000000000001','posted'),
   (t,c,depot_out,'issue',-1,1000,(CURRENT_DATE - interval '6 months')::date,
     'aaaaaaaa-0000-0000-0000-000000000001','posted');
 SET LOCAL ROLE authenticated;
 PERFORM public.inventory_cycle_policy('save',t,p || '{"basis":"outflow_value","lookback_months":3}'::jsonb);
 plan := public.inventory_cycle_prepare('preview',depot_out,t);
 IF plan->>'due_total' IS DISTINCT FROM '2' OR plan#>>'{lines,0,item_id}' IS DISTINCT FROM a::text
   OR plan#>>'{lines,1,item_id}' IS DISTINCT FROM b::text THEN
   RAISE EXCEPTION 'The consumption window, exclusions, or depot isolation is incorrect';
 END IF;
 analysis := public.inventory_cycle_analysis(depot_out,t);
 IF analysis->>'lookback_months' IS DISTINCT FROM '3'
   OR (analysis->>'total_weight')::numeric IS DISTINCT FROM 100
   OR analysis->>'due_total' IS DISTINCT FROM plan->>'due_total' THEN
   RAISE EXCEPTION 'The ABC report does not reflect the configured outflow window and exclusions';
 END IF;
 BEGIN
   PERFORM public.inventory_cycle_analysis(depot_out,'22222222-2222-2222-2222-222222222222');
   RAISE EXCEPTION 'The ABC report accepted a mismatched company';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 RAISE NOTICE 'S3 cycle classification, stale preview and intervals passed';
END $$;
ROLLBACK;

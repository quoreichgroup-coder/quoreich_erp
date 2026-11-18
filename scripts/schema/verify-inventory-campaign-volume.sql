-- Ensure that a single campaign and a count batch can exceed one normal REST page.
BEGIN;
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001',r.id,r.tenant_id
FROM public.erp_roles r WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code='admin'
ON CONFLICT (user_id,role_id) DO NOTHING;
DO $$
DECLARE
 t uuid := '11111111-1111-1111-1111-111111111111';
 depot uuid := gen_random_uuid();
 campaign uuid;
 response jsonb;
 entries jsonb;
BEGIN
 INSERT INTO public.warehouses(id,tenant_id,code,name) VALUES (depot,t,'S3-VOLUME','Dépôt recette volume');
 WITH created AS (
   INSERT INTO public.items(tenant_id,code,name,quantity_on_hand)
   SELECT t,'S3-VOLUME-'||lpad(n::text,4,'0'),'Article recette '||n,3 FROM generate_series(1,1205) n
   RETURNING id
 )
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand)
 SELECT t,i.id,depot,3 FROM created i;
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
 IF public.inventory_campaign_preview(depot,t)->>'articles' IS DISTINCT FROM '1205' THEN
   RAISE EXCEPTION 'Preparation stopped after a single page';
 END IF;
 response := public.inventory_campaign('open',depot);
 campaign := (response->>'id')::uuid;
 IF jsonb_array_length(response->'lines') <> 1205 THEN RAISE EXCEPTION 'Opening truncated a large campaign'; END IF;
 SELECT jsonb_agg(jsonb_build_object('item_id',l->>'item_id','quantity',0)) INTO entries
 FROM jsonb_array_elements(response->'lines') l;
 PERFORM public.inventory_campaign_save_counts(campaign,'first',entries);
 response := public.inventory_campaign_catalog(_warehouse => depot,_expected_tenant => t);
 IF response#>>'{campaigns,0,counted_lines}' IS DISTINCT FROM '1205' THEN RAISE EXCEPTION 'Batch truncated the count'; END IF;
 IF public.inventory_campaign('submit',campaign)->>'state' IS DISTINCT FROM 'submitted'
   THEN RAISE EXCEPTION 'The complete count could not be submitted'; END IF;
 PERFORM public.inventory_campaign('cancel',campaign,_reason => 'Fin du test de volume');
 RAISE NOTICE 'S3 all 1,205 campaign lines counted in one batch';
END $$;
ROLLBACK;

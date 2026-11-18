-- V94: document references, catalogue and all-or-nothing bulk count.
BEGIN;
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001',r.id,r.tenant_id
FROM public.erp_roles r WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code='admin'
ON CONFLICT (user_id,role_id) DO NOTHING;

DO $$
DECLARE
 tenant_a uuid := '11111111-1111-1111-1111-111111111111';
 tenant_b uuid := '22222222-2222-2222-2222-222222222222';
 depot uuid := gen_random_uuid();
 other_depot uuid := gen_random_uuid();
 article uuid := gen_random_uuid();
 assigned_article uuid := gen_random_uuid();
 unassigned_article uuid := gen_random_uuid();
 other_article uuid := gen_random_uuid();
 c uuid;
 c2 uuid;
 response jsonb;
 next_page jsonb;
BEGIN
 INSERT INTO public.warehouses(id,tenant_id,code,name)
 VALUES (depot,tenant_a,'S3-DOC','Dépôt documents'),(other_depot,tenant_b,'S3-DOC-OTHER','Autre société');
 INSERT INTO public.items(id,tenant_id,code,name)
 VALUES (article,tenant_a,'S3-DOC','Article documents'),(other_article,tenant_b,'S3-DOC-OTHER','Autre société'),
        (unassigned_article,tenant_a,'S3-NO-LOCATION','Article non affecté');
 INSERT INTO public.items(id,tenant_id,code,name,default_warehouse_id)
 VALUES (assigned_article,tenant_a,'S3-ASSIGNED','Article affecté sans mouvement',depot);
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES (tenant_a,article,depot,4);
 PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 response := public.inventory_campaign_numbering('read');
 IF response->>'prefix' IS NOT NULL THEN RAISE EXCEPTION 'Unexpected hard-coded reference prefix'; END IF;
 PERFORM public.inventory_campaign_numbering('save','MAG-',5,101);
 BEGIN
   UPDATE public.inventory_settings s SET default_warehouse_id = other_depot WHERE s.tenant_id = tenant_a;
   RAISE EXCEPTION 'Stock settings accepted another company depot';
 EXCEPTION WHEN SQLSTATE 'QG017' THEN NULL; END;
 PERFORM public.inventory_campaign_preview(depot,tenant_a);
 response := public.inventory_campaign('open',depot);
 c := (response->>'id')::uuid;
 IF response->>'reference' IS DISTINCT FROM 'MAG-00101' THEN RAISE EXCEPTION 'Incorrect document reference'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_save_counts(c,'first',jsonb_build_array(
     jsonb_build_object('item_id',article,'quantity',0),jsonb_build_object('item_id',other_article,'quantity',2)));
   RAISE EXCEPTION 'A bulk submission accepted an article from another company';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 response := public.inventory_campaign('read',c);
 IF response#>>'{lines,0,counted}' IS NOT NULL THEN RAISE EXCEPTION 'Bulk rejection left a partial write'; END IF;
 PERFORM public.inventory_campaign_save_counts(c,'first',jsonb_build_array(jsonb_build_object('item_id',article,'quantity',0)));
 response := public.inventory_campaign_catalog(_warehouse => depot,_search => 'MAG-00101',_export => true);
 IF response#>>'{campaigns,0,reference}' IS DISTINCT FROM 'MAG-00101'
    OR response#>>'{campaigns,0,counted_lines}' IS DISTINCT FROM '1'
    OR response#>>'{campaigns,0,id}' IS DISTINCT FROM c::text
    OR (response->'campaigns'->0) ? 'expected' THEN RAISE EXCEPTION 'Catalogue scope, progress or privacy incorrect'; END IF;
 IF jsonb_array_length(public.inventory_campaign_catalog(_warehouse => other_depot)->'campaigns') <> 0
   THEN RAISE EXCEPTION 'Other company depot was visible'; END IF;
 BEGIN
   PERFORM public.inventory_campaign_catalog(_expected_tenant => tenant_b,_export => true);
   RAISE EXCEPTION 'Export accepted a stale company scope';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.inventory_campaign_numbering('save','MAG-',5,101);
   RAISE EXCEPTION 'The reference counter moved backwards';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.inventory_campaign('cancel',c,_reason => 'Fin de recette du catalogue');
 UPDATE public.inventory_settings s SET campaign_item_scope='assigned',default_warehouse_id=depot WHERE s.tenant_id=tenant_a;
 IF public.inventory_campaign_preview(depot,tenant_a)->>'articles' IS DISTINCT FROM '2'
   THEN RAISE EXCEPTION 'The preview did not include the assigned item without movements'; END IF;
 response := public.inventory_campaign('open',depot);
 c2 := (response->>'id')::uuid;
 IF response->>'reference' IS DISTINCT FROM 'MAG-00102' THEN RAISE EXCEPTION 'The next number is wrong'; END IF;
 IF response->>'item_scope' IS DISTINCT FROM 'assigned' OR jsonb_array_length(response->'lines') <> 2 OR NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(response->'lines') l WHERE l->>'item_id' = assigned_article::text
 ) THEN RAISE EXCEPTION 'The assigned scope was not applied at opening'; END IF;
 PERFORM public.inventory_campaign_numbering('save','SITE-',5,200);
 UPDATE public.inventory_settings s SET campaign_item_scope='all_active' WHERE s.tenant_id=tenant_a;
 IF public.inventory_campaign('read',c2)->>'item_scope' IS DISTINCT FROM 'assigned'
   THEN RAISE EXCEPTION 'The existing campaign scope changed with settings'; END IF;
 PERFORM public.inventory_campaign('cancel',c2,_reason => 'Périmètre suivant');
 response := public.inventory_campaign('open',depot);
 IF response->>'reference' IS DISTINCT FROM 'SITE-00200' OR NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(response->'lines') l WHERE l->>'item_id' = unassigned_article::text
 ) OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(response->'lines') l WHERE l->>'item_id' = other_article::text
 ) THEN RAISE EXCEPTION 'The full company scope is incorrect'; END IF;
 response := public.inventory_campaign('read',c);
 IF response->>'reference' IS DISTINCT FROM 'MAG-00101' THEN RAISE EXCEPTION 'The historical reference changed'; END IF;
 response := public.inventory_campaign_timeline(c,tenant_a);
 IF response#>>'{0,event}' IS DISTINCT FROM 'opened' OR response#>>'{1,event}' IS DISTINCT FROM 'cancelled'
   OR response#>>'{1,reason}' IS DISTINCT FROM 'Fin de recette du catalogue'
   THEN RAISE EXCEPTION 'The cancellation decision is missing from the catalogue history'; END IF;
 RESET ROLE;
 INSERT INTO public.inventory_campaigns(tenant_id,warehouse_id,state,opened_by)
 SELECT tenant_a,depot,'cancelled','aaaaaaaa-0000-0000-0000-000000000001'::uuid FROM generate_series(1,53);
 SET LOCAL ROLE authenticated;
 response := public.inventory_campaign_catalog(_warehouse => depot,_state => 'cancelled',_export => true,_expected_tenant => tenant_a);
 IF jsonb_array_length(response->'campaigns') <> 50 OR response#>>'{next,id}' IS NULL
   THEN RAISE EXCEPTION 'The first catalogue page did not return a continuation'; END IF;
 next_page := public.inventory_campaign_catalog(_warehouse => depot,_state => 'cancelled',
   _before => (response#>>'{next,opened_at}')::timestamptz,_before_id => (response#>>'{next,id}')::uuid,
   _export => true,_expected_tenant => tenant_a);
 IF jsonb_array_length(next_page->'campaigns') <> 5 OR next_page->>'next' IS NOT NULL OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(response->'campaigns') a JOIN jsonb_array_elements(next_page->'campaigns') b
   ON a->>'id' = b->>'id'
 ) THEN RAISE EXCEPTION 'Catalogue pagination lost or duplicated a reference'; END IF;
 RESET ROLE;
 RAISE NOTICE 'S3 catalogue, references and bulk count passed';
END $$;
ROLLBACK;

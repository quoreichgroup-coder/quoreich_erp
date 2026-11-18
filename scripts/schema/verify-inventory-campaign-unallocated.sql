-- Counted stock must not re-enter global on-hand while it is still unallocated.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000198');
INSERT INTO public.profiles(id,tenant_id,full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000198','11111111-1111-1111-1111-111111111111','Compteur stock non affecté');
INSERT INTO public.user_role_assignments(user_id,role_id,tenant_id)
SELECT u.id,r.id,r.tenant_id FROM public.erp_roles r CROSS JOIN
 (VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid,'admin'),
         ('aaaaaaaa-0000-0000-0000-000000000198'::uuid,'inventory_clerk')) u(id,role)
 WHERE r.tenant_id='11111111-1111-1111-1111-111111111111' AND r.code=u.role
ON CONFLICT (user_id,role_id) DO NOTHING;

DO $$
DECLARE
 t uuid := '11111111-1111-1111-1111-111111111111';
 depot uuid := gen_random_uuid();
 autre_depot uuid := gen_random_uuid();
 affecte uuid := '90000000-0000-0000-0000-000000000001';
 non_affecte uuid := '90000000-0000-0000-0000-000000000002';
 campagne uuid;
 admin_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
 compteur_claims text := '{"sub":"aaaaaaaa-0000-0000-0000-000000000198","role":"authenticated"}';
BEGIN
 INSERT INTO public.warehouses(id,tenant_id,code,name) VALUES
  (depot,t,'S3-A-COMPTER','Dépôt à compter'),(autre_depot,t,'S3-AUTRE','Autre dépôt');
 INSERT INTO public.items(id,tenant_id,code,name,quantity_on_hand,average_cost) VALUES
  (affecte,t,'S3-OK','Article affecté',2,100),(non_affecte,t,'S3-RELIQUAT','Article non affecté',1,100);
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES (t,affecte,autre_depot,2);
 UPDATE public.inventory_settings s SET campaign_item_scope='all_active',auto_je_on_movement=false WHERE s.tenant_id=t;

 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM public.inventory_campaign_policy('save',NULL,1000,t);
 PERFORM set_config('request.jwt.claims',compteur_claims,true);
 campagne := (public.inventory_campaign('open',depot)->>'id')::uuid;
 PERFORM public.inventory_campaign_save_counts(campagne,'first',jsonb_build_array(
  jsonb_build_object('item_id',affecte,'quantity',1),jsonb_build_object('item_id',non_affecte,'quantity',1)));
 PERFORM public.inventory_campaign('submit',campagne);
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 BEGIN
   PERFORM public.inventory_campaign_control('validate',campagne);
   RAISE EXCEPTION 'Un stock global non affecté a été comptabilisé une deuxième fois';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN
   IF SQLERRM NOT LIKE '%S3-RELIQUAT%n’est pas entièrement affecté%' THEN RAISE; END IF;
 END;
 RESET ROLE;
 IF (SELECT c.state FROM public.inventory_campaigns c WHERE c.id=campagne) IS DISTINCT FROM 'submitted'
    OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=campagne)
    OR EXISTS (SELECT 1 FROM public.item_locations l WHERE l.warehouse_id=depot)
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=affecte) IS DISTINCT FROM 2
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=non_affecte) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'Le refus a produit un ajustement partiel ou a libéré la campagne';
 END IF;

 -- Une affectation vérifiée à un autre dépôt résout le reliquat sans changer le stock global.
 INSERT INTO public.item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES (t,non_affecte,autre_depot,1);
 SET LOCAL ROLE authenticated;
 PERFORM public.inventory_campaign_control('validate',campagne);
 RESET ROLE;
 IF (SELECT count(*) FROM public.stock_movements m WHERE m.reference_id=campagne AND m.quantity=1) <> 2
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=affecte) IS DISTINCT FROM 3
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=non_affecte) IS DISTINCT FROM 2 THEN
   RAISE EXCEPTION 'Le comptage d’un nouveau stock en dépôt a été bloqué après le rapprochement';
 END IF;
 RAISE NOTICE 'S3 : reliquat global protégé, refus atomique et validation après rapprochement OK.';
END $$;
ROLLBACK;

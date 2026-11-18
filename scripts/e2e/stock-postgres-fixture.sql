-- Identités et articles fictifs, chargés uniquement après les migrations dans PostgreSQL jetable.
BEGIN;
INSERT INTO auth.users (id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000009101'), ('aaaaaaaa-0000-0000-0000-000000009102'),
 ('bbbbbbbb-0000-0000-0000-000000009101');
INSERT INTO public.profiles (id,tenant_id,full_name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000009101','11111111-1111-1111-1111-111111111111','Premier compteur'),
 ('aaaaaaaa-0000-0000-0000-000000009102','11111111-1111-1111-1111-111111111111','Second compteur'),
 ('bbbbbbbb-0000-0000-0000-000000009101','22222222-2222-2222-2222-222222222222','Compteur autre société');
INSERT INTO public.user_role_assignments (user_id,role_id,tenant_id)
SELECT u.id,r.id,r.tenant_id FROM public.erp_roles r
JOIN (VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'admin'),
 ('bbbbbbbb-0000-0000-0000-000000000002'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'admin'),
 ('aaaaaaaa-0000-0000-0000-000000009101'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'inventory_clerk'),
 ('aaaaaaaa-0000-0000-0000-000000009102'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'inventory_clerk'),
 ('bbbbbbbb-0000-0000-0000-000000009101'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'inventory_clerk')
) u(id,tenant,code) ON r.tenant_id=u.tenant AND r.code=u.code
ON CONFLICT(user_id,role_id) DO NOTHING;

INSERT INTO public.warehouses (id,tenant_id,code,name) VALUES
 ('10000000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','E2E-A','Dépôt Stock de recette'),
 ('10000000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222','E2E-B','Autre société');
INSERT INTO public.items (id,tenant_id,code,name,unit,quantity_on_hand,average_cost) VALUES
 ('30000000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','E2E-ARTICLE','Pièce du dépôt de recette','pièce',7,1000),
 ('30000000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222','E2E-SANS-DEPOT','Pièce sans dépôt','pièce',1,100);
INSERT INTO public.item_locations (tenant_id,item_id,warehouse_id,quantity_on_hand) VALUES
 ('11111111-1111-1111-1111-111111111111','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',7);
UPDATE public.inventory_settings s SET auto_je_on_movement=false,
 campaign_tolerance_percent=0, campaign_document_prefix='E2E-INV-', campaign_document_width=4
WHERE s.tenant_id='11111111-1111-1111-1111-111111111111';
UPDATE public.inventory_settings s SET auto_je_on_movement=false, campaign_item_scope='all_active',
 campaign_tolerance_value=1000, campaign_document_prefix='E2E-B-INV-', campaign_document_width=4
WHERE s.tenant_id='22222222-2222-2222-2222-222222222222';
INSERT INTO public.document_counters(tenant_id,doc_type,period,next_number)
VALUES ('11111111-1111-1111-1111-111111111111','inventory_campaign','ALL',1),
       ('22222222-2222-2222-2222-222222222222','inventory_campaign','ALL',1);

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.inventory_cycle_policy('save','11111111-1111-1111-1111-111111111111',
 '{"basis":"stock_value","a_percent":70,"b_percent":90,"a_days":30,"b_days":60,"c_days":90,"batch_size":5}'::jsonb);
COMMIT;

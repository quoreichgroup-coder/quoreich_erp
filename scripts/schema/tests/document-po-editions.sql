-- Run as owner against an isolated schema copy; fixtures always roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_po(_ok boolean, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'PO regression: %', _label; END IF; END $$;
SELECT pg_temp.check_po(to_regprocedure('public.install_purchase_order_templates()') IS NOT NULL, 'PO template installation RPC exists');
SELECT pg_temp.check_po(to_regprocedure('public.set_default_document_template(uuid)') IS NOT NULL, 'type-wide document template default RPC exists');
CREATE FUNCTION pg_temp.reject_po(_sql text, _state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = _state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE % for %', _state, _sql;
END $$;

INSERT INTO public.tenants (id,name) VALUES ('14300000-0000-0000-0000-000000000001','PO test A'),('14300000-0000-0000-0000-000000000002','PO test B');
INSERT INTO auth.users (id) VALUES ('14300000-0000-0000-0000-000000000011'),('14300000-0000-0000-0000-000000000012'),('14300000-0000-0000-0000-000000000013'),('14300000-0000-0000-0000-000000000014');
INSERT INTO public.profiles (id,tenant_id,full_name) VALUES
 ('14300000-0000-0000-0000-000000000011','14300000-0000-0000-0000-000000000001','PO author'),
 ('14300000-0000-0000-0000-000000000012','14300000-0000-0000-0000-000000000001','AR only'),
 ('14300000-0000-0000-0000-000000000013','14300000-0000-0000-0000-000000000001','PO only'),
 ('14300000-0000-0000-0000-000000000014','14300000-0000-0000-0000-000000000002','Other tenant');
INSERT INTO public.erp_permission_catalog (code,module,action,label) VALUES
 ('reports.templates','reports','templates','Templates'),('procurement.order','procurement','order','PO'),('ar.invoice','ar','invoice','AR') ON CONFLICT DO NOTHING;
INSERT INTO public.erp_roles (id,tenant_id,name,is_system) VALUES
 ('14300000-0000-0000-0000-000000000021','14300000-0000-0000-0000-000000000001','PO test author',false),
 ('14300000-0000-0000-0000-000000000022','14300000-0000-0000-0000-000000000001','PO test AR reader',false),
 ('14300000-0000-0000-0000-000000000023','14300000-0000-0000-0000-000000000001','PO test PO reader',false),
 ('14300000-0000-0000-0000-000000000024','14300000-0000-0000-0000-000000000002','PO test foreign',false);
INSERT INTO public.erp_role_permissions (role_id,permission_code) VALUES
 ('14300000-0000-0000-0000-000000000021','reports.templates'),('14300000-0000-0000-0000-000000000021','procurement.order'),
 ('14300000-0000-0000-0000-000000000021','ar.invoice'),('14300000-0000-0000-0000-000000000022','ar.invoice'),
 ('14300000-0000-0000-0000-000000000023','procurement.order'),('14300000-0000-0000-0000-000000000024','procurement.order');
INSERT INTO public.user_role_assignments (user_id,role_id,tenant_id) SELECT p.id,r.id,p.tenant_id FROM public.profiles p JOIN public.erp_roles r ON r.tenant_id=p.tenant_id
 WHERE (p.id,r.id) IN (('14300000-0000-0000-0000-000000000011'::uuid,'14300000-0000-0000-0000-000000000021'::uuid),('14300000-0000-0000-0000-000000000012'::uuid,'14300000-0000-0000-0000-000000000022'::uuid),('14300000-0000-0000-0000-000000000013'::uuid,'14300000-0000-0000-0000-000000000023'::uuid),('14300000-0000-0000-0000-000000000014'::uuid,'14300000-0000-0000-0000-000000000024'::uuid));
INSERT INTO public.suppliers (id,tenant_id,name,payment_terms) VALUES ('14300000-0000-0000-0000-000000000031','14300000-0000-0000-0000-000000000001','Supplier <script>',30);
INSERT INTO public.purchase_orders (id,tenant_id,po_number,supplier_id,order_date,status,created_by,currency,exchange_rate) VALUES
 ('14300000-0000-0000-0000-000000000041','14300000-0000-0000-0000-000000000001','PO-143','14300000-0000-0000-0000-000000000031','2031-05-02','approved','14300000-0000-0000-0000-000000000011','EUR',655.957),
 ('14300000-0000-0000-0000-000000000042','14300000-0000-0000-0000-000000000001','PO-DRAFT-143','14300000-0000-0000-0000-000000000031','2031-05-02','draft','14300000-0000-0000-0000-000000000011',NULL,NULL);
INSERT INTO public.po_lines (po_id,description,quantity,unit_cost,fx_unit_cost) VALUES ('14300000-0000-0000-0000-000000000041','Service <iframe>',2,0,500.25);

SELECT set_config('request.jwt.claim.sub','14300000-0000-0000-0000-000000000011',true);
DO $$ DECLARE _models jsonb; _edition jsonb; _html text; _replacement jsonb; BEGIN
  _models := public.install_purchase_order_templates();
  PERFORM pg_temp.check_po(jsonb_array_length(_models)=2,'two PO defaults');
  PERFORM public.install_purchase_order_templates();
  PERFORM pg_temp.check_po((SELECT count(*)=2 FROM public.document_templates WHERE tenant_id='14300000-0000-0000-0000-000000000001' AND doc_type='purchase_order'),'installation is idempotent');
  PERFORM public.set_default_document_template((_models->0->>'id')::uuid);
  PERFORM pg_temp.check_po((SELECT count(*)=1 AND bool_and(id=(_models->0->>'id')::uuid) FROM public.document_templates WHERE tenant_id='14300000-0000-0000-0000-000000000001' AND doc_type='purchase_order' AND is_default),'one PO default per tenant and type');
  PERFORM public.set_default_document_template((_models->1->>'id')::uuid);
  PERFORM pg_temp.check_po((SELECT count(*)=1 AND bool_and(id=(_models->1->>'id')::uuid) FROM public.document_templates WHERE tenant_id='14300000-0000-0000-0000-000000000001' AND doc_type='purchase_order' AND is_default),'changing the PO default applies type-wide');
  PERFORM set_config('qerp.test_po_template',_models->0->>'id',true);
  PERFORM pg_temp.reject_po($q$SELECT public.request_purchase_order_edition('14300000-0000-0000-0000-000000000042')$q$,'QG038');
  _edition := public.request_purchase_order_edition('14300000-0000-0000-0000-000000000041');
  PERFORM pg_temp.check_po((SELECT v.template_id=(_models->1->>'id')::uuid FROM public.issued_documents e JOIN public.document_template_versions v ON v.id=e.template_version_id WHERE e.id=(_edition->>'id')::uuid),'new PO uses the tenant-wide default');
  PERFORM pg_temp.check_po((_edition #>> '{context,document,total}')::numeric=1000.50 AND _edition #>> '{context,document,currency}'='EUR','exact document currency');
  PERFORM pg_temp.check_po(_edition #>> '{context,document,tax_amount}'='Non calculées','no fabricated PO taxes');
  PERFORM pg_temp.check_po(_edition->>'ar_invoice_id' IS NULL AND _edition->>'po_id'='14300000-0000-0000-0000-000000000041','exactly one document source');
  PERFORM set_config('qerp.test_po_edition',_edition->>'id',true);
  UPDATE public.suppliers SET name='Changed supplier' WHERE id='14300000-0000-0000-0000-000000000031';
  PERFORM pg_temp.check_po(public.request_purchase_order_edition('14300000-0000-0000-0000-000000000041')->>'id'=_edition->>'id','request reuses current edition');
  _html := public.claim_document_edition((_edition->>'id')::uuid,'14300000-0000-0000-0000-000000000011')->>'html';
  PERFORM pg_temp.check_po(strpos(_html,'Supplier &lt;script&gt;')>0 AND strpos(_html,'Service &lt;iframe&gt;')>0 AND strpos(_html,'Changed supplier')=0,'safe frozen snapshot');
  PERFORM public.complete_document_edition((_edition->>'id')::uuid,'14300000-0000-0000-0000-000000000011','14300000-0000-0000-0000-000000000001/issued/'||(_edition->>'id')||'.pdf',repeat('a',64),'gotenberg','9.2.0');
  PERFORM pg_temp.reject_po(format('UPDATE public.issued_documents SET po_id=NULL WHERE id=%L',_edition->>'id'),'QG038');
  PERFORM pg_temp.reject_po(format('SELECT public.request_purchase_order_edition(%L,NULL,%L,NULL)','14300000-0000-0000-0000-000000000041',_edition->>'id'),'QG038');
  _replacement := public.request_purchase_order_edition('14300000-0000-0000-0000-000000000041',(_models->1->>'id')::uuid,(_edition->>'id')::uuid,'Landscape replacement');
  PERFORM pg_temp.check_po(_replacement->>'id'<>_edition->>'id' AND _replacement->>'replaces_id'=_edition->>'id','explicit replacement');
  _html := public.claim_document_edition((_replacement->>'id')::uuid,'14300000-0000-0000-0000-000000000011')->>'html';
  PERFORM pg_temp.check_po(strpos(_html,'A4 landscape')>0 AND strpos(_html,'No Manufacturier')>0,'reference landscape model');
  PERFORM public.fail_document_edition((_replacement->>'id')::uuid,'14300000-0000-0000-0000-000000000011','Test renderer offline');
  PERFORM pg_temp.check_po(public.retry_document_edition((_replacement->>'id')::uuid)->>'context_sha256'=_replacement->>'context_sha256','retry preserves snapshot');
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','14300000-0000-0000-0000-000000000012',true);
SELECT pg_temp.check_po((SELECT count(*)=0 FROM public.issued_documents WHERE po_id IS NOT NULL),'AR-only role cannot read PO archives');
SELECT pg_temp.check_po((SELECT count(*)=0 FROM public.document_templates WHERE doc_type='purchase_order'),'AR-only role cannot read PO templates');
SELECT pg_temp.reject_po('SELECT public.request_purchase_order_edition(''14300000-0000-0000-0000-000000000041'')','42501');
SELECT set_config('request.jwt.claim.sub','14300000-0000-0000-0000-000000000013',true);
SELECT pg_temp.check_po((SELECT count(*)=2 FROM public.issued_documents),'PO role reads its archives');
SELECT pg_temp.reject_po('SELECT public.install_purchase_order_templates()','42501');
SELECT set_config('request.jwt.claim.sub','14300000-0000-0000-0000-000000000014',true);
SELECT pg_temp.check_po((SELECT count(*)=0 FROM public.issued_documents),'cross-tenant archives are invisible');
SELECT pg_temp.reject_po('SELECT public.request_purchase_order_edition(''14300000-0000-0000-0000-000000000041'')','QG038');
RESET ROLE;
ROLLBACK;
SELECT 'PO editions regression passed' AS result;

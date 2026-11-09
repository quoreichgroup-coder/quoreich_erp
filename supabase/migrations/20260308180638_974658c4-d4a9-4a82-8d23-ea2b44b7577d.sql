
-- First delete old-tenant gl_accounts that already exist in user's tenant
DELETE FROM public.gl_accounts 
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' 
AND code IN (SELECT code FROM public.gl_accounts WHERE tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c');

-- Then migrate remaining gl_accounts
UPDATE public.gl_accounts SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- Now migrate all other tables
UPDATE public.customers SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.suppliers SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.ar_invoices SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.ap_invoices SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.payments SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.journal_entries SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.items SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.purchase_orders SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.purchase_requisitions SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.goods_receipts SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.stock_movements SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.quotations SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.sales_orders SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.expense_reports SET tenant_id = 'd433fcca-b110-4946-96b4-88c775b8d81c' WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001';

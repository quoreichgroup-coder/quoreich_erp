-- Verify committed writes from the browser from a separate database session.
BEGIN READ ONLY;
DO $$
DECLARE
  c public.inventory_campaigns%ROWTYPE;
  article uuid := '30000000-0000-4000-8000-000000000001';
BEGIN
  SELECT * INTO STRICT c FROM public.inventory_campaigns WHERE reference='E2E-INV-0001';
  IF c.state IS DISTINCT FROM 'validated' OR c.validated_by IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'Campaign was not validated by the reviewer';
  END IF;
  IF (SELECT count(*) FROM public.inventory_campaign_count_log l WHERE l.campaign_id=c.id) <> 2
    OR NOT EXISTS (SELECT 1 FROM public.inventory_campaign_count_log l WHERE l.campaign_id=c.id
        AND l.count_round=1 AND l.counted=3 AND l.counted_by='aaaaaaaa-0000-0000-0000-000000009101')
    OR NOT EXISTS (SELECT 1 FROM public.inventory_campaign_count_log l WHERE l.campaign_id=c.id
        AND l.count_round=2 AND l.counted=5 AND l.counted_by='aaaaaaaa-0000-0000-0000-000000009102') THEN
    RAISE EXCEPTION 'Count and recount were not recorded separately';
  END IF;
  IF (SELECT count(*) FROM public.stock_movements m WHERE m.reference_id=c.id) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=c.id
       AND m.reference_type='inventory_count_campaign' AND m.quantity=-2 AND m.status='posted')
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=article) IS DISTINCT FROM 5
    OR (SELECT l.quantity_on_hand FROM public.item_locations l WHERE l.item_id=article AND l.warehouse_id=c.warehouse_id) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'Exactly one adjustment must bring the local and global stock from 7 to 5';
  END IF;
  SELECT * INTO STRICT c FROM public.inventory_campaigns WHERE reference='E2E-B-INV-0001';
  article := '30000000-0000-4000-8000-000000000002';
  IF c.state IS DISTINCT FROM 'submitted' OR c.validated_by IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.reference_id=c.id)
    OR EXISTS (SELECT 1 FROM public.item_locations l WHERE l.item_id=article)
    OR (SELECT i.quantity_on_hand FROM public.items i WHERE i.id=article) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'The rejected V100 campaign must remain submitted without a movement';
  END IF;
  RAISE NOTICE 'S3 E2E: two distinct counters, one reviewer, one posted movement and both quantities at 5.';
END $$;
ROLLBACK;

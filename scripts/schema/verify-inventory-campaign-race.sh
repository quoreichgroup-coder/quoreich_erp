#!/bin/sh
# Run inside the disposable PostgreSQL container, after migrations and reference-dataset.sql.
set -eu
run() { psql -X -q -U postgres -v ON_ERROR_STOP=1 "$@"; }
wait_lock() {
  tries=0
  while [ "$tries" -lt 50 ]; do
    if [ "$(run -Atc "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype='advisory' AND l.granted AND a.application_name='$1')")" = t ]; then
      return
    fi
    tries=$((tries + 1))
    sleep 0.1
  done
  echo "Did not observe lock for $1" >&2
  return 1
}

run <<'SQL'
INSERT INTO user_role_assignments(user_id,role_id,tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001', id, tenant_id
FROM erp_roles WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND code='admin'
ON CONFLICT (user_id,role_id) DO NOTHING;
INSERT INTO warehouses(id,tenant_id,code,name)
VALUES ('31000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','S3-RACE','S3 race'),
       ('31000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','S3-RACE2','S3 race 2');
INSERT INTO items(id,tenant_id,code,name)
VALUES ('32000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','S3-RACE','S3 race');
INSERT INTO item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand)
SELECT '11111111-1111-1111-1111-111111111111','32000000-0000-0000-0000-000000000001',w.id,7
FROM warehouses w WHERE w.code IN ('S3-RACE','S3-RACE2');
SQL

PGAPPNAME=s3_quantity_writer run <<'SQL' &
BEGIN;
UPDATE item_locations SET quantity_on_hand=8 WHERE warehouse_id='31000000-0000-0000-0000-000000000001';
SELECT pg_sleep(6);
COMMIT;
SQL
writer=$!
wait_lock s3_quantity_writer
run <<'SQL'
BEGIN;
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.inventory_campaign('open','31000000-0000-0000-0000-000000000001')->>'state';
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory_campaign_lines l JOIN inventory_campaigns c ON c.id=l.campaign_id
    WHERE c.warehouse_id='31000000-0000-0000-0000-000000000001' AND l.expected=8) THEN
    RAISE EXCEPTION 'Opening did not wait for the prior quantity change';
  END IF;
END $$;
COMMIT;
SQL
wait "$writer"

PGAPPNAME=s3_opener run <<'SQL' &
BEGIN;
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.inventory_campaign('open','31000000-0000-0000-0000-000000000002')->>'state';
SELECT pg_sleep(6);
COMMIT;
SQL
opener=$!
wait_lock s3_opener
run <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE item_locations SET quantity_on_hand=8 WHERE warehouse_id='31000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'Quantity change unexpectedly allowed after concurrent opening';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END $$;
SQL
wait "$opener"
echo 'S3 both race directions passed'

# Two approving transactions for the same campaign must produce only one adjustment.
run <<'SQL'
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000396');
INSERT INTO profiles(id,tenant_id,full_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000396','11111111-1111-1111-1111-111111111111','S3 compteur concurrence');
INSERT INTO user_role_assignments(user_id,role_id,tenant_id)
SELECT 'aaaaaaaa-0000-0000-0000-000000000396',id,tenant_id FROM erp_roles
WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND code='inventory_clerk';
INSERT INTO inventory_settings(tenant_id,auto_je_on_movement) VALUES ('11111111-1111-1111-1111-111111111111',false)
ON CONFLICT (tenant_id) DO UPDATE SET auto_je_on_movement=false;
INSERT INTO warehouses(id,tenant_id,code,name)
VALUES ('31000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','S3-APPROVAL','S3 concurrence validation');
INSERT INTO items(id,tenant_id,code,name,quantity_on_hand,average_cost)
VALUES ('32000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','S3-APPROVAL','S3 concurrence validation',7,1);
INSERT INTO item_locations(tenant_id,item_id,warehouse_id,quantity_on_hand)
VALUES ('11111111-1111-1111-1111-111111111111','32000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000003',7);
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.inventory_campaign_policy('save',100,NULL);
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000396","role":"authenticated"}';
DO $$
DECLARE c uuid;
BEGIN
 c := (public.inventory_campaign('open','31000000-0000-0000-0000-000000000003')->>'id')::uuid;
 PERFORM public.inventory_campaign('count',c,'32000000-0000-0000-0000-000000000003',6);
 PERFORM public.inventory_campaign('submit',c);
END $$;
COMMIT;
SQL
campaign="$(run -Atc "SELECT id FROM inventory_campaigns WHERE warehouse_id='31000000-0000-0000-0000-000000000003'")"

PGAPPNAME=s3_validator run -v campaign="$campaign" <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT public.inventory_campaign_control('validate',:'campaign')->>'state';
SELECT pg_sleep(6);
COMMIT;
SQL
validator=$!
wait_lock s3_validator
run -v campaign="$campaign" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL lock_timeout='15s';
SET LOCAL request.jwt.claims='{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT set_config('test.campaign',:'campaign',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.inventory_campaign_control('validate',current_setting('test.campaign')::uuid);
    RAISE EXCEPTION 'A second concurrent validation succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END $$;
COMMIT;
SQL
wait "$validator"
[ "$(run -Atc "SELECT count(*) FROM stock_movements WHERE reference_id='$campaign'")" = 1 ]
[ "$(run -Atc "SELECT quantity_on_hand = 6 FROM item_locations WHERE warehouse_id='31000000-0000-0000-0000-000000000003'")" = t ]
echo 'S3 concurrent validation passed'

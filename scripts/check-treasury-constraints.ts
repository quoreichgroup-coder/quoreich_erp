#!/usr/bin/env -S node --enable-source-maps
/**
 * CI guardrail — verifies that the UNIQUE constraints required by the
 * `close_treasury_period` RPC exist in the target Supabase database BEFORE
 * deploying to production. Fails the build (exit 1) if any are missing.
 *
 * Required env: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 * Usage: tsx scripts/check-treasury-constraints.ts
 *        (or wire into CI: `npm run check:db-constraints`)
 */
import { execSync } from "node:child_process";

type Check = { table: string; columns: string[] };

const REQUIRED: Check[] = [
  { table: "public.treasury_period_closes", columns: ["tenant_id", "period"] },
  { table: "public.period_locks", columns: ["tenant_id", "period", "module"] },
];

function existsUnique({ table, columns }: Check): boolean {
  const sql = `
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'u'
      AND (n.nspname || '.' || t.relname) = '${table}'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      ) = ARRAY[${columns.map((col) => `'${col}'`).sort().join(",")}]::name[]
    LIMIT 1;`;
  try {
    const out = execSync(`psql -tA -c "${sql.replace(/\n/g, " ")}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out === "1";
  } catch (err) {
    console.error(`[check-treasury-constraints] psql failed for ${table}:`, (err as Error).message);
    return false;
  }
}

let ok = true;
for (const check of REQUIRED) {
  const present = existsUnique(check);
  if (present) {
    console.log(`✅ UNIQUE ${check.table} (${check.columns.join(", ")})`);
  } else {
    console.error(`❌ MISSING UNIQUE on ${check.table} (${check.columns.join(", ")})`);
    ok = false;
  }
}

if (!ok) {
  console.error("\nclose_treasury_period will fail with 42P10 in production. Run the defensive migration.");
  process.exit(1);
}
console.log("\nAll required UNIQUE constraints are present.");

// Auth tests for ai-gl-anomaly-detection. Same contract as ai-cashflow-forecast.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/ai-gl-anomaly-detection`;

async function call(headers: Record<string, string> = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{}",
  });
  return { status: res.status, text: await res.text() } as const;
}

Deno.test("ai-gl-anomaly-detection: no Authorization header → 401", async () => {
  const r = await call();
  assertEquals(r.status, 401);
});

Deno.test("ai-gl-anomaly-detection: invalid Bearer token → 401", async () => {
  const r = await call({ Authorization: "Bearer abc.def.ghi" });
  assertEquals(r.status, 401);
});

Deno.test("ai-gl-anomaly-detection: errors do not leak stack traces", async () => {
  const r = await call();
  assert(!r.text.includes(".ts:"));
  assert(!r.text.includes("    at "));
});

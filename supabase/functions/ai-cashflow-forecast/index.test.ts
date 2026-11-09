// Auth tests for ai-cashflow-forecast.
// Unauthenticated requests must be rejected with 401 (the function validates
// the JWT in-code via getClaims). Error responses must stay generic.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/ai-cashflow-forecast`;

async function call(headers: Record<string, string> = {}, body = "{}") {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const text = await res.text();
  return { status: res.status, text } as const;
}

Deno.test("ai-cashflow-forecast: no Authorization header → 401", async () => {
  const r = await call();
  assertEquals(r.status, 401);
});

Deno.test("ai-cashflow-forecast: invalid Bearer token → 401", async () => {
  const r = await call({ Authorization: "Bearer abc.def.ghi" });
  assertEquals(r.status, 401);
});

Deno.test("ai-cashflow-forecast: errors do not leak stack traces", async () => {
  const r = await call();
  assert(!r.text.includes(".ts:"), "response leaks file path");
  assert(!r.text.includes("    at "), "response leaks stack frame");
});

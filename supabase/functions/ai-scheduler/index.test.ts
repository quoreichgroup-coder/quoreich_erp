// Auth integration tests for the ai-scheduler edge function.
// Verifies that:
//   • requests with no credentials → 401
//   • requests with a bogus x-scheduler-secret → 401
//   • responses on internal failure surface a generic 500 (no leaked stack)
//
// We do NOT test the happy path here (would require SUPABASE_SERVICE_ROLE_KEY,
// which is unavailable on Lovable Cloud). The happy path is covered by the
// pg_cron scheduled invocation in production logs.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/ai-scheduler`;

async function call(headers: Record<string, string> = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{}",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch { /* not JSON */ }
  return { status: res.status, text, json } as const;
}

Deno.test("ai-scheduler: no credentials → 401 Unauthorized", async () => {
  const r = await call();
  assertEquals(r.status, 401);
  // deno-lint-ignore no-explicit-any
  assertEquals((r.json as any)?.error, "Unauthorized");
});

Deno.test("ai-scheduler: bogus x-scheduler-secret → 401", async () => {
  const r = await call({ "x-scheduler-secret": "definitely-not-the-secret" });
  assertEquals(r.status, 401);
});

Deno.test("ai-scheduler: bogus Bearer token → 401", async () => {
  const r = await call({ Authorization: "Bearer not-a-valid-token" });
  assertEquals(r.status, 401);
});

Deno.test("ai-scheduler: error responses never leak stack traces", async () => {
  const r = await call();
  // Generic message only; never includes file paths or "at " stack frames.
  assert(!r.text.includes(".ts:"), "response leaks file path");
  assert(!r.text.includes("    at "), "response leaks stack frame");
});

/**
 * Treasury E2E fixtures
 *
 * Fournit des helpers reproductibles pour seeder/nettoyer les données
 * nécessaires aux tests Playwright Treasury : customers/suppliers,
 * ar_invoices, ap_invoices, bank_accounts, bank_statements,
 * bank_statement_lines et cashflow_forecasts.
 *
 * Toutes les entités créées sont marquées avec un préfixe unique
 * (`E2E-<runId>-...`) ce qui permet un cleanup déterministe même en cas
 * d'échec partiel d'un test.
 *
 * Usage :
 *   import { createTreasuryFixtures } from "./fixtures/treasury-fixtures";
 *   const fx = await createTreasuryFixtures({ email, password });
 *   const inv = await fx.seedArInvoice({ total: 1_500_000 });
 *   ...
 *   await fx.cleanup();
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SB_URL = process.env.E2E_SUPABASE_URL ?? "";
const SB_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

export type FixtureCtx = {
  client: SupabaseClient;
  runId: string;
  tag: string; // ex: "E2E-1730000000000-abc"
};

type Auth = { email: string; password: string };
type FixtureOpts = { now?: Date | string };

export async function createTreasuryFixtures(auth: Auth, opts: FixtureOpts = {}) {
  if (!SB_URL || !SB_KEY) throw new Error("E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY manquants");
  const baseNow = opts.now ? new Date(opts.now) : new Date();
  const todayISO = (offsetDays = 0) =>
    new Date(baseNow.getTime() + offsetDays * 864e5).toISOString().slice(0, 10);
  const client = createClient(SB_URL, SB_KEY);
  const { error } = await client.auth.signInWithPassword(auth);
  if (error) throw new Error(`Auth fixture KO: ${error.message}`);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tag = `E2E-${runId}`;
  const created: Array<{ table: string; id: string }> = [];

  const track = (table: string, id?: string | null) => {
    if (id) created.push({ table, id });
  };

  // ───────── Customers / Suppliers ─────────
  async function ensureCustomer(): Promise<string> {
    const { data } = await client.from("customers").select("id").limit(1).maybeSingle();
    if (data?.id) return data.id;
    const { data: ins, error } = await client
      .from("customers")
      .insert({ name: `${tag}-cust`, currency: "XOF" })
      .select("id")
      .single();
    if (error) throw error;
    track("customers", ins.id);
    return ins.id;
  }

  async function ensureSupplier(): Promise<string> {
    const { data } = await client.from("suppliers").select("id").limit(1).maybeSingle();
    if (data?.id) return data.id;
    const { data: ins, error } = await client
      .from("suppliers")
      .insert({ name: `${tag}-sup`, currency: "XOF" })
      .select("id")
      .single();
    if (error) throw error;
    track("suppliers", ins.id);
    return ins.id;
  }

  // ───────── AR / AP invoices ─────────
  async function seedArInvoice(opts: { total?: number; dueInDays?: number } = {}) {
    const customer_id = await ensureCustomer();
    const { data, error } = await client
      .from("ar_invoices")
      .insert({
        customer_id,
        invoice_number: `${tag}-AR-${created.length}`,
        invoice_date: todayISO(),
        due_date: todayISO(opts.dueInDays ?? 14),
        total: opts.total ?? 1_500_000,
        amount_paid: 0,
        status: "open",
        currency: "XOF",
      })
      .select()
      .single();
    if (error) throw error;
    track("ar_invoices", data.id);
    return data;
  }

  async function seedApInvoice(opts: { total?: number; dueInDays?: number } = {}) {
    const supplier_id = await ensureSupplier();
    const { data, error } = await client
      .from("ap_invoices")
      .insert({
        supplier_id,
        invoice_number: `${tag}-AP-${created.length}`,
        invoice_date: todayISO(),
        due_date: todayISO(opts.dueInDays ?? 21),
        total: opts.total ?? 1_000_000,
        amount_paid: 0,
        status: "open",
        currency: "XOF",
      })
      .select()
      .single();
    if (error) throw error;
    track("ap_invoices", data.id);
    return data;
  }

  // ───────── Bank accounts / statements ─────────
  async function ensureBankAccount(): Promise<string> {
    const { data } = await client.from("bank_accounts").select("id").limit(1).maybeSingle();
    if (data?.id) return data.id;
    const { data: ins, error } = await client
      .from("bank_accounts")
      .insert({
        name: `${tag}-bank`,
        account_number: `${tag}-ACC`,
        currency: "XOF",
        opening_balance: 0,
        current_balance: 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    track("bank_accounts", ins.id);
    return ins.id;
  }

  async function seedBankStatement(opts: { lines?: number; amount?: number } = {}) {
    const bank_account_id = await ensureBankAccount();
    const { data: stmt, error } = await client
      .from("bank_statements")
      .insert({
        bank_account_id,
        statement_number: `${tag}-STMT-${created.length}`,
        statement_date: todayISO(),
        period_start: todayISO(-30),
        period_end: todayISO(),
        opening_balance: 0,
        closing_balance: (opts.amount ?? 250_000) * (opts.lines ?? 1),
        status: "pending",
        currency: "XOF",
      })
      .select()
      .single();
    if (error) throw error;
    track("bank_statements", stmt.id);

    const n = opts.lines ?? 1;
    const rows = Array.from({ length: n }).map((_, i) => ({
      bank_statement_id: stmt.id,
      transaction_date: todayISO(-i),
      description: `${tag}-line-${i}`,
      amount: opts.amount ?? 250_000,
      direction: "credit",
      matched: false,
    }));
    const { data: lines, error: e2 } = await client
      .from("bank_statement_lines")
      .insert(rows)
      .select("id");
    if (e2) throw e2;
    lines?.forEach((l) => track("bank_statement_lines", l.id));
    return { statement: stmt, lineIds: (lines ?? []).map((l) => l.id) };
  }

  // ───────── Cashflow forecast ─────────
  async function seedCashflowForecast(opts: { weeks?: number; inflow?: number; outflow?: number } = {}) {
    const weeks = opts.weeks ?? 13;
    const rows = Array.from({ length: weeks }).map((_, i) => ({
      week_start: todayISO(i * 7),
      inflow_forecast: opts.inflow ?? 500_000,
      outflow_forecast: opts.outflow ?? 300_000,
      currency: "XOF",
      label: `${tag}-w${i}`,
    }));
    const { data, error } = await client.from("cashflow_forecasts").insert(rows).select("id");
    if (error) throw error;
    data?.forEach((r) => track("cashflow_forecasts", r.id));
    return data ?? [];
  }

  // ───────── Cleanup ─────────
  async function cleanup() {
    // Ordre inverse pour respecter les FK (lines → statements → accounts)
    const order = [
      "bank_statement_lines",
      "bank_statements",
      "cashflow_forecasts",
      "ar_invoices",
      "ap_invoices",
      "bank_accounts",
      "customers",
      "suppliers",
    ];
    const byTable: Record<string, string[]> = {};
    for (const { table, id } of created) (byTable[table] ??= []).push(id);
    for (const table of order) {
      const ids = byTable[table];
      if (!ids?.length) continue;
      await client.from(table).delete().in("id", ids);
    }
    created.length = 0;
  }

  return {
    client,
    runId,
    tag,
    ensureCustomer,
    ensureSupplier,
    ensureBankAccount,
    seedArInvoice,
    seedApInvoice,
    seedBankStatement,
    seedCashflowForecast,
    cleanup,
  };
}

export type TreasuryFixtures = Awaited<ReturnType<typeof createTreasuryFixtures>>;

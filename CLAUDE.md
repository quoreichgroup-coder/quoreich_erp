# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

QUOREICH is a multi-tenant financial ERP for OHADA/SYSCOHADA SMEs: French UI, XOF base currency, SAP/Sage-style corporate design. It is a React 19 + TypeScript SPA (Vite 8, Tailwind 4, shadcn/ui) backed entirely by Supabase (Postgres + Auth + RLS + Realtime + Edge Functions). There is no application server checked into this repo — business logic lives in Postgres triggers, views and RPCs, and pages reach it through Supabase. `src/` has no mock data layer; mocks exist only in tests. The long-form business spec (modules, routes, compliance, plans) is `README.md`.

Read `AGENTS.md` as well — its CFO/tenant rules are binding and are summarized under "CFO consolidation invariants".

## Commands

```bash
npm install
PORT=8081 npm run dev    # Vite dev server; default 8080, honours PORT
npm run build            # production build
npm run build:dev        # development-mode build
npm run lint             # ESLint flat config (0 error expected; see "Static checks")
npm test                 # Vitest run, all src/**/*.{test,spec}.{ts,tsx}
npx tsc --noEmit -p tsconfig.app.json   # app type check (src only)
npx tsc --noEmit -p tsconfig.node.json  # config files type check
npx vitest               # watch mode
npx vitest run src/lib/__tests__/lot1-sincerity.test.ts   # one file
npx vitest run -t "CFO"  # tests whose name matches
```

`vite.config.ts` reads `process.env.PORT` with 8080 as the default, and Vite falls through to the next free port when 8080 is taken. On this workstation 8080 is permanently held by the Docker container `frappe_docker_official_latest-frontend-1`, so `npm run dev` silently serves QERP on **8081** — and the 17 e2e specs default to `process.env.PORT ?? "8080"`, i.e. to the *other* application. Always pin the port explicitly for both sides: `PORT=8081 npm run dev` and `PORT=8081 npx playwright test …`.

E2E specs in `tests/e2e/*.spec.ts` are Playwright and sit outside Vitest's `include`:

```bash
npm run dev   # keep running
npx playwright test tests/e2e/cfo-consolidated.spec.ts
```

Playwright is not declared in `package.json` and there is no `playwright.config.ts`; specs assume a runner on PATH (headers say `pnpm exec playwright test ...`) and read `process.env.PORT ?? "8080"` (or `E2E_BASE_URL`). Most specs fully stub Supabase with `page.route` regexes and need no session. `treasury-rbac-*.spec.ts` and `treasury-realtime.spec.ts` are live: they need `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_AUTH_EMAIL_ADMIN`/`E2E_AUTH_PASSWORD_ADMIN`, `E2E_AUTH_EMAIL_NOROLE`/`E2E_AUTH_PASSWORD_NOROLE`, seed rows tagged `E2E-<runId>` and auto-skip when credentials are absent. `tests/e2e/fixtures/clock.ts` freezes time via `page.clock` — call `freezeClock` before `goto`.

Connected read-only regression (real session, no fixtures written):

```bash
python tests/e2e/cfo-consolidated-live.py
# auth via LOVABLE_BROWSER_AUTH_STATUS=injected + LOVABLE_BROWSER_SUPABASE_* env,
# or ~/.cache/lovable-auth/session.json; artifacts go to /tmp/browser/cfo-live
```

Pre-deploy DB guardrail (requires `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`):

```bash
npx tsx scripts/check-treasury-constraints.ts   # tsx is not a declared dependency; npx fetches it
```

Lot 0 end-to-end guardrail — restores the dump, regenerates `V3..V14`, rebuilds from empty,
diffs the object manifest, runs the RLS isolation fixture. Needs Docker and the production dump
(which lives outside the repo):

```bash
PORT=55432 bash scripts/schema/verify-lot0.sh "C:/Users/Abdouramane/QERP-backups/flow-bright-desk_261109.backup"
```

### Java API (`services/api/`)

Maven is **not installed** and must not be; the module ships a wrapper. The workstation has two
JDK 21 installs and Oracle's `javapath` first on PATH, so `JAVA_HOME` must be pinned explicitly —
`maven-enforcer-plugin` fails the build with an explicit message rather than letting `javac`
report a confusing syntax error. JDK 25 lives at `C:\Users\Abdouramane\tools\jdk-25.0.5+8`.

```bash
cd services/api
JAVA_HOME=/c/Users/Abdouramane/tools/jdk-25.0.5+8 ./mvnw -B -ntp verify   # unit + integration tests
JAVA_HOME=/c/Users/Abdouramane/tools/jdk-25.0.5+8 ./mvnw -B -ntp test     # unit tests only, no Docker
JAVA_HOME=/c/Users/Abdouramane/tools/jdk-25.0.5+8 ./mvnw spring-boot:run  # needs PostgreSQL on 5432
```

`*IT` classes are Failsafe integration tests and start a disposable `postgres:18.6-alpine`
container via Testcontainers — they need Docker running. `*Test` classes are Surefire unit tests
and need nothing. State as of 9 Nov 2026: `verify` is green, 11 unit + 21 integration tests.

## Architecture

### Frontend shell

- `src/main.tsx` renders `src/App.tsx`, whose provider stack is QueryClient → Tooltip → BrowserRouter → AuthProvider. Every private route is wrapped in `ProtectedRoute` (`P`), which only enforces "signed in" + "has `profiles.tenant_id`" (redirecting to `/onboarding`). There is no module- or role-level route guard: access is enforced by RLS plus per-button RBAC.
- Every domain follows the same six-page grid: `/module` (dashboard), `/module/transactions`, `/master-data`, `/reporting`, `/control`, `/settings`. Pages compose `<PageShell>` (sidebar + top nav) → `Breadcrumb` → `GuidanceBanner` → title/actions → KPI card row → local tab bar → `Card` sections. All copy is French; money is `Intl.NumberFormat("fr-FR")` + XOF.
- Global pages: `/cockpit`, `/cockpit/consolidated` (CFO consolidation), `/alerts`, `/reports`, `/settings`, `/admin/modules`, `/admin/import`, `/ai/history`, `/docs`.
- Keep pages thin. Pure business math lives in `src/lib/` (`treasury-cashflow.ts`, `treasury-close.ts`, `payroll-engine.ts`, `*-roles.ts`) and is what unit tests target.
- Code splitting: every page except `Login` is a `React.lazy(() => import("./pages/X"))` behind one `<Suspense>` in `App.tsx`. Adding a route means adding a lazy import, not an eager one. Measured 9 Nov 2026 from `dist/index.html` on the Vite 8 / rolldown build: the first screen pulls **774 kB JS (227 kB gzip) across 10 chunks + 111 kB CSS (17 kB gzip)**, against a single 3 146 kB / 792 kB chunk before. The heaviest libraries (`jspdf.es.min` 399 kB, `generateCategoricalChart` 359 kB, `html2canvas` 199 kB) are now lazy chunks, absent from the preload list. Measure with `grep -oE '(src|href)="[^"]*\.(js|css)"' dist/index.html`, not by eye-balling the build summary.
- `vite.config.ts` only isolates entry-critical vendors (`vendor-react`, `vendor-router`, `vendor-query`, `vendor-supabase`, `vendor-radix`, `vendor-ui-utils`, `vendor-preload`). Do **not** add `manualChunks` rules for `recharts` or `jspdf`: Rollup then dumps shared app modules into those chunks, which makes ~1.1 MB of chart/PDF code a *static* dependency of the entry. `jspdf` is loaded by `import()` inside `exportToPDF`, so `src/lib/pdf-export.ts` is async — callers may ignore the promise.
- One `QueryClient` instance lives in `src/lib/query-client.ts` (imported by both `App.tsx` and `AuthContext.tsx`). `AuthContext` calls `queryClient.clear()` on the `SIGNED_OUT` event, not inside `signOut()`, so session expiry and cross-tab sign-out also flush tenant-scoped caches.

### Data access

- One hook module per domain: `src/hooks/use-<domain>-data.ts` (`use-treasury-data`, `use-gl-data`, `use-sales-data`, ...). Hooks use TanStack Query and call either `.from("...")` for tables/views or `.rpc("...")` for SECURITY DEFINER functions.
- Tenant resolution: `useTenantId()` reads `profiles.tenant_id`, cached under `["tenant-id"]` with `staleTime`/`gcTime` Infinity. Mutations call `fetchTenantId()` directly. RLS is the real security boundary; the browser only ever uses the publishable/anon key — never `service_role`.
- Query keys are flat kebab-case arrays (`["bank-accounts", tenantId]`, `["gl-ledger-detail", accountId]`, `["cfo-consolidated", sortedIds.join(",")]`); invalidate by prefix (`invalidateQueries({ queryKey: ["bank-transactions"] })`).
- `src/integrations/supabase/types.ts` is generated from the deployed schema — never hand-edit it. Tables/views missing from it are queried through `(supabase as any)` or `.from("view" as never)`; a schema change requires regenerating types, not patching them.
- The default QueryClient retry is 3 (`new QueryClient()` in `App.tsx`); treasury and all consolidated-CFO hooks opt out with `retry: false` so failures surface for explicit recovery.
- Pagination: `.limit(200)` / `.limit(500)` is common in list hooks and silently truncates. For any aggregation or export, exhaust pages (`useBankTransactions`'s `.range()` loop at `use-treasury-data.ts:32-46`, or `fetchAllInventoryCloses` at `use-inventory-data.ts:391-425`) or use server-side `{ rows, total }` pagination.
- `useRealtimeInvalidation` is one global channel with hard-coded table→query-key mappings; a new hook's key will not auto-refresh unless added there.
- Client-side table UX is `useTableFeatures` (`src/hooks/use-table-features.ts`): in-memory sort/filter/page over already-fetched rows, default page size 10, optional localStorage persistence via `persistKey`. Render with `SortableHead` / `FilterBar` / `PaginationBar` from `DataTableControls.tsx`. Every call site uses a page size of 10–15, so only that many rows reach the DOM — no virtualization library is used; `use-table-features.test.tsx` guards the 2 000-row sort/filter path instead. Growing the page size to "all rows" would reintroduce the problem.

### Backend is the database

- All real schema/logic is in `supabase/migrations/` (82 forward-only `YYYYMMDDHHMMSS_<uuid>.sql` files). Add a new file with a newer timestamp; never edit an applied migration. `supabase/config.toml` only sets the project id and `verify_jwt = false` for `ai-scheduler`; nothing in the repo configures a local Supabase CLI workflow, so migrations are applied through Lovable/Supabase.
- `drizzle/` is not the schema source: `drizzle/schema.ts` is a blank placeholder and the two `drizzle/migrations/*.sql` files are hand-written consolidated-CFO RPC definitions. `drizzle-kit` is installed but no script invokes it.
- Tenant isolation: RLS is enabled on tenant tables; the policy helper is `public.get_user_tenant_id(auth.uid())` (README's `current_user_tenant()` does not exist), plus `has_role(...)` and module helpers (`has_treasury_perm`, ...). `get_accessible_tenants()` unions `user_role_assignments` and `profiles` for multi-tenant users.
- RPCs are generally `SECURITY DEFINER SET search_path = public`, resolve the caller's tenant server-side, validate row ownership, use `RAISE ... USING ERRCODE` (42501/22023/23514), and `REVOKE EXECUTE ... FROM public, anon`.
- Business logic is trigger/view-driven: auto GL posting on payments (`on_ap_payment_recorded`), DR=CR enforcement and posted-entry immutability (`enforce_balanced_entry`, `protect_posted_*`), AR/AP/stock aging views (`security_invoker = true`), invoice status recomputation from payments, `period_locks` plus close/reverse RPCs. `gl_audit_logs` chains entries; note the DB trigger hashes with 8-char truncated MD5 even though the README describes a SHA-256 chain.
- Edge functions: `import-data` (bulk import, JWT + tenant from profile, allowlisted fields), `ai-scheduler` (cron entry, service-role or `x-scheduler-secret`), `ai-cashflow-forecast`, `ai-gl-anomaly-detection` (Gemini via `LOVABLE_API_KEY`, JWT or service role). They return generic errors and emit one structured `console.log({ audit: ... })` line per run; see `supabase/functions/README.md`.

### Java/Spring re-platform baseline (Lot 0 done, Lot 1 in progress)

The backend is moving to Java 25 / Spring Boot 4.1 on a single VPS; the PostgreSQL schema is the asset and is reused unchanged. Programme: `docs/PLAN-BASCULE-JAVA.md`; governing spec: `docs/quoreich-cahier-des-charges-v1.md` + `v1.1` change log. The module is `services/api/`; its entry point is `QerpApiApplication`, and it is a modular monolith whose package boundaries are enforced by `ArchitectureTest` (ArchUnit), not by review discipline. Package layout: `tenant/` (context, connection, startup guard), `web/` (health, correlation id), `config/` (security), `customer/` (the Lot 1 acceptance slice).

- **Lot 1 verification lives in the ITs, not in prose.** `ApiSecurityIT` proves the exit criterion over HTTP with fabricated JWTs (`spring-security-test`'s `jwt()` post-processor — only the issuer is simulated, the whole authorization chain and RLS are production's); `TenantIsolationIT` proves it at the query layer, including that a write to another tenant is refused with no partial effect (asserted **as the table owner**, so the observation is not blind to the rows it looks for); `SchemaMigrationIT` proves the schema rebuilds under Boot-driven Flyway and compares object **name sets** against `public.manifest.tsv`; `ArchitectureTest` holds the structural invariants.
- **The tenant comes from `profiles`, never from the token.** The policy is `tenant_id = get_user_tenant_id(auth.uid())`, so a `tenant_id` claim cannot widen the perimeter — a token claiming another tenant is simply ineffective. `TenantPrincipal.tenantId` is therefore informational and nullable, and the filter accepts a token without the claim; it returns 403 only for an unparseable `sub` or an unreadable claim. Do not "fix" this into a required claim.
- **Zero tables use `FORCE ROW LEVEL SECURITY`**, so a table *owner* silently bypasses all 157 policies. `DatabaseSecurityGuard` turns that into a startup refusal: it asserts the connection is neither superuser nor `BYPASSRLS`, owns no `public` table, and is a member of `authenticated`. A legitimate change to any of those makes the app fail to start, by design. `DatabaseSecurityGuard.ConnectionAudit` exists so each refusal path is unit-testable without a container.
- **`TenantAwareDataSource` issues `set_config('request.jwt.claims', ?, true)` on every connection handed out** — `set_config(..., true)` rather than `SET LOCAL` because it takes a bind parameter, and local scope because connections are pooled. It is installed by a `BeanPostProcessor` that wraps **only the bean named `dataSource`**: Boot's `flywayDataSource` has autocommit on, and wrapping it would abort startup on the first migration. Renaming that bean fails loudly, not silently.
- **The OpenAPI contract is a versioned file, not a running server.** The chain is one-way and each link is enforced: Java controllers → `services/api/openapi/qerp-api.json` (frozen by `OpenApiContractIT`, which fails with a named JSON path when the server outgrows the file) → `src/api/qerp-schema.ts` (generated by `openapi-typescript`, checked by `npm run api:check`). Regenerate with `./mvnw verify -Dqerp.openapi.update=true`, then `npm run api:types`. Note `springdoc` is on its **3.x** line for Boot 4 (3.2.0 is built on 4.1.2) even though Maven Central's *search API* still advertises `latestVersion 2.8.6` — `maven-metadata.xml` is the authority. Two contract properties are load-bearing and covered by tests: the document is **not public** (it is permitted only under the `dev` profile, and Swagger UI is disabled by default), and it declares **no tenant parameter**, because the perimeter is resolved server-side.
- **Boot 4 renamed things; a generated Initializr skeleton will not build.** Verified against Maven Central, not assumed: the parent version is `4.1.2` (Initializr emits `4.1.2.RELEASE`, whose POM 404s), it is `spring-boot-starter-webmvc` not `-web`, `spring-boot-starter-security-oauth2-resource-server`, `spring-boot-starter-flyway`, and `@AutoConfigureMockMvc` has moved to `org.springframework.boot.webmvc.test.autoconfigure` in the `spring-boot-starter-webmvc-test` starter (which replaces, not adds to, `spring-boot-starter-test`). Testcontainers 2.0 renamed its modules too: `testcontainers-postgresql` and `testcontainers-junit-jupiter`, with `PostgreSQLContainer` in `org.testcontainers.postgresql` and **non-generic**. ArchUnit is not managed by the Boot BOM and is pinned. Flyway is deliberately overridden to 13.12.1 against the BOM's 12.4.0 for PostgreSQL 18.6; `SchemaMigrationIT` is what proves the override does not break Boot's Flyway auto-configuration.

- **`supabase/migrations/` is not a replayable schema** — `get_consolidated_cfo_trends` exists only in `drizzle/migrations/`. The source of truth is the production dump, which lives **outside the repo** (`C:\Users\Abdouramane\QERP-backups\`) because it contains PII. Never commit `*.backup`/`*.dump`.
- The real baseline is `services/api/src/main/resources/db/migration/` (`V1..V15`). `V1`, `V2`, `V15` and the README are hand-written; `V3..V14` are **generated** by `scripts/schema/extract-from-dump.sh` and must not be edited by hand.
- Verify with `bash scripts/schema/verify-lot0.sh <dump>`: restores the dump into `postgres:18.6-alpine`, regenerates `V3..V14` and fails on drift, rebuilds from an empty database, then diffs a 2 885-line object manifest (columns, constraints, indexes, function bodies, views, triggers, RLS policies, sequences, enums) and runs the RLS isolation fixture. Current result: zero diff.
- **Tenant context contract**: the API connects as `qerp_api` (non-owner, `NOBYPASSRLS`, member of `authenticated`) and sets `SET LOCAL request.jwt.claims = '{"sub":...,"role":"authenticated"}'` per transaction. `V2__compat_auth_schema.sql` reimplements `auth.uid()/jwt()/role()/email()` so the 157 policies stay byte-identical. With no session variable `auth.uid()` is NULL and RLS fails closed.
- `auth.users` is reduced to `(id uuid primary key)`; Keycloak must import users **with their original UUIDs** to keep the 16 FKs valid. The `on_auth_user_created` trigger is not recreated — profile provisioning becomes an API responsibility.
- `storage`, `realtime`, `cron`, `vault`, `pg_net` are dropped (MinIO, SSE/WebSocket, Quartz). No `public` function calls them.

### CFO consolidation invariants

These come from `AGENTS.md` and are binding:

- Flow: `useAccessibleTenants()` (`get_accessible_tenants`) drives the company picker → `useConsolidatedCfoKpis(tenantIds)` (`get_consolidated_cfo_kpis`) and `useConsolidatedTrends(tenantIds, months)` (`get_consolidated_cfo_trends`, months strictly 3/6/12) → `sumKpis`.
- The CSV export on the CFO page must be built from the same selected-tenant KPI/trend results the charts show, so the download matches visible scope and period. Do not re-query a different scope for export.
- In the consolidated RPCs, qualify every source column and intersect `_tenant_ids` with `get_accessible_tenants`; plpgsql output variables can shadow columns, and consolidation must never widen access.
- CFO queries must not retry automatically; expose the error and let users recover explicitly.
- Trends are computed server-side inside the accessible selected tenants. Past cash = complete exact-month closing statements (`bank_statements.status = 'imported'` with `period_start`/`period_end` covering the month) for every eligible active XOF account; missing evidence yields NULL. The current month uses current `bank_accounts.balance` for active XOF accounts. Never fabricate history or convert currency.
- Revenue/expenses in trends are cash-based (`payments.payment_type = 'ar_receipt'` / `'ap_payment'`), not accrual P&L — label them accordingly.
- Scope bank-account and transaction cache keys/reads by `useTenantId`, and load all ordered pages before aggregation or export (the 200-row truncation bug class).

### Modules, RBAC, licensing

- `src/hooks/use-active-modules.ts` reads `tenant_modules` (`status = 'active'`) and `DashboardSidebar` uses it only to hide/show nav. No route is blocked; if no rows exist, everything is shown.
- `src/lib/module-manager.ts` holds pure rules: `MODULE_DEPENDENCIES`, `PLAN_MODULES` (Starter/Professional/Enterprise), `checkLicense`, dependency checks, activation/removal, and an in-memory hash-chained audit buffer. Persistence is in `use-license-data.ts` (upsert `tenant_modules`, RPC `get_user_tenant_id`).
- Sidebar `moduleKey`s are human labels ("Accounts Receivable", "Risk Management") while module-manager keys are compact ("AR", "RiskManagement"). Check what is actually stored before wiring new gating.
- Per-module RBAC: each domain has `src/lib/<domain>-roles.ts` exporting an action union, `REQUIRED_ROLES`, `canDo`, `missingRoleHint`, `actionTooltip`, and a cached `computeXxxPerms`. Hooks read `user_roles`; role assignment goes through RPCs (`assign_treasury_role`, etc.) and audit tables. Use `*RolesPanel` / `GenericRolesPanel` for admin UI and disable/hide actions with `canDo`.

### Design system

- shadcn/ui components live in `src/components/ui/`; shared business components in `src/components/` (`PageShell`, `Breadcrumb`, `GuidanceBanner`, `KpiDrilldownDialog`, `AgingDrilldownDialog`, `StatusBadge`, `EmptyState`, `DataTableControls`, `ConsolidatedTrendsCard`, ...). `KpiCards.tsx` is a static English demo — do not copy it into live pages.
- Use semantic tokens only (`bg-background`, `text-muted-foreground`, `bg-success`, `border-border`, `sidebar-*`); tokens are HSL variables in `src/index.css`, mapped in `tailwind.config.ts` and read by Tailwind 4 through `@config` in `index.css`. Hard-coded Tailwind palettes (`text-white`, `bg-[#...]`, `emerald-*`) are legacy outliers, not precedent — `emerald-*` has been migrated to `success`, `amber-*`/`blue-*`/`rose-*` (≈160 occurrences) are not yet.
- QUOREICH charter: `--primary` = `#0062db` (`213 100% 43%`), orange `#ff8a51` = `--brand-accent` (`20 100% 66%`, kept separate from shadcn's neutral hover `--accent`), fonts Montserrat (`font-sans`) and Playfair Display (`font-display`).
- Exports: `exportToCSV(rows, columns, filename)` (`src/lib/csv-export.ts`, BOM + comma) and `exportToPDF({...})` (`src/lib/pdf-export.ts`, jsPDF + autotable, A4 landscape). Reuse them.
- Interactive/report elements carry stable `data-testid`s (`kpi-header-<key>`, `kpi-drilldown`, `treasury-close-*`, `btn-export-csv`). Controlled dialogs have no Radix `DialogTrigger`, so the trigger must save `event.currentTarget` and restore focus on close (see `CfoConsolidated.tsx` and `KpiDrilldownDialog.tsx`).

## Testing conventions

- Vitest + jsdom; setup in `src/test/setup.ts`; tests colocated in `__tests__/` folders or as `*.test.ts` next to the module. There are 54 test/spec files today.
- Pure logic/RBAC/SoD tests live in `src/lib/__tests__/`; hook tests in `src/hooks/__tests__/`; page/component integration in `src/pages/__tests__/` and `src/components/__tests__/` (the consolidated-CFO modal and focus-restoration suite is `KpiDrilldownDialog.a11y.test.tsx`).
- Mock Supabase with `vi.mock("@/integrations/supabase/client", ...)` and a hand-rolled PostgREST builder (`select/eq/in/order/limit/range/then`, plus `rpc`); mock `PageShell` as passthrough and `sonner` toasts; wrap in `QueryClientProvider` + `MemoryRouter`. Key regressions: `src/lib/__tests__/lot1-sincerity.test.ts` (no fabricated margins or cash) and `src/hooks/__tests__/use-consolidated-cfo.test.tsx`.
- The Java module has no mocking library use to speak of: its tests are deliberately end-to-end against a real PostgreSQL. `PostgresFixture` starts one `postgres:18.6-alpine` container for the whole run and gives each IT class its own database, because a test that mocks the database cannot observe RLS — and RLS is what is being tested. Fixtures come from `src/test/resources/fixtures/` (`reference-dataset.sql`, `rls-isolation-test.sql`), seeded once per database.

## Environment and current state

- `.env` at the repo root supplies `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for project `banqdfutzlrcvepovrin`. That key is the public anon key; never add a `service_role` key or other secret to the frontend. `.env` is git-ignored via `.env` / `.env.*`.
- This directory **is** its own git repository since 9 Nov 2026: `git init -b main` here, precisely because the parent `C:\` was an accidental repository (untracked, no commits) that would have made `git add .` stage the whole drive. Branch `main`, **no commit yet** — 499 files are staged-able, largest under 2 MB. The production dump is outside the repo (`C:\Users\Abdouramane\QERP-backups\`) and `git check-ignore` confirms `*.backup`/`*.dump`/`*.sql.gz`, `.env`, `node_modules`, `dist`, `.tmp_*`. `bun.lock`/`bun.lockb` are still tracked-looking leftovers — npm is the toolchain.
- Both `package-lock.json` and `bun.lock`/`bun.lockb` are present; `README.md` and this environment use npm (`npx`), while the e2e spec headers show `pnpm`.
- Docs drift worth knowing: README claims SHA-256 audit chains and `current_user_tenant()`; the SQL uses MD5-truncated hashes and `get_user_tenant_id()`.
- Current delivery state is tracked in `roadmap.md` and `docs/recette-lot1.md`: Lot 1 (real treasury, real-cost gross margin, CFO consolidation) is accepted with reserves; the remaining blocker is missing authorized bank data in two companies. Read those before starting new work.

### Static checks (state as of 9 Nov 2026)

All green; keep them that way:

| Commande | Résultat attendu |
|---|---|
| `npm run lint` | **0 erreur**, 447 avertissements (431 `no-explicit-any`, 9 `react-refresh/only-export-components`, 7 `react-hooks/exhaustive-deps`) |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 erreur |
| `npx tsc --noEmit -p tsconfig.node.json` | 0 erreur |
| `npm test` | 38 fichiers, 336 tests |
| `npm run api:check` | `src/api/qerp-schema.ts correspond au contrat OpenAPI.` |
| `cd services/api && ./mvnw verify` | 35 tests (11 unitaires + 24 d'intégration), BUILD SUCCESS |
| `bash scripts/schema/verify-lot0.sh <dump>` | `LOT 0 : CRITÈRE DE SORTIE ATTEINT` |

- `@typescript-eslint/no-explicit-any` est en `warn`, pas en `error`, avec justification dans `eslint.config.js` : les 431 sites sont concentrés sur la frontière de types générés (`(supabase as any)`), pratique sanctionnée ci-dessus. En `error`, `npm run lint` était rouge en permanence et ne servait plus de signal.
- `src/test/setup.ts` doit importer `@testing-library/jest-dom/**vitest**` (et non l'entrée racine, qui augmente le namespace `jest`) : sinon les matchers existent à l'exécution mais pas au typage, et `tsc` remonte 21 erreurs TS2339 dans les tests.
- Les DEUX configs Vite (`vite.config.ts`, `vitest.config.ts`) utilisent `import.meta.dirname` : le chargeur de configuration natif de Vite 8 ne fournit pas `__dirname`.
- `npm run build` n'exécute pas `tsc` : le build passe même avec des erreurs de typage. Lancer les deux.
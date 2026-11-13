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

E2E specs in `tests/e2e/*.spec.ts` are Playwright (`@playwright/test` pinned to 1.64.1, Chromium only) and sit outside Vitest's `include`:

```bash
npx playwright install chromium          # once per workstation
npm run test:e2e                         # whole suite; starts its own Vite on 8082
npm run test:e2e -- tests/e2e/cfo-consolidated.spec.ts
npm run test:e2e:report                  # last HTML report
```

`playwright.config.ts` starts a dedicated Vite on **8082** (`E2E_PORT` overrides) with `VITE_QERP_API_URL` emptied, because the stubbed specs simulate Supabase and the 8081 dev server is often wired to the Java API; it sets `process.env.PORT`/`E2E_BASE_URL` before the specs load. Two fixtures make the Lovable-era specs runnable locally: `fixtures/session.ts` puts a fake, unsigned Supabase session in localStorage (without it every private route redirects to `/login`), and `fixtures/test.ts` — the `test` that stubbed specs import instead of `@playwright/test` — installs a context-level backend baseline (profile in tenant `t-1`, `my_access` = admin with the 43 catalogue rights, empty rows for any other REST read, `null` for any other RPC, a silent realtime socket), so nothing reaches Supabase. A spec's own `page.route`/`context.route` always wins over the baseline. One worker, 60 s timeout: this workstation crashes Chromium workers under memory pressure (`Target crashed`, exit `3221225794`) — read that as the machine, not the code. State (13 Nov 2026): 23 passed, 17 skipped (live), 0 failed in 1.2 min. Two things the stubs must do like the real Supabase: send `access-control-expose-headers: content-range` with any `content-range` (cross-origin, otherwise the browser hides it and every count reads 0), and scope text assertions (`exact: true`, or inside `[data-sonner-toast]`) because buttons and toasts share labels. `treasury-rbac-*.spec.ts` and `treasury-realtime.spec.ts` are live and keep importing `@playwright/test`: they need `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_AUTH_EMAIL_ADMIN`/`E2E_AUTH_PASSWORD_ADMIN`, `E2E_AUTH_EMAIL_NOROLE`/`E2E_AUTH_PASSWORD_NOROLE`, seed rows tagged `E2E-<runId>` and auto-skip when credentials are absent. `tests/e2e/fixtures/clock.ts` freezes time via `page.clock` — call `freezeClock` before `goto`.

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
JAVA_HOME=/c/Users/Abdouramane/tools/jdk-25.0.5+8 ./mvnw spring-boot:run  # see the dev compose below
```

`spring-boot:run` on its own starts nothing usable: `application.yml` reads `QERP_DB_PASSWORD`
with no usable default, and Flyway inherits the application credentials unless
`QERP_MIGRATION_DB_*` is set. Point it at the dev PostgreSQL instead:

```bash
docker compose -f infra/compose.dev.yml up -d postgres
cd services/api
QERP_DB_URL=jdbc:postgresql://localhost:55433/qerp QERP_DB_USER=qerp_api QERP_DB_PASSWORD=qerp_api_dev \
QERP_MIGRATION_DB_USER=postgres QERP_MIGRATION_DB_PASSWORD=postgres \
JAVA_HOME=/c/Users/Abdouramane/tools/jdk-25.0.5+8 ./mvnw spring-boot:run
```

`*IT` classes are Failsafe integration tests and start a disposable `postgres:18.6-alpine`
container via Testcontainers — they need Docker running. `*Test` classes are Surefire unit tests
and need nothing. State as of 13 Nov 2026: `verify` is green, 11 unit + 95 integration tests.

**The workstation's Docker engine is the least reliable part of this setup, and its failures look
like code regressions.** They are not. Observed on 10 Nov 2026, on an unchanged revision that had
just run 24/24 green: (a) `TenantIsolationIT` failed 6/6 with `Failed to initialize JPA
EntityManagerFactory ... Unable to determine Dialect without JDBC metadata`, whose real cause is
`PSQLException: This connection has been closed` on every Hikari pool — the shared test container
lost its connections, with `Thread starvation or clock leap detected (housekeeper delta=46s)` logged
just before; (b) the next run failed 24/24 in under four minutes with `Could not find a valid Docker
environment ... NpipeSocketClientProviderStrategy: failed with BadRequestException (Status 400:
{"ID":"","Containers":0,...})` — the engine answered `/info` with an empty stub. Minutes later
`docker version` reported 29.5.3 and `docker run hello-world` succeeded. The cause is load: this
workstation runs ~25 unrelated containers (Elasticsearch, Kibana, Logstash, MariaDB, three
PostgreSQL, Grafana, MinIO, ClamAV, Frappe, a school-management stack) inside an 8.1 GB Docker VM.
Vitest suffers the same way — `npm test` silently truncated to 19/38 then 37/38 files with
`Timeout waiting for worker to respond`, and a serial run took 2 012 s against a normal ~100 s.
`ubuntu-latest` runners have none of this pressure, which is the argument for reading a red CI run
as authoritative and a red local run as suspect. When a local run fails this way, re-run it with
nothing else going on rather than editing code.

### Development environment (`infra/compose.dev.yml`)

PostgreSQL 18.6 plus the API, both bound to `127.0.0.1`. The ports are **not** the conventional
ones, deliberately: on this workstation 5432 is held by `sms_postgres`, 8080 by a Frappe
container and 8081 by the Vite dev server, so a default `up` on the usual ports fails. Published
ports are 55433 and 8090; override with `QERP_DEV_DB_PORT` / `QERP_API_PORT`.

```bash
docker compose -f infra/compose.dev.yml up -d --build
docker compose -f infra/compose.dev.yml logs -f api
docker compose -f infra/compose.dev.yml down -v    # -v wipes the data volume
```

- The volume mounts at **`/var/lib/postgresql`**, not `/var/lib/postgresql/data`: PostgreSQL 18
  moved `PGDATA` to `/var/lib/postgresql/18/docker`. Mounting the old path silently loses data on
  the next `down`.
- `infra/postgres/init/10-role-applicatif.sh` provisions the `qerp_api` login role. `V1` creates
  it `NOLOGIN` on purpose — a password does not belong in a versioned migration — so granting
  LOGIN is a deployment gesture, and the dev container does exactly what
  `PostgresFixture.provisionApiRole()` does for the tests.
- The compose file sets `QERP_MIGRATION_DB_USER`/`_PASSWORD` to the owner role. Without them
  Flyway inherits the datasource credentials (`qerp_api`), which has no `CREATE` on `public`, and
  the first startup fails. The two-role split is what makes the RLS effective; a single-role dev
  setup would exercise none of the 157 policies.
- `QERP_MIGRATION_DB_*` points at `postgres` here. Production uses a dedicated `qerp_migrate`
  owner role that **does not exist yet** — see `application.yml`, which names it.

### Two deployment targets, one schema — kept in sync automatically

QUOREICH ships **on-premise** (Java API + PostgreSQL, schema applied by Flyway when the API starts) or **in the cloud** (Supabase). Both databases must be identical at all times; three mechanisms enforce it:

- `npm run db:check-twins` (`scripts/schema/check-migration-twins.mjs`, run by CI in `client-web`): every Flyway migration from V16 has a Supabase twin with **the same executable SQL** (comment lines may differ) in the same order, and every Supabase migration after 12 Nov 2026 has its Flyway twin — a migration created on one side only (e.g. by Lovable) fails CI. Write both files for every schema change.
- `.github/workflows/deploy-supabase.yml` runs **after a green CI on `main`** (or on demand, with a dry-run option): `scripts/schema/deploy-supabase.sh` applies pending migrations to Supabase, each in its own transaction together with its row in the ledger `qerp_deploy.applied_migrations` (filename, SHA-256 of the executable SQL); a deployed migration whose SQL changed is refused. It needs the secret `SUPABASE_DB_URL` in the GitHub environment `supabase-production`; without it the workflow fails on purpose (the cloud is then out of date). Lovable does **not** run migration files pushed from this repo.
- `npm run db:supabase-bundle` prints one transaction with every post-baseline migration plus its ledger row, to paste once into Supabase → SQL Editor when catching up by hand; it refuses to run if any of them is already in the ledger. Tested against a database rebuilt from V1..V15 (= production): apply, re-run (nothing to do), edited migration refused, bundle then script.
- On-premise: start the API (or the `api` service of `infra/compose.dev.yml`); Flyway applies what is missing before anything else. The local real-data copy `qerp_reel` is at V33 since 13 Nov 2026.

- `scripts/schema/supabase-platform.sql` holds what only Supabase has (realtime publication `supabase_realtime`); `deploy-supabase.sh` replays it after the migrations. It is idempotent.
- **Own Supabase project since 13 Nov 2026: `ymomubgdhufwtbsqqnas`** (eu-west-1), replacing Lovable Cloud's `banqdfutzlrcvepovrin`, which the owner cannot administer (Lovable Cloud projects live in Lovable's Supabase organisation). Rehearsal done on 13 Nov: baseline V3..V15 (not V1/V2, which emulate `auth` for plain PostgreSQL), then the 9 Nov dump's data (6 users with their original ids and password hashes, 362 rows in 107 tables, identical counts) loaded under `session_replication_role = replica` so posting triggers did not fire, then V16..V33 through `deploy-supabase.sh` (ledger: 18), then the platform script (20 realtime tables). The old cron job (hourly `ai-scheduler` call carrying the old project's bearer token) was deliberately not copied. Cut-over still needs a fresh Lovable export, Auth URL settings, edge functions with their own secrets, and front hosting outside Lovable.
- **Reaching Supabase from this workstation:** the direct host `db.<ref>.supabase.co` is IPv6-only and unreachable here; the session pooler (port 5432) completes TCP but its TLS handshake is cut on the way; the **transaction pooler on port 6543** works (user `postgres.<ref>`, `sslmode=require`). Through the transaction pooler, a session-level `set_config('search_path', '', false)` (every `pg_dump` output starts with one) sticks to the pooled backend and leaks into the next client: after loading dump output, recycle it with `SELECT pg_terminate_backend(pg_backend_pid())`. `deploy-supabase.sh` pins `SET LOCAL search_path TO public, extensions` in each migration transaction for that reason. The connection string lives only in `QERP-backups/supabase-db-url.txt` (outside the repo). Set `PGCLIENTENCODING=UTF8`, otherwise accented literals in ad-hoc SQL fail.
- Project-level agent skills `supabase` and `supabase-postgres-best-practices` are installed in `.claude/skills/` (from `supabase/agent-skills`, pinned in `skills-lock.json`).

State on 13 Nov 2026: the Lovable Cloud project had **none** of V16..V33 (probed with the publishable key: tables 404, `user_roles` still there), so the front pushed since V27 runs against an older schema there; the owner's new project above is complete.

### Continuous integration (`.github/workflows/ci.yml`)

Three jobs: `client-web` (Node from `.nvmrc`, `npm ci`, lint, both `tsc` configs, `npm test`,
`npm run api:check`, `npm run build`), `api-java` (`./mvnw -B -ntp verify` on temurin 25, with
Testcontainers on `ubuntu-latest`), and `image-api` (builds `services/api/Dockerfile`, then
asserts the container runs non-root). Actions are pinned to commit SHAs, not floating tags.

Two things CI deliberately cannot do. It does not run `verify-lot0.sh`: that compares the
migrations to the production dump, which contains real PII and lives outside the repo, so CI
covers "the migrations still produce the frozen manifest" (`SchemaMigrationIT`) while "the
migrations still match the dump" stays a local check before any delivery touching `db/migration`.
And `npm run build` runs without any `VITE_*` variable, because the build genuinely needs none —
they are read in the browser at runtime.

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
- A realtime hook that can be mounted twice must name its channel per instance (`useId()`, see `useRealtimeAlerts`): supabase-js returns the already-subscribed channel for a reused name and `.on()` then throws, which blanked `/alerts` (the bell and the page both subscribe).
- `exportToPDF` is async: a synchronous `try/catch` around it does not see a failure, which becomes an unhandled rejection with no message to the user. It therefore reports its own failure (toast « Impossible de générer le PDF ») and resolves `false`, never rejecting, so the many call sites that ignore the promise are safe; a caller that handles the failure itself (`safeExportTreasuryCloseReport`, the inventory history export) passes `{ throwOnError: true }` and awaits it.
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
- `V16+` are post-baseline evolutions, hand-written, each with a twin in `supabase/migrations/` while Supabase is production. `verify-lot0.sh` stops at V15 (baseline = dump); `SchemaMigrationIT` declares each post-baseline manifest delta explicitly (`DECLENCHEURS_RETIRES`) — never rewrite `public.manifest.tsv`. V16 drops 4 triggers that re-ran an already-attached function (payments ×3 → triple GL posting of every AR receipt / AP payment; goods_receipts ×2 → double stock; journal_entries ×2 → double audit). Historical duplicates are corrected by `scripts/data/doublons-declencheurs/` (reversal via `reverse_journal_entry`, dry-run by default); stock and audit duplicates are reported only. V17 makes AR posting fail closed (SAP/Sage behaviour): `on_ar_invoice_posted` and `on_ap_payment_recorded` raise SQLSTATE `QG001` naming the missing accounts (4110/4000/4310, 5210/4010) instead of skipping the GL entry; drafts are unaffected; the API maps `QG001` to 422 with that message, every other DB refusal stays a generic 409. `on_ap_invoice_posted` and `on_stock_movement_je` still skip silently (Lots 3/4).
- **No account number is hard-coded in AR posting since V18.** Posting functions ask for a *posting role* (`AR_RECEIVABLE`, `SALES_REVENUE`, `VAT_OUTPUT`, `BANK`, `AP_PAYABLE`, `VAT_INPUT`, `PURCHASES`) through `posting_account(tenant, role)`, resolved from `tenant_posting_accounts` (composite FK `(gl_account_id, tenant_id)` → a tenant can only point at its own accounts; an inactive account counts as missing). Charts are reference data (`accounting_frameworks`, `accounting_framework_accounts`, `accounting_framework_role_defaults`); the first is `SYSCOHADA_REVISE` (411/701/4431/521/401/4452/601), flagged `is_validated = false` until a local chartered accountant reviews it (spec §138). A new tenant gets its chart through `apply_accounting_framework(code)` (tenant admin only, idempotent, never overwrites a choice); tests use `PostgresFixture.applySyscohada`. Existing tenants were backfilled with their legacy codes, unchanged — on the 9 Nov dump tenant `d433fcca` posts sales to `4000` while its chart also has `7000 Ventes de marchandises`: an accounting decision, not to be "fixed" silently. Adding a country = adding a framework (data), not code. The screen is `PostingAccountsPanel` (GL settings → « Paramétrage comptable », and AR settings → « Comptabilisation » filtered to AR/TRE), fed by `use-accounting-setup.ts` (API `GET/PUT/POST /api/v1/accounting/*` when `VITE_QERP_API_URL` is set, else the V18 tables through Supabase; `src/lib/accounting-setup.ts` rebuilds the exact API view from Supabase rows). The static `GLPostingConfigPanel` is gone from AR only; AP, assets, stock, etc. still show it (Lots 3/4).
- **Analytics are separate axes, not account segments (V19).** `analytic_axes` (per tenant) → `analytic_values` (hierarchical, dated, active flag; parent on the same axis via composite FK) ; `analytic_rules` = `required`/`forbidden` per account-code prefix, longest prefix wins, no rule = optional ; `analytic_defaults` per customer ; `ar_invoice_analytics` per invoice (draft only) ; `journal_line_analytics` one value per axis per line (frozen once posted, tenant-checked by trigger). `enforce_analytics()` (BEFORE on `journal_entries`, SQLSTATE `QG002`) checks values are usable at the entry date and applies the rules — the *required* rule only for sources that can supply analytics today (`manual`, `ar_invoice`, `ar_receipt`; extend with Lots 3/4), and reversals are not re-checked because `reverse_journal_entry()` now copies analytics. AR posting imputes only the revenue line: invoice value first, then customer default. Axes/rules: tenant admin; values/defaults/imputations: admin or accountant (`tenant_has_any_role`). The free-text `department`/`cost_center`/`project` columns stay for the current screen but are no longer the source (empty in the dump). No tenant has axes yet, so V19 changes nothing until one is defined — verified on `qerp_reel`. V20 adds a DB guard against hierarchy loops (A → B → A). Screens live in the **central** `/settings` (tabs « Comptabilisation » and « Analytique », per the product owner: configuration is centralised there, module settings only link to it); API `/api/v1/analytics` (axes/rules: admin, values: admin or accountant; no delete of axes or values — deactivate), hook `use-analytics-setup.ts`, pure logic `src/lib/analytics-setup.ts` (tree order, longest-prefix preview). On the Supabase path a zero-row UPDATE/DELETE is a refusal (`checkTouched`): RLS filters silently. The AR API maps both `QG001` and `QG002` to 422 with the schema's message. Analytics are entered through `AnalyticSelectors` (invoice form, pre-filled from customer defaults; customer edit dialog) and as one column per active axis in `JournalEntries.tsx` (the hard-coded cost-centre/department lists are gone). `useCreateJournalEntry` always inserts a **draft**, then lines, then `journal_line_analytics`, then flips to `posted` — inserting the header as `posted` was always refused by `enforce_balanced_entry` (« cannot post empty entry »); a refused posting keeps the complete draft and says so.
- **Invoice lines and tax codes (V21), numbering (V22).** `ar_invoice_lines` (quantity, unit price, discount, `tax_code_id`, optional `revenue_account_id`) have their net/tax computed by `compute_ar_invoice_line` (ROUND to 2 per line) and the invoice header is their sum; header-only invoices still post as before. `tax_codes` are per tenant, admin-managed, **rate and code frozen after creation** (new rate = new code), none seeded (legal rates are validated locally). Posting groups revenue by account and VAT by account. Invoice numbers: unique index `(tenant_id, invoice_number)`; when `ar_general_settings.auto_numbering` (default true) the definitive number comes from `next_document_number()` at emission (series `ar_numbering_series`, per-period counters in `document_counters`, row-locked, rolled back with a refused emission → no gaps), drafts keep a provisional `BROUILLON-xxxxxxxx`, an emitted number is immutable. `PostgresFixture.loadReferenceDatasetOnce` turns auto-numbering **off** for test tenants because tests address invoices by number; `NumerotationFacturesIT` turns it back on. The API's `invoiceNumber` is optional; a duplicate is a 409 with a French message.
- **One authorization model since V23 (roles centralised).** `erp_permission_catalog` (43 `module.action` codes at V23, 45 since V33 adds `periods.close`/`periods.reopen`; global) ; `erp_system_roles` + `erp_system_role_permissions` (the 50 `app_role` values and exactly the actions the old `has_*_perm` bodies granted, including `hr.manage_employees` / `hr.run_payroll` / `hr.view_payroll` / `inventory.close` that only admin had) ; per-tenant `erp_roles` (system roles have `code` = enum value, immutable — `guard_system_roles`; custom roles have no code) ; `erp_role_permissions` ; `user_role_assignments`. `has_role`, `has_permission`, the six `has_*_perm`, `is_tenant_admin` and `tenant_has_any_role` all read this model **scoped to the user's profile tenant**; the 157 policies are untouched. Two deliberate tightenings: a role only counts in its own tenant, and an action missing from the catalogue is refused even to admin. Pre-existing custom matrix roles were kept but `needs_review` (no rights). The transition table `user_roles`, its mirrors and the `legacy_has_*` witnesses were removed in V32 (see below). `erp_roles` writes are tenant-admin only (the baseline policy let any member write). The `/settings` tab « Rôles et autorisations » (`AuthorizationsPanel`, hook `use-authorizations.ts`, pure logic `src/lib/authorizations.ts`, API `/api/v1/authorizations`) is the single editor: system roles read-only, custom roles built from the catalogue (optionally copied), activation of `needs_review` roles, assignments, and the `erp_authorization_audit` journal (V25, written by triggers; ordered by its identity column `seq` since V28, because `created_at` = `now()` is shared by every event of one transaction). V26 enforces in the DB, whatever the path: a tenant always keeps an admin, a `needs_review` role cannot be assigned, an assigned role cannot be deleted. The old coarse `erp_permissions` matrix and the static SoD table are gone from the screen. Screens read rights from the DB since V27: `my_access()` (API `GET /api/v1/authorizations/me`, hook `useMyAccess` in `use-my-access.ts`, key `["my-access", tenantId, source]`, invalidated by every matrix mutation) returns the caller's system role codes and catalogue permissions **in their tenant**. The 12 `useMy*Roles` hooks no longer read `user_roles` (which they did without any tenant filter): the six catalogue modules (treasury, crm, hr, inventory, procurement, sales) derive every button from `permissions` (`moduleCan(access, module)`), which also fixes three drifts where the screen contradicted the DB (treasury ignored `admin`; HR opened employee creation to `hr_clerk` while the policy needs `hr.manage_employees`; inventory opened closing to `inventory_controller` while the DB reserves `inventory.close` to admin); the six role-checked modules (budget, compliance, expenses, fixed assets, projects, risk) keep their role logic but on tenant-scoped roles. Still role-based by necessity: CSV export in inventory/sales and module-settings access (no catalogue code). V27 also adds the tenant condition to three permissive policies that leaked across tenants: « Admins view all roles » (user_roles), `risk_audit_admin_select`, `budget_audit_admin_insert`. The 12 `useTenant*Roles` member lists read the matrix since 13 Nov 2026 (`useTenantRoleMembers` in `use-role-members.ts`: `user_role_assignments` → `erp_roles.code`, current tenant, all pages, key `[<prefix>, tenantId]`); the module role panels still *write* through the `assign_*_role` RPCs into `user_roles`, mirrored into the matrix, and their mutations now invalidate `my-access` and `authorizations`. Since V31 the 12 `assign_*_role` RPCs write the matrix through `module_role_set(target, role, grant)` (target checked in the caller's tenant by `module_role_tenant`, SoD read with `module_role_held`); before V31, 11 of the 12 failed or had no effect (`ON CONFLICT (user_id, role)` against a `UNIQUE (user_id, role, tenant_id)`, a non-existent `user_role_assignments.role`, rows written without tenant) and 9 did not check the target's tenant — `assign_crm_role` even took the tenant from a client parameter. `RolesDesModulesIT` covers all 12 and fails without V31. **`user_roles` is gone since V32** (rows missing from the matrix were carried over first, a row without tenant taking the profile's tenant), together with both mirrors and the seven `legacy_*` witnesses; `AutorisationsEquivalenceIT`, which proved the V23 equivalence (50 roles × 49 actions) before the switch, went with them. Tests grant roles with `PostgresFixture.grantRoles(db, user, roleCode, tenant, …)`, backed by `test_support.grant_role` (a schema `SchemaMigrationIT` does not compare). The generated `src/integrations/supabase/types.ts` still lists `user_roles` until Lovable regenerates it; nothing in `src/` reads it.
- **Joining a company is by invitation since V31.** `join_tenant(_tenant_name)` attached the caller to ANY company whose name they typed (SECURITY DEFINER, so V24's guard did not apply), even when already in another — reproduced on the real-data copy: the caller read the other company's customers and invoices. The parameter keeps its name for the existing screen but is now a single-use code from `tenant_invitations` (issued by `create_tenant_invitation(role_id, valid_days 1..30, note)`, tenant admins only, revocable, readable only by tenant admins); only a user with no company may use one, and `create_tenant_for_user` likewise. Screens: `/onboarding` asks for the code; `/settings` → « Rôles et autorisations » → « Invitations » (`use-invitations.ts`, `src/lib/invitations.ts`). V29 made `convert_opportunity_to_quote` check `has_permission(..., 'crm.convert')` instead of `user_roles` (admin saw the button and got `insufficient_role`).
- **Fiscal calendar is central since V33** (SAP OB52, Sage 300 fiscal calendar, Sage X3 fiscal years, AUDCIF art. 7). `fiscal_years` (per tenant, `not_open` → `open` → `closed`, closing is final, at most two open), `fiscal_periods` (generated months, code `YYYY-MM`), `fiscal_modules` (SALES, PURCHASING, INVENTORY, AR, AP, TREASURY, ASSETS, PAYROLL, GL). `period_locks` stays the per-period-per-module status register but is **read-only** for every user (policy `FOR SELECT`, write grants revoked) — before V33 any member, a viewer included, could close or reopen the books by writing to it, and the AR screen did. Every trigger calls one check, `assert_fiscal_period_open(tenant, date, module)` (SQLSTATE `QG003`): a tenant that has defined fiscal years cannot post outside an open one; a closed period refuses that module's operations (AR emission and receipts, AP invoices and payments, sales documents, purchase orders, stock movements, bank transactions, payroll runs, depreciation, GL entries). A tenant with no fiscal year keeps the pre-V33 behaviour (period locks only). Changes go through `set_period_status(period, module, 'open'|'closed', reason)` (GL/TREASURY/INVENTORY delegate to `close_gl_period` / `close_treasury_period` / `close_inventory_period`, which keep their own checks), `create_fiscal_year(start, end)` (first one 1–18 months, any start month; then 12 months, contiguous), `open_fiscal_year`, `close_fiscal_year` (every period of every module closed, earlier years closed). Closing order is **blocking**: GL last, a subledger reopens only while GL is open; reopening needs `periods.reopen` and a reason (`reopen_gl_period` now refuses and points to the central screen). Rights: `periods.close`, `periods.reopen` (catalogue now 45 codes, granted to admin). Journal: `fiscal_calendar_audit` (ordered by identity `seq`). Existing tenants got open calendar years from their oldest dated data to next year. V33 also fixed two closings that always failed in production: inventory (`locked_by`/`locked_at` do not exist) and treasury (`bank_reconciliations.ending_balance` does not exist — it is `bank_balance`). Screen: `/settings?tab=fiscal` (`FiscalCalendarPanel`, hook `use-fiscal-calendar.ts`, pure logic `src/lib/fiscal-calendar.ts`); `CalendrierFiscalIT` covers it. `/settings` now honours `?tab=` (the sidebar links to it).
- **Sidebar is organised by business process** (`src/lib/navigation.ts`, rendered by `DashboardSidebar`): Pilotage, Ventes et clients, Achats et fournisseurs, Stocks, Comptabilité et finance, Ressources humaines, Gouvernance, Administration. `navigation.test.ts` checks every link resolves to a `<Route>` in `App.tsx`, that no page of the former sidebar was dropped and that links are unique. Module « Paramètres » items are kept: those pages still hold module-specific settings not yet moved to `/settings`. The footer shows the current fiscal year from the calendar (it used to be a hard-coded label).
- **PL/pgSQL prepares an expression as one block (V30).** A trigger function attached to several tables must read table-specific `NEW.<col>` only inside an `IF TG_TABLE_NAME = ...` branch: a `CASE` naming another table's column fails on every call (« record "new" has no field … »). `enforce_sales_period_lock` did this and blocked every quotation, sales order and delivery note since 26 Jun 2026; `seed_procurement_approval_queue` blocked every PR/PO submission to approval. `VentesAchatsDeclencheursIT` covers both and fails without V30. The catalogue query to spot the pattern: trigger functions whose `NEW.x` references a column missing on one of their tables (`audit_authorizations` and `guard_system_roles` appear there legitimately — their branches are `IF`s).
- **`profiles.tenant_id` is the root of tenant isolation and is not user-writable since V24.** The baseline policies « Users can update own profile » (no WITH CHECK) and « Users can insert own profile » let any signed-in user re-point their own profile at another tenant and read/write its data — reproduced on the real-data copy. `trg_guard_profile_tenant` (deliberately *not* SECURITY DEFINER, so it sees the caller's role) refuses, for `authenticated` / `anon` / `qerp_api`, any change of `tenant_id` and any insert with a tenant; `create_tenant_for_user()` and other SECURITY DEFINER code (owner role) still link profiles. Never add a client-side write of `profiles.tenant_id`.
- **Integration tests share one PostgreSQL container and Spring caches one context (and one Hikari pool) per IT class.** `PostgresFixture` pins the test pool to 3 connections and the container to `max_connections=200`; at the application's default 10 per pool, 13 IT classes exhausted the default 100 (`remaining connection slots are reserved for roles with the SUPERUSER attribute`), which surfaces as `Unable to determine Dialect without JDBC metadata` — a real limit, not the Docker flake described above.
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
- This directory **is** its own git repository since 9 Nov 2026: `git init -b main` here, precisely because the parent `C:\` was an accidental repository (untracked, no commits) that would have made `git add .` stage the whole drive. Branch `main`; two commits as of 9 Nov 2026 (`19e5100` Lot 0, `60955bb` Lot 1). The production dump is outside the repo (`C:\Users\Abdouramane\QERP-backups\`) and `git check-ignore` confirms `*.backup`/`*.dump`/`*.sql.gz`, `.env`, `node_modules`, `dist`, `.tmp_*`, `target/`. `bun.lock`/`bun.lockb` are still tracked-looking leftovers — npm is the toolchain.
- Node is pinned to **26.13.0** by `.nvmrc`, which `actions/setup-node` reads via `node-version-file`. That is the canonical build version, not a floor: the workstation runs 24.14.1, and `engines` says `>=24.14.1` precisely because everything (lint, both `tsc` configs, 336 tests, `api:check`, `build`) is green on it — a floor above the version the suite is actually verified against would mark the working environment unsupported and turn every local `npm install` into a warning that means nothing. There is deliberately **no `.npmrc` with `engine-strict=true`**.
- Both `package-lock.json` and `bun.lock`/`bun.lockb` are present; `README.md` and this environment use npm (`npx`), while the e2e spec headers show `pnpm`.
- Docs drift worth knowing: README claims SHA-256 audit chains and `current_user_tenant()`; the SQL uses MD5-truncated hashes and `get_user_tenant_id()`.
- Current delivery state is tracked in `roadmap.md`, `docs/recette-lot1.md` and `docs/recette-lot2.md`. Lot 1 (real treasury, real-cost gross margin, CFO consolidation) is accepted with reserves (missing authorized bank data in two companies). Lot 2 (AR vertical slice on the Java API, V16–V32) is technically closed on 13 Nov 2026 — AR-REC met, parity with the SQL path shown — and awaits business acceptance once Lovable has applied V16–V32 and CI is green. Next is Lot 3 (AP, GL, procurement). Read those before starting new work.

### Static checks (state as of 10 Nov 2026)

All green; keep them that way:

| Commande | Résultat attendu |
|---|---|
| `npm run lint` | **0 erreur**, 469 avertissements (essentiellement `no-explicit-any`, 9 `react-refresh/only-export-components`, 7 `react-hooks/exhaustive-deps`) |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 erreur |
| `npx tsc --noEmit -p tsconfig.node.json` | 0 erreur |
| `npm test` | 60 fichiers, 434 tests |
| `npm run test:e2e` | 23 réussis, 17 ignorés (specs connectées), 0 échec |
| `npm run api:check` | `src/api/qerp-schema.ts correspond au contrat OpenAPI.` |
| `cd services/api && ./mvnw verify` | 106 tests (11 unitaires + 95 d'intégration), BUILD SUCCESS |
| `bash scripts/schema/verify-lot0.sh <dump>` | `LOT 0 : CRITÈRE DE SORTIE ATTEINT` |
| `docker compose -f infra/compose.dev.yml config` | configuration valide (aucune erreur) |

La même liste, moins `verify-lot0.sh` (qui exige le dump de production), est rejouée par
`.github/workflows/ci.yml` à chaque poussée : ces contrôles ne valent que s'ils s'exécutent sans
qu'on ait à y penser.

- `@typescript-eslint/no-explicit-any` est en `warn`, pas en `error`, avec justification dans `eslint.config.js` : les 431 sites sont concentrés sur la frontière de types générés (`(supabase as any)`), pratique sanctionnée ci-dessus. En `error`, `npm run lint` était rouge en permanence et ne servait plus de signal.
- `src/test/setup.ts` doit importer `@testing-library/jest-dom/**vitest**` (et non l'entrée racine, qui augmente le namespace `jest`) : sinon les matchers existent à l'exécution mais pas au typage, et `tsc` remonte 21 erreurs TS2339 dans les tests.
- Les DEUX configs Vite (`vite.config.ts`, `vitest.config.ts`) utilisent `import.meta.dirname` : le chargeur de configuration natif de Vite 8 ne fournit pas `__dirname`.
- `npm run build` n'exécute pas `tsc` : le build passe même avec des erreurs de typage. Lancer les deux.
# RH employee import and bulk operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real CSV employee import, configurable bulk HR actions, and automatic employee numbers for each company.

**Architecture:** PostgreSQL owns numbering, authorization, tenant isolation, and atomic writes. Supabase calls tenant-scoped RPCs; on-premise calls matching `/api/v1/hr` endpoints backed by the same SQL functions. The React UI follows the CRM import preview and bulk-selection patterns.

**Tech Stack:** React, TypeScript, Vitest, PapaParse, Spring Boot/JdbcTemplate, Flyway, PostgreSQL, Supabase RPC.

**Spec:** `docs/superpowers/specs/2026-11-15-hr-employee-bulk-operations-design.md`

## Global Constraints

- Never import mock business data.
- Keep company ID derived from authenticated tenant context, not request payload.
- Keep salary/bank data out of import and selected exports.
- Status changes go through configured effective-dated movements and separate approval.
- Add an exact Supabase twin for every Flyway migration.
- Do not deploy migrations to business databases in this work step.

## Review Focus

- Empty/oversized CSV, BOM, French/English headers, invalid dates and malformed email.
- Duplicate matricules in file and existing company records; concurrent numbering allocation.
- Missing company/permission and cross-tenant employee IDs.
- Partial batch errors must roll back all import rows and all movements.
- Repeated clicks must not cause duplicate batch effects; disable submission while pending.

---

### Task 1: Import parser and row validation

**Files:** Create `src/lib/hr-employee-import.ts`; test `src/lib/__tests__/hr-employee-import.test.ts`.

- [ ] Write failing tests for header aliases, required names/contract, optional matricule, email/date validation, in-file duplicate matricules/emails, and summary counts.
- [ ] Run the focused Vitest file and confirm expected failures.
- [ ] Implement pure normalization and validation only.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Employee numbering, import, and configurable movement actions

**Files:** Create V95 migration and Supabase twin; modify `HrApiIT.java`, `SchemaMigrationIT.java`.

- [ ] Add failing PostgreSQL integration tests for configured format/sequence, generated matricule, role denial, atomic CSV import, and atomic movement-action submission with cross-tenant/unconfigured-value rejection.
- [ ] Run `HrApiIT` and confirm the new cases fail because the functions/settings do not exist.
- [ ] Implement tenant-scoped number settings, sequence allocation under row lock, import capped at 1,000 rows, configurable bulk field/options on movement references, and batch movement capped at 500 IDs. Enforce existing HR permissions; add a catalog permission for number settings.
- [ ] Update schema object/policy/permission assertions for the migration.
- [ ] Copy V95 SQL to its Supabase twin and verify exact pair parity.
- [ ] Run the focused Java integration tests and confirm pass.

### Task 3: On-premise API parity

**Files:** Modify `HrController.java`, `HrQuery.java`, `HrApiIT.java`, `services/api/openapi/qerp-api.json`, `src/api/qerp-schema.ts`.

- [ ] Add failing API contract/integration tests for read/save number settings, bulk employee import, and bulk movement creation.
- [ ] Run focused Java tests and confirm the endpoints are absent.
- [ ] Add tenant-context API methods and request validation; persist through the same PostgreSQL functions as Supabase.
- [ ] Regenerate OpenAPI and TypeScript contract using the repository scripts.
- [ ] Run `HrApiIT` and `npm run api:check`.

### Task 4: Settings and employee import UI

**Files:** Create `HrEmployeeNumberSettingsCard.tsx`, `HrEmployeeImportDialog.tsx`; modify `HrSettings.tsx`, `Employees.tsx`, `use-hr-data.ts`; add focused component/page tests.

- [ ] Write failing tests for configurable prefix/year/separator/padding/next value, permission-gated saving, CSV template download, existing/in-file duplicate detection, rejected-row export, generated matricule label, and permission-gated import.
- [ ] Run focused Vitest files and confirm expected failures.
- [ ] Add tenant-scoped React Query hooks and the settings card/import dialog, matching CRM patterns.
- [ ] Add the numbering card to `/hr/settings`; make the create form matricule read-only/generated; add CSV template and rejected-row export while allowing legacy imports to retain supplied values.
- [ ] Run focused tests and then the full frontend suite.

### Task 5: Configurable bulk employee actions

**Files:** Create `EmployeeBulkMovementDialog.tsx`; modify `Employees.tsx`, `use-hr-data.ts`; add component/page tests.

- [ ] Write failing tests for row selection, selected-row export, movement-reference-derived action/value/date/reason validation, permission gating, and clearing selection after success.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement the bulk movement dialog using only configured movement references and connect it to the atomic database/API operation. Do not directly update employee records.
- [ ] Run focused tests and the full frontend suite.

### Task 6: Full verification and documentation

**Files:** Update `docs/roadmap-paie-rh.md` and migration README.

- [ ] Run `npm test -- --run`, `npm run build`, `npx tsc --noEmit`, `npm run api:check`, `npm run db:check-twins`, `git diff --check`, and focused lint.
- [ ] Run Java `mvn verify -q` using temporary PostgreSQL/Testcontainers only.
- [ ] Record results, remaining Paie/RH gaps, and confirm no production database was migrated.

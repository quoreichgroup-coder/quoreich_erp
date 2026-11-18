# Payroll Component Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use each payroll component’s snapshotted GL account in the posted journal, validate mappings before approval, and preserve legacy fallback behavior.

**Architecture:** Add a paired V98 SQL migration that validates component snapshot accounts in payroll precheck and posts account-grouped journal lines by component kind. Keep legal social contributions and tax on their existing tenant posting roles; use role accounts whenever a component lacks a specific GL account. Extend `HrApiIT` to drive the authenticated workflow end to end.

**Tech Stack:** PostgreSQL 18, Flyway, Supabase SQL migrations, Spring MVC integration tests, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-16-payroll-component-accounting-design.md`

## Global Constraints

- Never widen access beyond the current tenant and centralized HR permissions.
- Read the GL account code from the immutable payroll component snapshot.
- Do not change country tax or statutory contribution values.
- Keep existing cycles with no component details postable under legacy role mappings.
- Keep the on-prem Flyway migration identical to its Supabase twin.
- Do not deploy to `qerp_reel` or Supabase as part of this code change.

## Review Focus

- A component account removed or made inactive after calculation must fail precheck and posting atomically.
- A component account from another tenant must never be resolved; the posting side follows the component kind, while the configured account type remains the accountant’s decision.
- Missing component accounts must use existing role mappings and produce a balanced journal.
- Several components mapped to the same account must aggregate without changing totals.
- Legacy runs without component lines must still post exactly as before.

---

### Task 1: Cover account-specific posting and validation

**Files:**
- Modify: `services/api/src/test/java/com/quoreich/qerp/HrApiIT.java`
- Use migration fixture helpers in `services/api/src/test/java/com/quoreich/qerp/PostgresFixture.java`

**Interfaces:**
- Exercise existing `/payroll/runs/{id}/precheck`, `/approve`, and `/post` endpoints.
- Inspect resulting `journal_lines` joined to `gl_accounts` by account code.

- [x] **Step 1: Write failing integration tests**
  - Post a run with one earning and one deduction mapped to distinct active tenant accounts.
  - Assert the earning posts debit, the deduction posts credit, legal contributions and tax still use their role accounts, and the entry balances.
  - Deactivate a referenced component account after generation; assert precheck fails and posting creates no journal entry.
  - Keep an existing test for fallback roles and legacy runs.
- [x] **Step 2: Run `EtatsParRubriquesIT` and verify the new assertions fail because V97 posts only through generic payroll roles.**
- [x] **Step 3: Implement V98 and its byte-identical Supabase twin.**
- [x] **Step 4: Run `EtatsParRubriquesIT` and `HrApiIT` until all tests pass.**
- [x] **Step 5: Run `npm run db:check-twins`, `OpenApiContractIT`, and `npx tsc --noEmit`.**
- [x] **Step 6: Update migration and Paie/RH roadmap documentation.**

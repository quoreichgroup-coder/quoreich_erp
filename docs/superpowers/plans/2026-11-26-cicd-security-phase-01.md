# CI/CD security Phase 01 implementation plan

> Execute with superpowers:executing-plans. Authorization is D-CICD-001 and the user's complete Phase 01 specification; stop at the pull request, with explicit human approval required before merge.

**Goal:** Prevent untrusted CI provenance from reaching deployment secrets or publication tokens.
**Architecture:** Read-only authorization on protected main precedes each privileged job. It verifies the GitHub API run, exact commit, all four gates, dispatch/tag authority and environment policy; only its validated SHA crosses into source checkout.
**Tech stack:** GitHub Actions, dependency-free Node.js REST validator, node:test, js-yaml, actionlint.
**Spec:** User's QERP CI/CD Security Remediation Phase 01, reproduced in the audit's scope and acceptance criteria.

## Global constraints

- Base: latest origin/main, a7e32882a307c379dd1f7efbb0f9c1a3c56d680b.
- Dedicated worktree and security/cicd-phase-01; preserve i18n/poc-langues including dirty files.
- No functional ERP changes, secrets, Supabase project changes, production execution, visibility changes, protection changes or automatic merge.
- Preserve check names: Client web, E2E simulés, API Java, Image de l'API.
- Record server configuration gaps as remaining risks; do not silently claim configuration exists.

## Review focus

- Fork PR named main, same-repository PR and manual CI must never authorize workflow_run.
- Replayed/stale run and tag pointing outside main must fail.
- Missing, skipped, cancelled or superseded failed CI gates must fail.
- Missing/broad environment policies must fail before environment secrets are requested.
- Release and connected E2E must not consume untrusted caches or upload authentication artifacts.

## Tasks

1. [x] Write provenance and YAML wiring regression tests. Run against baseline and capture expected failures.
2. [x] Implement scripts/security/authorize-workflow.mjs and reusable authorization workflow. Run adversarial tests including API pagination/errors.
3. [x] Harden all five existing workflows: explicit entry conditions, immutable validated checkout, nonpersistent Git credentials, job permissions, cache/artifact isolation, release build before login.
4. [x] Investigate installed Megapowers and one-shot hooks via isolated tests only. No real destructive commands or plugin changes.
5. [x] Update all four requested documents with findings, evidence, decisions, verification and operational limitations.
6. [x] Run syntax/security tests, applicable local checks and fresh whole-branch review; correct material findings.
7. [ ] Push dedicated branch and open PR; observe all four required checks, re-read unchanged main ruleset, report verdict and stop.

## Execution record

- Worktree created by native tool at C:/Users/Abdouramane/.codex/worktrees/472e/QERP.
- Ruling: implement directly under existing D-CICD-001 authorization; no extra plan approval required. Only merge needs new explicit approval.
- Initial evidence: upstream run trust checks absent; manual deploy checks do not filter push/main; production environment absent; staging unrestricted; only branch ruleset 28181257 exists.

- Local verification: security57/57; actionlint0; bash32/32; lint0 (1186 warnings); TS0; build0; API0; twins138; full Vitest739/741, isolated a11y12/12. Independent review requested.

- Final review: four material findings fixed with RED-to-GREEN regressions; suite62/62, actionlint0 and Bash32/32.
- Ruling: retain safe input-only hook reproductions requested by the user; no candidate command executes and no installed security control changes.

- Full final local suite: npm test -- --maxWorkers=2 -> 741/741 passed. Earlier 2 load-sensitive failures and isolated12/12 preserved in audit.
- Dedicated PR #13 opened; waiting for final-head required checks. No merge or deployment.

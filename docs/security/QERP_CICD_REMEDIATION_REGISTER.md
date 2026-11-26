# QERP CI/CD remediation register — Phase 01

Decision D-CICD-001. Base main: a7e32882a307c379dd1f7efbb0f9c1a3c56d680b.
Branch: security/cicd-phase-01. Pull request: [#13](https://github.com/quoreichgroup-coder/quoreich_erp/pull/13). Merge and production actions remain unapproved.

| Item | Corrective measure | Status | Validation / owner |
|---|---|---|---|
| CICD-01 / 02 | Push/main/repository identity entry guards and isolated API provenance gate | Implemented, pending PR review | Adversarial event tests and live positive image gate |
| CICD-03 | Manual main-only provenance; actor and rerun actor permissions; edge/nightly coverage | Implemented, pending PR review | Dispatch and YAML expression tests |
| CICD-04 | Strict release tags, exact tag SHA, main ancestry, four push CI gates | Implemented, pending PR review | Tag/CI fixture tests; no release executed |
| CICD-05 | Environment metadata fail-closed enforcement | Implemented; server configuration OPEN | Live staging refused as expected; owner must configure staging and protected production |
| CICD-06 | Release tag authority policy | OPEN, high | Owner: add/review v* tag ruleset; historical workflow risk remains |
| CICD-07 | Nonpersistent checkout credentials, minimal job tokens, delayed login/logout | Implemented | YAML tests; retained GHCR path and successful historical publication |
| CICD-08 | No privileged caches or connected authentication artifact upload | Implemented | All privileged jobs inspected; CI diagnostic artifacts remain isolated |
| CICD-09 | Megapowers repeated-command and parser-budget review | Investigation complete; upstream hardening OPEN | Isolated tests, source hashes; no live guard change |
| CICD-10 | one-shot regex investigation | Reproduced matching flaws; reported compilation symptom OPEN | Five input-only cases; no regex compilation failure on installed GNU grep |
| CICD-11 | Proprietary/public visibility mismatch | OPEN, owner decision | No visibility change |
| CICD-12 | Repository-wide action allowlist / pin enforcement | OPEN, owner policy | Source actions pinned; settings unchanged |

## Validation ledger

| Check | Result |
|---|---|
| Native worktree / base | Isolated from i18n/poc-langues; base matches latest fetched origin/main |
| Regression baseline | New validator initially absent; workflow wiring tests failed for missing guards, credentials and token scope |
| Security implementation | 57/57 at implementation checkpoint; final 62/62 including review regressions |
| Syntax | actionlint 1.7.7 exit 0; 32 Bash bodies pass bash -n without execution; external shellcheck/pyflakes unavailable |
| Lint | Exit 0; 1,186 existing warnings |
| TypeScript app / node | Both exit 0 |
| Front build | Exit 0, 8.26 seconds |
| OpenAPI client | Matches committed contract |
| Migration twins | 138 matching pairs |
| Functional files | git diff confirms no src/services/supabase/tests changes |
| Local Vitest full suite | Final npm test -- --maxWorkers=2: 741/741 passed (133 files, 186.07s). Initial default-worker run: 739 passed / 2 failed in unchanged KpiDrilldownDialog.a11y.test.tsx; isolated rerun 12/12 passed |
| Local hooks | Five selected Go test groups pass; catastrophic command denied 3/3; five one-shot input cases match documented behavior |
| Live image authorization | Authorized main SHA using successful push CI 45865682082 and four actual successful jobs |
| Live staging authorization | Refused before environment access: explicit branch policy missing |
| Historical GHCR | Publication job 140089230046 succeeded in run 45871922000 |
| Post-change GHCR external publication | Not executed; operator verification after approved merge required |
| Independent review | Four material findings corrected; attempt replay, moved tags, maintain role and unauthenticated queues all covered by RED-to-GREEN regressions |
| PR / final head CI | [PR #13 live checks](https://github.com/quoreichgroup-coder/quoreich_erp/pull/13/checks): Client web, E2E simulés, API Java, Image de l'API must each be success on the latest head. Final observed head/run/results are attached to the PR validation report after completion |
| Main ruleset preservation | Authenticated re-read after PR creation: same rules, no bypass actors, active, updated_at remains 2026-11-26T17:22:03.597+00:00; compare once more at final report |

## Completion conditions

- All four exact required CI contexts must succeed on the final PR head; no skipped/neutral substitute.
- Explicit human approval before merge. No merge operation or auto-merge is authorized.
- Environment protections and release-tag rules remain operational prerequisites; their absence is not waived by green CI.
- No secrets added; no Supabase project modified; no production execution; no repository/package visibility change.

## Review closure and final reporting

Implementation commit: 67c756897cdd0164a6ea8db394a27fa649e7672c. Following changes are documentation/evidence only.
The PR validation report records the final head SHA and all four checks without requiring a self-referential
commit SHA in this file. A green run on a previous head is insufficient.
The dedicated worktree is retained for human review; i18n/poc-langues still has its original modified decision
register and untracked archive. No request to discard those files was made or acted on.

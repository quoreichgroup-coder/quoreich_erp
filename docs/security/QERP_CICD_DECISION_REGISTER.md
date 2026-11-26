# QERP CI/CD decision register

| ID | Date | Decision | Authority / effect |
|---|---|---|---|
| D-CICD-001 | 2026-11-26 | Remediate privileged workflow_run trust gaps in a dedicated PR | Explicitly approved by requester; implementation authorized, merge requires new human approval |
| D-CICD-002 | 2026-11-26 | Validate push/main/repository numeric identity, exact workflow/run/attempt and four gates in a read-only job before privileged checkout | Engineering implementation under D-CICD-001; deny on missing/ambiguous evidence |
| D-CICD-003 | 2026-11-26 | Automatic source must be current main; release may use a CI-validated ancestor with an exact vX.Y.Z tag | Prevents stale automatic publication/dispatch rollback; historical release remains available to maintain/admin actors |
| D-CICD-004 | 2026-11-26 | Manual source restricted to main; target allowlist staging/production; production protection metadata verified before environment job | Production reviewers, independent approval and no admin bypass required; missing settings block execution |
| D-CICD-005 | 2026-11-26 | Keep main ruleset 28181257 and its four check names unchanged | Explicit user constraint; approval count 0 and non-strict status checks recorded as existing limitations |
| D-CICD-006 | 2026-11-26 | Remove privileged caches and connected report uploads; never consume upstream artifacts | Reduces cache poisoning and authentication/data exposure; connected diagnostic redaction deferred |
| D-CICD-007 | 2026-11-26 | Do not edit/disable installed local security plugins or retry denied real effects as a substitute for approval | Scope is investigation and safe isolated regression, not machine-level security configuration |
| D-CICD-008 | 2026-11-26 | Record missing environment/tag protections, public visibility and action policy as open owner actions | No server settings, secrets, projects or visibility changed |
| D-CICD-009 | 2026-11-26 | Verify GHCR with retained configuration, existing successful publication evidence and live read-only provenance | No production/tag/registry write used for validation; post-merge publish verification remains required |
| D-CICD-010 | 2026-11-26 | Stop after dedicated remediation PR and validation report | No automatic merge, release or production deployment |

Implementation choices above are engineering decisions within the approved scope, not claims of new business approval.
Remaining open risks need owner review; this register does not accept them on the owner's behalf.

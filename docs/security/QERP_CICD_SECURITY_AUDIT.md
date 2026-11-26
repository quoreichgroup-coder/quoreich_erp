# QERP CI/CD security audit — Phase 01

Date: 2026-11-26. Owner: QUOREICH GROUP. Decision: D-CICD-001 (approved by the requester).
Base: `origin/main` at `a7e32882a307c379dd1f7efbb0f9c1a3c56d680b`.
Scope: every file in `.github/workflows/`, deployment/publication boundaries, dispatches, tags, environment protections and the two installed local hooks.

Pull request: [#13](https://github.com/quoreichgroup-coder/quoreich_erp/pull/13).

## Verdict and acceptance

**CONDITIONAL GO for the remediation pull request; NO-GO for production operation.**
Merge requires explicit human approval and success of **Client web**, **E2E simulés**, **API Java**, **Image de l'API**.
The repository settings and post-merge GHCR publication still require operator verification. This report does not authorize a merge, release or production deployment.

No functional ERP module, migration, Supabase project, secret, repository/package visibility or main protection setting was changed.
The original i18n checkout and its dirty files remain separate from the dedicated native worktree.

## Root cause and attack boundary

The original `livraison.yml:image-main` and `deploy-supabase.yml:deploy` trusted
`workflow_run.conclusion == 'success'` plus the trigger's branch-name filter. A branch called
`main` is not proof of a push to this repository's protected main. CI also runs on pull requests.
Both workflows checked out the upstream `head_sha`; publication then built repository code with
`packages: write`, and deployment ran repository scripts with environment credentials.
Successful untrusted CI could therefore cross into a privileged workflow.

GitHub explicitly documents the privileged nature of workflow_run and its cache/secret risks.
The exploitability of any particular historical fork run depends on GitHub event delivery and commit availability;
the missing trust predicates and privileged checkout were directly observed. No exploit, exfiltration or production action was attempted.

## Findings and corrective actions

| ID | Risk | Evidence at base / observed settings | Correction / residual status |
|---|---|---|---|
| CICD-01 | Critical | Livraison workflow_run accepts any successful upstream event and checks out head_sha | Require push/success/main/same repository name and numeric identity at job entry; read-only API gate verifies exact CI workflow/run/triggering attempt and four successful jobs before publication |
| CICD-02 | Critical | Supabase workflow_run has the same trust gap and accesses environment secret before provenance | Gate precedes environment job; automatic target is staging only; candidate scripts run only from validated SHA |
| CICD-03 | High | Manual Supabase guard accepts any successful CI, without event or branch provenance; edge functions and connected E2E have no source guard | Dispatch only from current main; verify latest push/main CI, current actor and rerun actor write authority; exact checkout; scheduled E2E main only |
| CICD-04 | High | Tag release accepts any successful CI for the SHA, including PR/manual CI; permissive tag pattern | Strict vX.Y.Z, resolve lightweight/annotated tag to exact SHA, verify ancestry in main and push/main CI; current actor and rerun actor need maintain/admin |
| CICD-05 | High, open | Only supabase-staging exists, with no deployment branch policy; supabase-production absent | Refuse environment-bound jobs unless environment metadata/policy is correct. Production also requires reviewers, prevent_self_review and no admin bypass. Owner must configure protections separately |
| CICD-06 | High, open | Rulesets API returns only branch ruleset 28181257; no release tag ruleset | Document need to restrict v* creation/update/deletion to release authorities. Code alone cannot protect an old tag's historical workflow or a writer-modified workflow |
| CICD-07 | Medium | Checkout actions persist credentials by default; release mixes build and registry login | All checkouts persist-credentials false; builds and non-root tests precede login; GHCR token scoped to publish step; logout trap; Actions read limited to authorization jobs |
| CICD-08 | Medium | Release and connected E2E restore npm cache; connected report/trace upload can include sessions and business data | Disable caches in privileged jobs including automatic setup-node caching; retain secret-free CI caches; remove connected artifact upload pending redaction policy |
| CICD-09 | Medium, open | Megapowers 0.34.0 Git-discard / safe-effect gates deny once; catastrophic classifier has length/depth limits | Isolated tests confirm repeat behavior. Treat hook as tripwire, never authorization. Keep sandbox, GitHub rules and human merge approval |
| CICD-10 | Medium, open | one-shot-prompting 1.2.9 regex alternation matches any credentials/secret text, independent of git context; force-push pattern depends on argument order | Safe input-only reproduction retained. Recommend upstream parser/anchored predicates and regression tests; installed controls left enabled and unchanged |
| CICD-11 | Governance, open | GitHub metadata reports public repository despite proprietary product context | Recorded for owner review; no visibility or license change authorized or performed |
| CICD-12 | Medium, open | Actions policy allows all actions and does not enforce SHA pinning globally | Existing/new actions remain SHA pinned in source; organization policy is outside this code-only change |

## Independent review corrections

Four material findings were fixed before publishing the PR, with failing regression tests followed by 62/62 passing:

- Selective job retries cannot reuse an authorization from an earlier caller attempt. Every privileged job compares the authorization output attempt with the current github.run_attempt before environment access. Use Re-run all jobs (or re-run authorization and its dependants); a stale selective retry is deliberately skipped.
- Authorization also binds the canonical upstream CI run attempt to the workflow_run event attempt.
- Only authorized jobs enter deployment/publication concurrency groups. A rejected event no longer displaces a trusted pending job.
- Release authority uses GitHub's actual API representation: maintain is base permission write plus role_name maintain; admin is accepted directly.
- Release steps re-resolve lightweight/annotated remote tags to the authorized SHA after environment approval and immediately before GHCR publication and GitHub release creation.

The last check narrows the approval/build race; server-side tag immutability remains necessary. The GitHub release existence check alone is not a SHA provenance check.

## Final workflow inventory

| Workflow | Trust boundary and permissions | Checkout / artifacts / caches / secrets |
|---|---|---|
| ci.yml | Four unchanged mandatory jobs; contents read; security tests added within Client web | PR source remains unprivileged; no secrets; ephemeral DB fixture password only; npm/Maven caches; failure artifacts diagnostic only and never consumed by privileged jobs |
| authorize.yml (new) | workflow_call only; contents read + actions read; no environment or inherited secrets | Sparse checkout of protected main policy only; no install, cache or artifacts; GET-only API calls; output is validated 40-hex SHA |
| livraison.yml | Separate image/release authorization; image contents read/packages write; release contents/packages write | Exact output SHA; build/test before login; no cache; no upstream artifacts; production variables are public VITE values only |
| deploy-supabase.yml | Main push auto staging; main-only dispatch staging/production; read-only gate before environment | Exact SHA; DB URL only in necessary steps; dry_run defaults true for dispatch; no caches/artifacts |
| deploy-fonctions.yml | Main-only dispatch, target allowlist, CI and environment authorization | Exact SHA; nonempty function names validated before secret step; CLI version retained at 3.4.0; no cache/artifacts |
| parcours-nocturnes.yml | Schedule/dispatch main; current CI and staging policy required | Exact SHA; staging E2E credentials only in required steps; no npm cache and no connected report upload |

There are no artifact download consumers, reusable-workflow secret inheritance, pull_request_target triggers,
self-hosted runners or cross-repository candidate checkouts in the audited workflows.
Existing action SHAs were preserved. CI job names and commands were preserved; only credential persistence
and the additional security check were changed in CI.

## Environment and release operating requirements

The authorization job reads environment metadata before an environment job is requested. It fails closed on API
errors, missing environment, malformed evidence, incomplete pagination, missing/skipped/duplicate gate or invalid source.
It never creates an environment. The operator must configure:

- Staging: custom deployment branch policies, only type branch/name main.
- Production: main branch; v* tag policy for release publication; required reviewers; prevent self review;
  administrator bypass disabled. Dry-run needs the same production protections.
- Release tags: a separate active tag ruleset protecting v* creation, update and deletion. Review bypass actors explicitly.
- No automatic production deployment. Human approval of deployment is separate from the human approval required to merge this PR.

The main ruleset remains active and unchanged: PR required; deletion and non-fast-forward prohibited;
four checks from GitHub Actions integration 15368 required. Its current required approval count is **0** and
strict up-to-date checks are disabled. These were documented, not changed. This PR's human-approval requirement
therefore also needs an operator process; the existing ruleset alone does not enforce it.

## Local hooks investigation

Evidence: [local-hook-review.json](evidence/local-hook-review.json).
Reproduction tool: [review-local-hooks.py](../../scripts/security/review-local-hooks.py).

Megapowers source `hooks/hook_runner.go` evaluates `classifyCommand` before its stateful gates.
The catastrophic string was denied three times in the isolated classifier test.
`gate_context.go` records a per-session/per-skill marker, and Git-discard adds a per-exact-command marker;
a second attempt can proceed without fresh human approval. Missing marker storage falls back to advisory context.
Commands over 16,000 bytes and nested scanning beyond depth 8 delegate to the harness instead of proving safety.
These hooks do not run inside GitHub-hosted CI and are not a deployment boundary.

For one-shot, the observed expression
`git\\s+(add|commit).*\\.env|credentials|secret` applies its last two alternatives to all commands.
A harmless string containing secret was blocked twice. Force-before-main was blocked; the same candidate
arguments with force after main were accepted. Candidate commands were JSON data, never shell-executed.
GNU grep compiled the installed expressions successfully. A reported regex compilation error could not be reproduced
on this installed version/shell; exact failing stderr and shell/version are still needed for that separate symptom.
Use a parsed command/argument model and separate predicates in an upstream fix; do not weaken the controls or retry a
denied real action as an authorization mechanism.

## Validation evidence

- [GitHub baseline](evidence/github-baseline.json): authenticated read-only settings snapshot, main ruleset,
  environments, historical GHCR job result, live positive image authorization and live staging policy refusal.
- `npm run security:check`: 57/57 at implementation checkpoint; fixture adversarial cases plus parsed YAML
  and evaluated job entry expressions. Counts after review are recorded in the remediation register.
- `actionlint 1.7.7 -shellcheck= -pyflakes=`: exit 0. YAML and expressions validated; external ShellCheck/Pyflakes
  integrations were unavailable on this Windows host. Bash bodies receive separate syntax checks.
- `npm run lint`: exit 0, 1,186 pre-existing warnings.
- Both TypeScript noEmit projects: exit 0. API client matches contract. 138 migration pairs match.
- Initial full local Vitest: **739 passed, 2 failed** in unchanged KpiDrilldownDialog.a11y.test.tsx
  (modal accessible naming and focus containment); subsequent isolated result recorded in register.
  Local Node 24.14.1 differs from CI's .nvmrc 26.13.0.
- Final complete local rerun with two workers: **741/741 tests passed**, 133 files, 186.07 seconds.
- Post-review security tests: 62/62; tag-write-step tests execute only stubbed API reads, never publication commands.
- Linux CI and final PR-head checks are recorded in the remediation register and PR.
- No production run, tag push, release creation, registry publication or secret read was used as a test.

GHCR historical run [45871922000](https://github.com/quoreichgroup-coder/quoreich_erp/actions/runs/45871922000)
shows successful construction/publication. Live authorization of main against
[push CI 45865682082](https://github.com/quoreichgroup-coder/quoreich_erp/actions/runs/45865682082) succeeds.
The Dockerfile/context, registry/image path, automatic main and sha-12 tags, version/latest tags and
GITHUB_TOKEN package permission remain in place. New workflow end-to-end publication needs an approved merge
followed by a successful push/main CI; this PR cannot prove that future external write without crossing the stop boundary.
Package inventory was not inspected: the available credential lacks read:packages scope (403).

## Remaining limitations

Protected main and trusted maintainers remain the root of trust. Authorization fetches the policy from main
to avoid executing candidate policy; the gate and policy must first be merged through review. Historical workflows
on old refs can remain vulnerable until server-side ref/environment restrictions are enforced.
Environment settings, tag refs and main can change after an authorization check; the chosen source SHA remains
immutable, but metadata checks are not a transactional lock across approval waits. Recheck settings during release review.
No claim is made about past secret compromise or the correctness of production migration SQL.
Dry-run currently initializes the migration ledger schema/table via the existing deploy script; it is not a read-only
database operation. That functional script was not changed or executed.

Registry publication and release are not atomic: a failure can leave some image tags published before a GitHub release.
Dependency lockfiles and fixed CLI versions reduce drift but do not eliminate upstream package/runner compromise.
Connected report diagnostics are intentionally unavailable until a reviewed redaction policy exists.

## Primary references

- [GitHub workflow_run trigger and risks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GitHub secure workflow use](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub environment metadata and reviewer settings](https://docs.github.com/en/rest/deployments/environments)
- [Megapowers upstream](https://github.com/lawzava/megapowers) and [one-shot upstream](https://github.com/usmanmughaltaleemabad/One-Shot-Plugin): installed source fingerprints, rather than moving upstream heads, are the evidence for local findings.

Additional primary references for reviewed semantics:
[partial rerun output reuse](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
[concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[collaborator permission representation](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user),
[release verify-tag behavior](https://cli.github.com/manual/gh_release_create).

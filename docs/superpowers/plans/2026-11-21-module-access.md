# Module access correction

Goal: a member sees and opens only modules granted by the tenant's effective authorization matrix. The reported member has exactly `accountant`, without HR, inventory, CRM, sales, treasury, budget, compliance or risk permissions.

Use one JSON policy in API resources, consumed by React and Java. A module is allowed by a permission in its namespace; `admin` retains company administration. Do not change account identities, memberships, role assignments, or operation-level permission checks. Unknown protected pages and failed access queries fail closed. Onboarding, identity endpoints and shared shell configuration stay reachable.

- [x] Reproduce unrestricted sidebar and direct page access with React tests.
- [x] Add the shared policy; filter sidebar, search and central settings tabs; guard protected pages before mounting their business components.
- [x] Reproduce unauthorized API reads in an isolated PostgreSQL HTTP integration test, then add the module interceptor using current database permissions for every request.
- [x] Verify legitimate accountant modules, admin access, custom roles, revoked roles and tenant isolation; run frontend suite, targeted API tests, lint and build.
- [x] Review the diff and update the running local API after the verified package is ready. Verify local health and the effective policy for the reported account. Cloud deployment is outside this local repair.

Review focus: URL aliases, stale cached admin data after an error, permission namespace boundaries, the API's tenant context, and self-service onboarding must remain correct.

## Verified outcome

- Shared GET-only catalog exceptions preserve sales/purchasing/accounting form references without opening the source module or granting writes.
- Global CFO and consolidated reporting are restricted to administrators; other members land in their first permitted module. GL widgets do not mount their queries without accounting access.
- Access-query cache keys include the authenticated user, tenant and backend.
- V146 adds a restrictive alert SELECT policy and tenant/module checks to read/resolve RPCs; the local database is now V146. The pre-existing pending V145 is part of the normal Flyway upgrade chain. Neither migration was deployed to cloud by this repair.
- 31 focused frontend tests passed; the full frontend run recorded 700 passed with the existing PDF Blob.text test failure. Vite local build passed; changed frontend files had no lint errors. Global TypeScript still reports unrelated errors in the SMTP/document-render Edge functions.
- ModuleAccessIT: 7/7 passed, including shared reference reads, rejected writes, forged token roles, revocation and alerts. SchemaMigrationIT: 7/7 passed after correcting the existing V142 trigger/policy manifest entries. Java unit suite: no failures (one existing skipped archive test).
- Runtime corrected during role-personalization deployment: the business API is `qerp-api-lot6` on port 8092 with database `qerp_reel`; port 8093 uses a separate development database. The business API now runs the module gates and migration 147, HTTP 200 / UP; its signing key and all business-role/permission/assignment checksums were preserved. Frontend configuration and local build use port 8092. See `2026-11-21-role-permissions.md` and `output/role-permissions-runtime/deployment.json`.
- Rollback program: output/module-access-runtime/previous-api.jar. Database backup: C:/Users/Abdouramane/QERP-backups/qerp_reel_pre_module_access_20261121.backup.

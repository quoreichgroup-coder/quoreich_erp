# RH employee import, numbering, and bulk operations

## Intent

Allow an authorized HR user to import employees from a real CSV file, select employees for safe bulk actions, and configure automatic employee numbers in `/hr/settings`. This removes repetitive data entry while retaining tenant isolation, centrally assigned permissions, and the existing effective-dated HR audit trail.

## Goals

- Generate a unique employee number in PostgreSQL when a create/import row omits one; keep supplied legacy numbers when present.
- Configure prefix, optional calendar year, separator, zero padding, and next sequence per company in RH settings.
- Preview and validate CSV rows before import; show valid/invalid counts and row-level reasons. Import valid rows only, matching the CRM contact importer.
- Provide a downloadable CSV template and let the user export rejected rows with validation errors for correction and reimport.
- Support bulk actions from per-company movement settings. Each configured movement type may expose one configured employee field and its allowed value/label options; the dialog derives its choices from those settings. Submit one effective-dated movement per selected employee in one atomic database operation, then keep the existing separate approval process.
- Enforce access through central Administration permissions, company scoping, and database checks in both Supabase and on-premise API flows.
- Keep salary and bank data out of employee import by default and out of exports.

## Non-goals

- No legal payroll rules, national employee number formats, or tax data are prefilled.
- No direct bulk edits to historical fields, salary, or bank coordinates.
- No physical employee deletion.
- No Excel import in this slice; the established CRM CSV format is the reference. CSV exports remain available for selected rows.

## Approaches considered

1. Generate employee numbers in the browser. Rejected because concurrent imports/users can allocate the same number and Supabase/on-premise could diverge.
2. Generate numbers under a tenant row lock in PostgreSQL. Selected because it serializes allocation and remains the single authority for both storage modes.
3. Directly update status for all selected employees. Rejected because it bypasses V82 effective dates, movement references, approval separation, and audit history. Selected flow creates pending movements atomically and leaves approval to the existing approver role.

## Behavior and constraints

- Number settings belong to the active company. The default settings create `EMP-00001`; year is disabled by default. Prefix, separator, year inclusion, width, and next value are editable by the central RH settings permission.
- The database increments the counter only when it successfully creates an employee. The existing `(tenant_id, matricule)` unique constraint remains the final guard.
- CSV required fields are first name, last name, and contract type. Optional fields are matricule, email, phone, job title, department, and hire date. Salary and bank fields are intentionally excluded; blank matricule and status use active-company settings.
- Preview detects supplied matricules/emails that already exist in the active company as well as duplicates inside the file.
- Invalid rows are displayed and omitted; only valid rows are sent. Database constraint or permission failures abort the import transaction so partial writes are not left behind.
- A movement type exposes a bulk action only when its settings define an allowed employee field and at least one value/label option. The UI does not embed a list of business action types or status choices. A bulk request also requires an effective date, configured reason code, and reason of at least three characters. All selected employees must belong to the active company. The database caps a single batch at 500 and rejects duplicate IDs.
- Import and batch actions use central permissions and remain tenant-scoped through the authenticated database context. No service-role path is introduced.

## Files / implementation boundaries

- A focused `hr-employee-import` utility owns header aliases, row normalization, validation, duplicate checks, and summary.
- `HrEmployeeImportDialog` owns file selection, CSV preview, and import feedback.
- `Employees` owns selection, selected-row export, and the bulk movement dialog entry point.
- A focused settings card owns display and saving of employee number settings under `/hr/settings`; the existing movement settings gain configurable bulk field/value metadata.
- V95 adds tenant-scoped number settings, transactional allocation, bulk import, configurable movement action metadata, and atomic batch movement functions; Supabase receives an exact twin.
- `HrQuery` / `HrController` expose the same operations for on-premise, and generated OpenAPI/client contracts stay aligned.

## Acceptance checks

- Automatic matricules are unique under concurrent creation, respect the configured format, and advance only on committed inserts.
- Invalid and duplicate CSV values are reported before submission; valid rows import with generated matricules; a database error rolls back the batch.
- A bulk action request creates one pending movement/audit submission per employee atomically, does not change employee state before approval, and rejects unconfigured values and cross-tenant IDs.
- Users without the relevant central permission cannot configure numbering, import, or submit bulk movements.
- Frontend tests, Java/PostgreSQL integration tests, API contract checks, and migration twin checks pass.

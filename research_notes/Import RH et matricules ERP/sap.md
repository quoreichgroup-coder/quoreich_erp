# SAP HR master data import, personnel numbering, and mass changes

## Employee master data mass import

### Takeaway
SAP SuccessFactors Employee Central treats bulk employee maintenance as entity-oriented CSV imports and prescribes a dependency-aware sequence for new hires/migration. SAP S/4HANA HCM's migration cockpit likewise requires externally supplied personnel numbers for the employee migration object; these behaviors are product-specific and should not be conflated with one generic SAP import flow.

### Cited Findings
- Employee Central Employee Data Imports supports migration, new hires, updates, deletion, termination, and rehire, using CSV templates corresponding to HRIS elements/entities. [SAP Help: Employee Data Imports](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/employee-data-imports)
- For new or migrated employees, SAP documents this order: Biographical Information; Employment Details; Job Information/Job Relationships; Compensation Information and pay components; Personal Information and related personal entities. Required entities are marked in the sequence. [SAP Help: Employee Data Import Process](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/employee-data-import-process)
- Key cross-entity consistency conditions: the initial Job Information row must have HIRE and its effective date must match the Employment Details hire date; Personal and Compensation Information should also use that hire date. SAP says the sequence follows the logical order of API upsert. [SAP Help: Employee Data Import Process](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/employee-data-import-process)
- For modifications to existing users, import the corresponding entity; SAP states there is no recommended import sequence for that case. [SAP Help: Employee Data Import Process](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/employee-data-import-process)
- Employee Central import setup exposes configurable import concurrency and batch size: SAP recommends thread pool 5 and batch size 100 (values above 100 are truncated). The documentation currently allows up to 250,000 records/file, but recommends smaller single-file sizes per entity (often 30,000, or 20,000 where rules are involved); three jobs can run at once and additional jobs queue. [SAP Help: Configuring Data Import Settings](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/configuring-data-import-settings?locale=en-US)
- For Employee Central person/employment objects, SAP's S/4HANA-to-EC migration documentation identifies Import Employee Data as the manual upload tool; generic objects use Import and Export Data. [SAP Help: Communication Channels for Employee Data Replication](https://help.sap.com/docs/successfactors-ec-s4-hcm-integration/implementing-data-migration-and-replication-to-employee-central/communication-channels-for-employee-data-replication?locale=en-US&state=PRODUCTION&version=2605)
- In the S/4HANA Migration Cockpit HCM - Employee object, the personnel number is a required unique identifier and the number-range interval must be configured for external assignment (PA04; also consider NUMKR/PE03). After migration, settings can be changed to internal assignment if desired. [SAP Help: HCM - Employee](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/de66940cf3e2485c90730289ec815e16.html)

### Inferences
- QERP can adapt the general design pattern by using entity-specific templates/import contracts, explicit required-field and cross-entity validation, and a deterministic create sequence; existing-record edits can target only the affected entity. This is a product-pattern inference, not a claim that SAP's schema or process should be copied.
- Treat file/job limits as operational controls rather than a promise of instantaneous import: show queued/running/completed state and row-level outcomes, and tune chunk sizes to validation/business-rule complexity. This adapts SAP's documented batching and queue behavior.

### Gaps
- These sources describe Employee Central and S/4HANA Migration Cockpit, not the exact legacy ECC LSMW/BDC/PA30 mass-maintenance setup; no ECC-specific import transaction behavior is asserted here.
- SAP docs surfaced the import order and system limits, but this research did not establish a general guarantee of atomic all-or-nothing processing across a file. QERP should define its own transaction and partial-failure semantics explicitly.

## Personnel number assignment and configuration

### Takeaway
In SAP HCM, the personnel number (PERNR) is the employee's key; assignment may be internal (system-issued) or external (provided by the operator/integrating system), controlled by configured number ranges and the NUMKR feature. Integration and migration flows can require external assignment, so number-source policy must be intentional and consistent.

### Cited Findings
- SAP describes the personnel number as uniquely identifying an employee and as the identifier used to assign/store the employee's other infotype properties. HCM configuration can use internal numbering, where SAP assigns the next number, or external numbering, where the entered number is validated against the configured external range. [SAP Help: Employee](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c6c3ffd90792427a9fee1a19df5b0925/e30e41f92ae5423f9c59e66933c33851.html)
- In the Migration Cockpit HCM - Employee migration, personnel numbers must be supplied and the interval must be configured for external assignment in PA04; SAP says to consider feature NUMKR in PE03. SAP notes internal assignment can be restored after the migration is complete. [SAP Help: HCM - Employee](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/de66940cf3e2485c90730289ec815e16.html)
- For Employee Central Assignment ID replication into S/4HANA, SAP's documented initial load config switches to external number ranges, aligns the interval with the incoming Assignment IDs, and configures NUMKR to use that interval. SAP cautions not to switch back from external to internal after employee replication has run. [SAP Help: Replicating Assignment ID from Employee Central](https://help.sap.com/docs/SAP_SUCCESSFACTORS_EMPLOYEE_CENTRAL_INTEGRATION_TO_SAP_BUSINESS_SUITE/b22a1d132dfa438698bceadbafd7a57d/replicating-assignment-id-from-employee-central?locale=en-US)
- For the specific S/4HANA Migration Cockpit flow, a central person ID may be supplied; if omitted, SAP creates the central person with internal numbering and links it to the employee. [SAP Help: HCM - Employee](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/de66940cf3e2485c90730289ec815e16.html)
- Employee Central Payroll has its own selectable PERNR behavior: configuration can use Employee Central Assignment ID with an external range; otherwise it can use an internal range, or a BAdI mapping for external PERNR (SAP says that BAdI option is not recommended). New employment automatically creates another PERNR in Employee Central Payroll, including for global assignment and concurrent employment. [SAP Help: Personnel Numbers in Employee Central Payroll](https://help.sap.com/docs/successfactors-employee-central-payroll/implementing-employee-central-payroll-based-on-sap-human-capital-management-for-sap-erp-hcm/personnel-numbers-in-employee-central-payroll)
- SAP distinguishes employee/personnel number from central person ID: when an employee is referenced to one or more other employees, reference personnel numbers are supplied separately in the migration object. [SAP Help: HCM - Employee](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/de66940cf3e2485c90730289ec815e16.html)

### Inferences
- QERP should decide whether employee numbers are generated by QERP or supplied by an upstream HR/payroll system, make the mode explicit per tenant/integration, and enforce uniqueness and format/range rules at creation and import. Avoid silently switching numbering policy after records exist; this is especially important where external identifiers are persisted downstream.
- Keep a separate stable person identity if the product supports multiple employments or rehires, while treating the employment/personnel identifier as a distinct key. SAP's separate central person and PERNR concepts support this modeling distinction, though QERP's exact identity model is a product decision.

### Gaps
- SAP number-range configuration and transaction identifiers are specific to SAP HCM/S/4HANA; they are not universal requirements for QERP.
- The cited sources do not define a universal rule for whether employee numbers should be sequential, meaningful, or expose organization/location. Those are policy choices.

## Mass changes and actions

### Takeaway
Employee Central offers different mechanisms for distinct scopes: CSV Employee Data Imports cover all HRIS entities; Manage Mass Changes supports effective-dated Job Information/Job Relationship updates in a batch; Mass Data Management supports configured UI requests and business-rule-driven changes for selected objects. These mechanisms differ in target population, object coverage, and rule behavior.

### Cited Findings
- SAP's overview maps Employee Data Imports to all HRIS entities; Mass Changes to Job Information and Job Relationships to those two areas and business-rule-based updates; Mass Data Management to UI bulk updates for Position and Job Information; Foundation Data import/change is a separate tool. [SAP Help: Overview of Mass Changes in Employee Central](https://help.sap.com/doc/ebe6f3ccc4ff40a189fc2a16ba8c8d39/2605/en-US/7734ba068ecd4762a48d33e91a4e0c27.pdf)
- Manage Mass Changes can create effective-dated changes to many Job Information/Job Relationship records in one batch job. The administrator selects an employee group, effective date, target area, and field; SAP examples include assigning a new manager, building, or project. [SAP Help: Mass Changes to Job Information and Job Relationships](https://help.sap.com/docs/sap_successfactors_employee_central/6b8f2827f40642f3aa95dc4ac65055dc/2cd696dee2034777ad4f28a7677b2f21.html?locale=en-us)
- Mass Data Management creates mass change requests for Position, Job Information, or Job Relationship, with an effective date and filters. Required fields differ by area; a Job Information request requires category, legal entity, person type, and title in addition to effective date. The page says rule execution depends on configuring the Mass Changes rule context as Yes. [SAP Help: Creating Mass Change Requests](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/creating-mass-change-requests)
- SAP calls deletion of employee data sensitive because of downstream implications. Employee Data Imports can delete or delimit data in Incremental Load mode, depending on entity and operation type; some entities require separate jobs for delete and add. [SAP Help: Deleting Employee Data with a Single Entity](https://help.sap.com/docs/SAP_SUCCESSFACTORS_EMPLOYEE_CENTRAL/6b8f2827f40642f3aa95dc4ac65055dc/3d39872415624101bdb6617b8fe8413f.html)
- Employee Central import process handles termination by importing Termination Details and rehire according to whether the employee receives a new or existing user ID. For new User ID, SAP lists Employment Details followed by Job Information; for existing ID, Job Information is imported. [SAP Help: Employee Data Import Process](https://help.sap.com/docs/successfactors-employee-central/managing-mass-changes-in-employee-central/employee-data-import-process)

### Inferences
- QERP can make batch action intent safer by separating import/edit, future-dated change, termination, and deletion flows; previewing the affected employees and effective date; then recording per-row results and a durable job history. These are design recommendations inferred from SAP's distinct tools and effective-date/filter model.
- Include explicit operation semantics such as update, delete, and delimit (end-date) rather than treating all removals as hard deletes. SAP distinguishes DELETE from DELIMIT and warns of downstream effects, but the final semantics for QERP should follow its own retention/payroll rules.

### Gaps
- SAP's UI and business-rule capabilities are Employee Central-specific. This research does not establish equivalent functionality for SAP ECC Personnel Administration transactions or every SAP S/4HANA release.
- The consulted Mass Data Management summary identifies its supported objects and rule-context prerequisite; it does not provide a complete description of preview, approval, rollback, or audit behavior, so no such guarantees are claimed.


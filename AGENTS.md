# Project rules

- Keep consolidated CSV generation in the CFO page using the same selected-tenant KPI and trend query results as the displayed charts, so downloads follow the visible scope and period.
- Use design-system buttons inside KPI table headers and explicitly restore dialog focus to the initiating button, because this controlled dialog has no Radix DialogTrigger.
- Qualify every source column in the consolidated CFO RPC and intersect requested tenants with get_accessible_tenants; output variables can shadow columns, and consolidation must never widen access.
- CFO queries expose failures without automatic retries so users can use explicit recovery rather than wait through repeated failing requests.
- Compute CFO trends server-side within accessible selected tenants; past cash uses complete exact-month closing statements, missing history stays NULL, and current cash covers active XOF accounts only to avoid fabricated history or currency conversion.
- Scope bank-account and transaction cache keys and reads by useTenantId; exhaust ordered transaction pages before aggregation or export so reporting cannot silently truncate at 200 rows.
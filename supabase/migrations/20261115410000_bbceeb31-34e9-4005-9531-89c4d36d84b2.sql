-- Réapplique la couverture des clés étrangères après les tables RH et inventaire V81..V91.
-- Le générateur est idempotent et inclut les clés tenant-aware de tous les modules.
SELECT public.install_tenant_isolation_triggers() AS tables_protegees;

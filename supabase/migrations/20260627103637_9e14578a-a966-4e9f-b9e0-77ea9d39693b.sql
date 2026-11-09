
-- Project Accounting RBAC
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'project_planner';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'project_accountant';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'project_controller';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'project_admin';

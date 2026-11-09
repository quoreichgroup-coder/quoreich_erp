
-- Extend app_role enum with fixed asset roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'asset_clerk';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'asset_accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'asset_controller';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'asset_admin';

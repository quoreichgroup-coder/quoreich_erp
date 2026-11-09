
-- Add procurement roles to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_l1';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_l2';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_l3';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_controller';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement_3wm_approver';

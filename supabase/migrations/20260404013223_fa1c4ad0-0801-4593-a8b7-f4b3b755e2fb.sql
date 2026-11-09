
-- Workflow rules table
CREATE TABLE public.workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  module text NOT NULL,
  event_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  combinator text NOT NULL DEFAULT 'AND',
  approvers jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation jsonb,
  sla_hours integer NOT NULL DEFAULT 24,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.workflow_rules
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE INDEX idx_workflow_rules_tenant ON public.workflow_rules(tenant_id);
CREATE INDEX idx_workflow_rules_module ON public.workflow_rules(module);

-- Workflow instances table (tracks running approvals)
CREATE TABLE public.workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  rule_id uuid NOT NULL REFERENCES public.workflow_rules(id),
  reference_type text NOT NULL,
  reference_id uuid,
  status text NOT NULL DEFAULT 'pending',
  current_step integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  decided_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.workflow_instances
  FOR ALL TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE INDEX idx_workflow_instances_tenant ON public.workflow_instances(tenant_id);
CREATE INDEX idx_workflow_instances_rule ON public.workflow_instances(rule_id);
CREATE INDEX idx_workflow_instances_status ON public.workflow_instances(status);

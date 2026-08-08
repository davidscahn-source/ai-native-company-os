-- M3b Proof 4: recommendation → approval → safe action (risk-1 only).
-- Same isolation contract as everything else: FORCE RLS on app.tenant_id.

create table actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id text not null,
  action_type text not null,
  risk_tier int not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'executed')),
  payload jsonb not null default '{}',
  decided_by text,
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz
);
create index actions_by_run on actions (tenant_id, run_id);

create table internal_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  body text not null default '',
  created_from_action uuid not null references actions(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, created_from_action)
);

alter table actions enable row level security;
alter table actions force row level security;
create policy actions_tenant_isolation on actions for all
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table internal_tasks enable row level security;
alter table internal_tasks force row level security;
create policy internal_tasks_tenant_isolation on internal_tasks for all
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

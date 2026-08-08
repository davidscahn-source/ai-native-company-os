-- M2: deterministic Company State snapshots.
-- captured_until is an input, never "now" — snapshots must be replayable.

create table company_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  captured_until timestamptz not null,
  state jsonb not null,
  source_watermark jsonb not null default '{}',
  completeness jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, captured_until)
);

alter table company_state_snapshots enable row level security;
alter table company_state_snapshots force row level security;
create policy by_tenant_state on company_state_snapshots
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

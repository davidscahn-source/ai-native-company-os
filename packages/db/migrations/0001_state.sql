-- M2: deterministic Company State snapshots.
-- entities.first_observed_at: provider-payload-derived time the entity was
-- first observed (NOT ingestion time) — makes entity-count metrics cutoff-
-- scoped and snapshots replayable.
-- captured_until is an input, never "now" — snapshots must be replayable.

alter table entities add column first_observed_at timestamptz;

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

-- M2 graph traversals (neighbors/pathBetween/impactedCustomers) walk edges
-- from either endpoint; without these every recursion step seq-scans relationships.
create index relationships_by_from on relationships (tenant_id, from_entity_id);
create index relationships_by_to on relationships (tenant_id, to_entity_id);

alter table company_state_snapshots enable row level security;
alter table company_state_snapshots force row level security;
create policy by_tenant_state on company_state_snapshots
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Schema v1 — M1 scope only (pipeline tables). Agent/insight tables arrive in M2/M3.
-- Every data-plane table carries tenant_id and is protected by FORCED row-level security:
-- the app must set `app.tenant_id` (via set_config) before touching data-plane tables.


create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  provider text not null,
  status text not null default 'connected',
  credentials_encrypted text,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table raw_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  provider text not null,
  dedup_key text not null,
  payload jsonb not null,
  processing_status text not null default 'pending',
  error text,
  received_at timestamptz not null default now(),
  unique (tenant_id, provider, dedup_key)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  source text not null,
  source_event_id text not null,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',
  confidence numeric not null default 1.0,
  sensitivity text not null default 'normal',
  correlation_id text,
  trace_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, source, source_event_id)
);
create index events_by_type on events (tenant_id, event_type, occurred_at desc);
create index events_by_entity on events (tenant_id, entity_id, occurred_at desc);

create table entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  type text not null,
  display_name text,
  canonical jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index entities_by_type on entities (tenant_id, type);

-- events is created before entities, so its entity link is added here.
alter table events
  add constraint events_entity_id_fkey foreign key (entity_id) references entities(id);

create table source_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  entity_id uuid not null references entities(id),
  provider text not null,
  source_type text not null,
  source_id text not null,
  raw_latest jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, source_type, source_id)
);

create table relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  from_entity_id uuid not null references entities(id),
  to_entity_id uuid not null references entities(id),
  type text not null,
  confidence numeric not null default 1.0,
  evidence jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, from_entity_id, to_entity_id, type)
);

-- Row-level security: FORCED so even the table owner is subject to policies.
do $$
declare t text;
begin
  foreach t in array array['tenants','integrations','raw_events','events','entities','source_links','relationships']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- tenants: a session may only see its own tenant row.
create policy tenant_self on tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- data-plane tables: scoped by tenant_id. Missing app.tenant_id => no rows.
create policy by_tenant_integrations on integrations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy by_tenant_raw_events on raw_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy by_tenant_events on events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy by_tenant_entities on entities
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy by_tenant_source_links on source_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy by_tenant_relationships on relationships
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- tenant creation is a control-plane operation guarded at the app layer;
-- selecting other tenants remains impossible via tenant_self.
create policy tenant_insert on tenants for insert with check (true);

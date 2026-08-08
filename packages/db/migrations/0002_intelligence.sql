-- M3: LLM call ledger + insights. The LLM never writes these tables directly —
-- only the gateway (llm_calls) and the evidence validator (insights) do.

create table llm_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id text not null,
  agent_key text not null,
  profile text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  latency_ms integer not null default 0,
  status text not null,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);
create index llm_calls_by_tenant_day on llm_calls (tenant_id, created_at desc);

create table insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  run_id text not null,
  kind text not null check (kind in ('fact','inference','recommendation','unknown')),
  category text not null,
  statement text not null,
  confidence numeric,
  evidence jsonb not null default '[]',
  source_watermark jsonb not null default '{}',
  harness_version text not null,
  created_at timestamptz not null default now()
);
create index insights_by_tenant on insights (tenant_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['llm_calls','insights']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy by_tenant_%s on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t, t);
  end loop;
end $$;

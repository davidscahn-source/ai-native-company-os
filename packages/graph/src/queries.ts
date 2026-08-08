import type { Queryable } from "@companyos/db";

/**
 * Graph read API — the only sanctioned way to traverse the Company Graph.
 * All queries run inside withTenant(); RLS scopes every row. Depth is
 * hard-capped here as a second guard (v0.6 §20: depth ≤ 4).
 */

const MAX_NEIGHBOR_DEPTH = 2;
const MAX_PATH_DEPTH = 4;

export interface NeighborRow {
  id: string;
  type: string;
  display_name: string | null;
  depth: number;
}

export async function neighbors(
  tx: Queryable,
  entityId: string,
  opts: { depth?: number } = {}
): Promise<NeighborRow[]> {
  const depth = clampDepth(opts.depth ?? 1, MAX_NEIGHBOR_DEPTH);
  return tx.query<NeighborRow>(
    `with recursive walk (node, depth) as (
       select $1::uuid, 0
       union
       select case when r.from_entity_id = w.node then r.to_entity_id else r.from_entity_id end,
              w.depth + 1
       from relationships r
       join walk w on w.node in (r.from_entity_id, r.to_entity_id)
       where w.depth < $2
     )
     select e.id, e.type, e.display_name, min(w.depth) as depth
     from walk w
     join entities e on e.id = w.node
     where w.node <> $1::uuid
     group by e.id, e.type, e.display_name
     order by depth, e.type, e.id`,
    [entityId, depth]
  );
}

export interface TimelineRow {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export async function timeline(
  tx: Queryable,
  entityId: string,
  opts: { limit?: number } = {}
): Promise<TimelineRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  return tx.query<TimelineRow>(
    `select id, event_type, occurred_at, payload
     from events where entity_id = $1
     order by occurred_at desc, id
     limit $2`,
    [entityId, limit]
  );
}

export interface PathResult {
  nodes: string[];
  edgeTypes: string[];
}

export async function pathBetween(
  tx: Queryable,
  fromId: string,
  toId: string,
  opts: { maxDepth?: number } = {}
): Promise<PathResult | null> {
  const maxDepth = clampDepth(opts.maxDepth ?? MAX_PATH_DEPTH, MAX_PATH_DEPTH);
  const rows = await tx.query<{ nodes: string[]; edge_types: string[] }>(
    `with recursive paths (nodes, edge_types, frontier, depth) as (
       select array[$1::uuid], array[]::text[], $1::uuid, 0
       union all
       select p.nodes || n.next_node, p.edge_types || r.type, n.next_node, p.depth + 1
       from paths p
       join relationships r on p.frontier in (r.from_entity_id, r.to_entity_id)
       cross join lateral (
         select case when r.from_entity_id = p.frontier then r.to_entity_id
                     else r.from_entity_id end as next_node
       ) n
       where p.depth < $3 and not (n.next_node = any(p.nodes))
     )
     select nodes, edge_types from paths
     where frontier = $2::uuid
     order by depth, nodes
     limit 1`,
    [fromId, toId, maxDepth]
  );
  const row = rows[0];
  return row ? { nodes: row.nodes, edgeTypes: row.edge_types } : null;
}

export interface ImpactedCustomerRow {
  id: string;
  display_name: string | null;
  distance: number;
}

/** From any entity (incident, deployment, bug...), find reachable customers. */
export async function impactedCustomers(
  tx: Queryable,
  fromEntityId: string,
  opts: { maxDepth?: number } = {}
): Promise<ImpactedCustomerRow[]> {
  const maxDepth = clampDepth(opts.maxDepth ?? MAX_PATH_DEPTH, MAX_PATH_DEPTH);
  return tx.query<ImpactedCustomerRow>(
    `with recursive walk (node, depth) as (
       select $1::uuid, 0
       union
       select case when r.from_entity_id = w.node then r.to_entity_id else r.from_entity_id end,
              w.depth + 1
       from relationships r
       join walk w on w.node in (r.from_entity_id, r.to_entity_id)
       where w.depth < $2
     )
     select e.id, e.display_name, min(w.depth) as distance
     from walk w
     join entities e on e.id = w.node and e.type = 'customer'
     where w.node <> $1
     group by e.id, e.display_name
     order by distance, e.id`,
    [fromEntityId, maxDepth]
  );
}

function clampDepth(requested: number, max: number): number {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`depth must be a positive integer, got ${requested}`);
  }
  if (requested > max) {
    throw new Error(`depth ${requested} exceeds hard cap ${max} (v0.6 §20 guard)`);
  }
  return requested;
}

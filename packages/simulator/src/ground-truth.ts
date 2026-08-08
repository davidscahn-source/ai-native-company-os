/**
 * Ground truth the generator knows about the company it built (M3c Stage B).
 *
 * The critical piece is what most synthetic benchmarks omit: NOISE and
 * NON-relationships. Without decoys — events that sit close together in time
 * but have no causal link — a model that calls every correlation a problem
 * scores perfectly, and the benchmark measures nothing.
 */

export type SignalKind =
  | "churn_risk" // high-value customer, repeated payment failure, gone quiet
  | "stale_bug" // bug open far past the normal resolution time
  | "incident_after_deploy"; // error spike causally following a deployment

/** What the company actually has wrong, and how important it is. */
export interface PlantedSignal {
  id: string;
  kind: SignalKind;
  /** 1 = most important thing in the company. Used for Priority Accuracy. */
  priority: number;
  /** Human-readable statement of the truth, for report rendering. */
  truth: string;
  /**
   * Provider-scoped identifiers a correct answer must be able to point at
   * (e.g. "customer:cus_1000_7"). Detection is credited when the surfaced
   * insight's evidence resolves to at least one of these.
   */
  evidenceKeys: string[];
  /** Earliest moment the signal is fully observable in the data. */
  observableFrom: string;
}

/**
 * A deliberate trap: things that LOOK related (close in time, plausible
 * story) but were generated independently. Claiming a causal link between
 * these is a false positive, not a discovery.
 */
export interface PlantedNoise {
  id: string;
  description: string;
  /** The keys that a naive correlation would wrongly connect. */
  unrelatedKeys: string[];
}

/** Links the generator actually created (a correct causal claim). */
export interface GroundTruthRelationship {
  fromKey: string;
  toKey: string;
  type: string;
}

/** Pairs the generator explicitly did NOT link (asserting these is wrong). */
export interface GroundTruthNonRelationship {
  aKey: string;
  bKey: string;
  /** Why it is tempting — usually temporal proximity. */
  temptation: string;
}

export interface GroundTruth {
  signals: PlantedSignal[];
  noise: PlantedNoise[];
  relationships: GroundTruthRelationship[];
  nonRelationships: GroundTruthNonRelationship[];
}

/** One provider payload, ready for the normal ingestion pipeline. */
export interface GeneratedPayload {
  provider: "stripe" | "github";
  dedupKey: string;
  occurredAt: string;
  payload: unknown;
}

export interface GeneratedCompany {
  seed: number;
  seedClass: string;
  /** Explicit cutoff — the lab never consults wall-clock time. */
  endAt: string;
  days: number;
  payloads: GeneratedPayload[];
  groundTruth: GroundTruth;
  counts: Record<string, number>;
}

export { verifyStripeSignature, verifyGithubSignature } from "./core/signatures.js";
export { ingestPayload } from "./core/pipeline.js";
export type { IngestResult } from "./core/pipeline.js";
export type {
  Normalizer,
  NormalizedBatch,
  EntityDraftOut,
  EventDraftOut,
  RelationshipDraftOut,
} from "./core/types.js";
export { normalizeStripe } from "./stripe/normalizer.js";
export { normalizeGithub } from "./github/normalizer.js";
// test support lives at "@companyos/connectors/testing" — not re-exported here,
// so production consumers never pull in node:fs fixture loading.

/**
 * Deterministic email normalization for entity resolution.
 * Only rules that are safe across providers live here — anything
 * provider-specific (gmail dot-folding) must cite the provider's
 * documented behavior before being added.
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  // plus-addressing (user+tag@) folds to the base address on all major providers
  const plus = local.indexOf("+");
  const foldedLocal = plus >= 0 ? local.slice(0, plus) : local;
  if (foldedLocal.length === 0) return null;
  return `${foldedLocal}@${domain}`;
}

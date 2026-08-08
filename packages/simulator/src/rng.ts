/**
 * Seeded PRNG. The whole lab rests on this: same seed must produce a
 * byte-identical company, so nothing here may consult wall-clock time or
 * Math.random.
 *
 * mulberry32 — small, fast, and good enough for generating plausible
 * business history (it is not, and must never be used as, a CSPRNG).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error(`rng seed must be an integer, got ${seed}`);
    // Force to uint32 so negative or large seeds still behave deterministically.
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`int range inverted: ${min}..${max}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("cannot pick from an empty list");
    return items[this.int(0, items.length - 1)]!;
  }

  /** Fisher-Yates on a copy — never mutates the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * A separate stream derived from this one. Used so that adding a customer
   * does not shift every subsequent bug's random draws — each generation
   * phase gets its own stream and stays stable under unrelated changes.
   */
  fork(label: string): Rng {
    let h = this.state;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new Rng(h);
  }
}

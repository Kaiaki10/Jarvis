/**
 * In-memory sliding-window limiter for the public widget routes. State resets
 * on restart, which is fine: this only has to make abuse slow and noisy, not
 * be an exact quota. Each widget conversation can raise an escalation
 * notification and, with autonomy on, start a Claude session, so an unbounded
 * public endpoint would spend both.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records a hit for `key` and reports whether it is within the limit. A refused hit is not recorded. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return true;
  }

  /** Seconds until `key` may try again, for a Retry-After header. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length < this.limit) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
    // Still over: many distinct live keys at once. Drop the oldest entries
    // rather than growing without bound.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}

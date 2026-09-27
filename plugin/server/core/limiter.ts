/** At most `limit()` runs at once, the rest waiting in turn; the limit is read as each run starts or ends. */
export class Limiter {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly limit: () => number;

  constructor(limit: () => number) {
    this.limit = limit;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    // A run that waits is handed the slot of the one that ends, so none starts past the limit in between.
    if (this.running < this.limit()) this.running++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.running <= this.limit() ? this.waiting.shift() : undefined;
      if (next) next();
      else this.running--;
    }
  }

  /** How many run now, and how many wait for a slot. */
  counts(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  /** Starts what waits, up to the limit, once the limit rose while nothing ended to hand its slot on. */
  admit(): void {
    while (this.waiting.length > 0 && this.running < this.limit()) {
      this.running++;
      this.waiting.shift()!();
    }
  }
}

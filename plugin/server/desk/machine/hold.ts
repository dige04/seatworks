/** A seat's hold on the machine for a measurement: whose, in which project, until when and for what. */
type Holding = { seat: string; phrase: string; project: string; until: number; why: string };

/** Who holds the machine for measuring: while it is held, the desk starts no gate or setup on any project. */
export class MachineHold {
  private holding: Holding | undefined;

  held(now = Date.now()): Holding | undefined {
    return this.holding && this.holding.until > now ? this.holding : undefined;
  }

  /** Takes the machine, or renews the taker's own hold; the other holder when it is someone else's. */
  take(holding: Holding, now = Date.now()): Holding | undefined {
    const current = this.held(now);
    if (current && current.seat !== holding.seat) return current;
    this.holding = holding;
    return undefined;
  }

  /** Lets go of `seat`'s hold; whether it held one. */
  release(seat: string, now = Date.now()): boolean {
    if (this.held(now)?.seat !== seat) return false;
    this.holding = undefined;
    return true;
  }

  /** Forgets a hold past its time; whether there was one to forget. */
  expire(now = Date.now()): boolean {
    if (!this.holding || this.holding.until > now) return false;
    this.holding = undefined;
    return true;
  }
}

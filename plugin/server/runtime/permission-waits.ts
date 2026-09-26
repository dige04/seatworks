const KEPT = 500;

/** When each seat's permission request reached the plugin, since Paseo's request carries no time: how long it has waited. */
export class PermissionWaits {
  private readonly heard = new Map<string, number>();

  asked(seat: string, request: string, at = Date.now()): void {
    this.heard.set(`${seat}\n${request}`, at);
    for (const key of this.heard.keys()) {
      if (this.heard.size <= KEPT) break;
      this.heard.delete(key);
    }
  }

  heardAt(seat: string, request: string): number | undefined {
    return this.heard.get(`${seat}\n${request}`);
  }

  forget(seat: string): void {
    for (const key of this.heard.keys()) if (key.startsWith(`${seat}\n`)) this.heard.delete(key);
  }
}

import type { Project } from "./project/project.ts";

export const workKey = (project: Project, id: string): string => `${project.slug}:${id}`;

/** Work a call in this process has in hand, such as a lane closing; a restart loses it, and the patrol repairs it. */
export class Claims {
  private readonly held = new Set<string>();

  take(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  has(key: string): boolean {
    return this.held.has(key);
  }

  release(key: string): void {
    this.held.delete(key);
  }
}

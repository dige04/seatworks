import type { Project } from "../desk/project/project.ts";

const KEPT = 10;

export type Trouble = { kind: string; at: number; detail: string };

/** Trouble nobody is mailed about, the last few per project, kept where a screen can show it rather than only in the log. */
export class Troubles {
  private readonly lists = new Map<string, Trouble[]>();

  of(project: Project): Trouble[] {
    return this.lists.get(project.slug) ?? [];
  }

  add(project: Project, kind: string, detail: string): void {
    const list = this.lists.get(project.slug) ?? [];
    list.push({ kind, at: Date.now(), detail });
    if (list.length > KEPT) list.splice(0, list.length - KEPT);
    this.lists.set(project.slug, list);
  }
}

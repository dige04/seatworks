import { join } from "node:path";
import { readJson, writeJson } from "../../core/store.ts";
import type { Project } from "../../desk/project/project.ts";

/** Where the Human last marked the report read; lost, the next report only runs over more of the record. */
const seenFile = (project: Project) => join(project.state, "report.json");

export function seenAt(project: Project): number | null {
  const seen = readJson<{ seen?: unknown }>(seenFile(project), {}).seen;
  return typeof seen === "number" ? seen : null;
}

/** `until` is the end of the report they read, so what came after it stays for the next; an older one moves nothing. */
export function markSeen(project: Project, until: number, now = Date.now()): number {
  const seen = Math.max(seenAt(project) ?? 0, Math.min(until, now));
  writeJson(seenFile(project), { seen });
  return seen;
}

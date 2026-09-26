import type { DeskEvent } from "./events.ts";
import type { Project } from "../project/project.ts";
import { appendRecord } from "./records.ts";

export function recordEvent(project: Project, event: DeskEvent): void {
  appendRecord(project.state, "events", `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

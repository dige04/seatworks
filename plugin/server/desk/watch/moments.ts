import type { DeskServices } from "../services.ts";
import type { Project } from "../project/project.ts";
import { notice } from "./notice.ts";

/** The moments SLP wakes whoever supervises for, as the desk sees them happen: a task struggling, structure settling, a sharp turn, a Lead idle with nothing going. */
type MomentKind = "struggling" | "architecture" | "turning" | "lane-idle";

/**
 * Raises a moment about `seat` as a code fact of W's: it opens or sights an incident, which the book holds in shadow,
 * budgets, labels and tells whoever supervises, or keeps for somebody to sit down.
 */
export async function tellMoment(
  desk: DeskServices,
  project: Project,
  seat: string,
  kind: MomentKind,
  what: string,
): Promise<void> {
  const look = await desk.roster.look(seat).catch(() => undefined);
  const noticed = { id: seat, provider: look?.provider ?? "", title: look?.title };
  await notice(desk, project, noticed, [{ kind, level: "attend", quote: what, facts: [kind] }]);
}

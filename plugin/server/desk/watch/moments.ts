import type { DeskServices } from "../services.ts";
import type { Project } from "../project/project.ts";
import { notice } from "./notice.ts";

/** The moments SLP wakes whoever supervises for, as the desk sees them happen: a task struggling, structure settling, a sharp turn, a Lead idle with nothing going. */
type MomentKind = "struggling" | "architecture" | "turning" | "lane-idle";

/** A moment about `seat`, raised as a code fact of W's: an incident opened or sighted and told to whoever supervises. */
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

import type { DeskServices } from "../services.ts";
import type { Project } from "../project/project.ts";
import { notice } from "./notice.ts";

type MomentKind = "struggling" | "architecture" | "turning";

/** A moment about `seat`, raised as a code fact of W's: an incident opened or sighted and told to whoever supervises. */
export async function tellMoment(
  desk: Pick<DeskServices, "kit" | "incidents" | "teamFor" | "mail" | "roster">,
  project: Project,
  seat: string,
  kind: MomentKind,
  what: string,
): Promise<void> {
  const look = await desk.roster.look(seat).catch(() => undefined);
  const noticed = { id: seat, provider: look?.provider ?? "", title: look?.title };
  await notice(desk, project, noticed, [{ kind, level: "attend", quote: what, facts: [kind] }]);
}

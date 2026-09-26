import type { DeskServices } from "../services.ts";
import type { Project } from "../project/project.ts";
import { fact, findingsOf } from "../../domain/incident.ts";
import { notice } from "./notice.ts";

/** A moment about `seat` as a code fact of W's: an incident opened or sighted and told to whoever supervises. */
export async function tellMoment(
  desk: Pick<DeskServices, "kit" | "incidents" | "teamFor" | "mail" | "roster">,
  project: Project,
  seat: string,
  kind: "architecture" | "goal-turned",
  what: string,
): Promise<void> {
  const look = await desk.roster.look(seat).catch(() => undefined);
  const noticed = { id: seat, provider: look?.provider ?? "", title: look?.title };
  await notice(desk, project, noticed, findingsOf([fact(kind, what)]));
}

import type { Kit } from "../catalog/kit/kit.ts";
import { can, seatOf, toolsOf } from "../catalog/kit/roles.ts";
import type { PermissionRequested, Seats } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { leadLaneOf, taskOfPeer } from "../domain/ledger.ts";
import { holdOn } from "../desk/lanes/hold.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { ownerOf } from "./owner-of.ts";

type PermissionDeps = {
  kit: Kit;
  desk: Desk;
  seats: Pick<Seats, "respond">;
  /** Whether the Human stays in the loop for this project: off, the Supervisor answers the seats' permissions. */
  hitlOn: (project: Project) => boolean;
  log: (project: Project, line: string) => void;
};

/** Where a seat puts a question instead, by the tools it holds: one that holds no way to ask settles it itself. */
function askInstead(tools: string[]): string {
  if (tools.includes("ask_human"))
    return "put it to the Human with ask_human, or ask them in your reply and end your turn";
  if (tools.includes("ask")) return "ask it with ask, then end your turn; the answer arrives as a message";
  return "answer from what you have, saying what you could not settle, then end your turn";
}

/** Where a seat's permission request goes: refused on hold or as a question that stops a turn, else to whoever gives it. */
export class PermissionRules {
  private readonly deps: PermissionDeps;

  constructor(deps: PermissionDeps) {
    this.deps = deps;
  }

  /** A seat stopped on a permission: refused while its lane is on hold, else its owner is told, for the Human to give it. */
  async permission({ agent, request }: PermissionRequested): Promise<void> {
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(agent.cwd);
    const hold = holdOn(project.state, agent.id, can(role, "supervise"));
    if (hold) {
      await this.deps.seats.respond(agent.id, request.id, {
        behavior: "deny",
        message: `${hold}. Do nothing more until you are told it resumes.`,
      });
      return;
    }
    // A seat stopped on a question reads nothing, and a team waiting on a sleeping Human is stuck: the question goes by the desk.
    // With the Human out of the loop, the Supervisor grills them on the concept with its agent's own question instead.
    const grilling = can(role, "supervise") && !this.deps.hitlOn(project);
    if (request.kind === "question" && !grilling) {
      await this.deps.seats.respond(agent.id, request.id, {
        behavior: "deny",
        message: `A question that stops your turn is not taken here: ${askInstead(toolsOf(this.deps.kit, role))}.`,
      });
      return;
    }
    if (can(role, "supervise")) {
      this.deps.log(project, `waiting on the Human: ${agent.id} ${request.title ?? request.name ?? request.kind}`);
      return;
    }
    const who = agent.title ?? `${role.label} ${agent.id}`;
    const permitter = this.deps.hitlOn(project) ? undefined : await this.permitterOf(project, agent.id);
    const owner = permitter ? undefined : await ownerOf(this.deps.desk, project, agent.id, role);
    const posted = await this.deps.desk.post(
      permitter?.to ?? owner?.to,
      permitter
        ? seatLetters.permission(agent.id, who, request, "supervisor", permitter.from)
        : seatLetters.permission(agent.id, who, request, owner!.reader),
    );
    // Mail for nobody is dropped: the request is left in Paseo, and this record is all that says so.
    if (posted === "nobody")
      this.deps.log(project, `nobody is seated to answer ${permitter?.from ?? who}'s permission ${request.id}`);
  }

  /** With the Human out of the loop, a Lead's or Peer's permission is whoever supervises its lane, by the task or lane it works. */
  private async permitterOf(project: Project, agentId: string): Promise<{ to?: string; from: string } | undefined> {
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, agentId);
    const lane = task ? ledger.lanes[task.lane] : leadLaneOf(ledger, agentId);
    if (!lane) return undefined;
    return { to: await this.deps.desk.supervisorFor(project, lane.opener), from: task?.id ?? lane.id };
  }
}

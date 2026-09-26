import { turnFailure } from "../catalog/kit/ecosystem-patterns.ts";
import type { Attention } from "../../shared/views.ts";
import type { Kit, RoleSpec } from "../catalog/kit/kit.ts";
import { can, seatOf, toolsOf, worksTasks } from "../catalog/kit/roles.ts";
import type { PermissionRequested, Seats, TurnEnded } from "../core/ports.ts";
import type { Lane } from "../domain/lane.ts";
import { DECIDED, TASK, type Task } from "../domain/task.ts";
import { fact, findingsOf } from "../domain/incident.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, laneOfLead, leadLaneOf, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { holdOn } from "../desk/lanes/hold.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { messageLetters } from "../desk/letters/message-letters.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { deniedCall, lastToolCall, malformed, outputText } from "./timeline.ts";
import type { Troubles } from "./troubles.ts";

type TurnDeps = {
  kit: Kit;
  desk: Desk;
  seats: Pick<Seats, "respond">;
  /** Whether the Human stays in the loop for this project: off, the Supervisor asks them directly. */
  hitlOn: (project: Project) => boolean;
  attention: (project: Project) => Pick<Attention, "silentTurns" | "quietChars">;
  remember: (project: Project) => void;
  log: (project: Project, line: string) => void;
  troubles: Troubles;
};

/** Where a seat puts a question instead, by the tools it holds: one that holds no way to ask settles it itself. */
function askInstead(tools: string[]): string {
  if (tools.includes("ask_human"))
    return "put it to the Human with ask_human, or ask them in your reply and end your turn";
  if (tools.includes("ask")) return "ask it with ask, then end your turn; the answer arrives as a message";
  return "answer from what you have, saying what you could not settle, then end your turn";
}

export class TurnRules {
  readonly lastEnding = new Map<string, string>();
  private readonly deps: TurnDeps;
  private readonly startedAt = new Map<string, number>();

  constructor(deps: TurnDeps) {
    this.deps = deps;
  }

  started(agentId: string): void {
    this.startedAt.set(agentId, Date.now());
  }

  /** A call the harness refused because its input was not JSON; it never reaches the desk, so only this reports it. */
  malformedCalls(event: TurnEnded): void {
    const seat = seatOf(this.deps.kit, event.agent.provider);
    if (!seat?.role.tools) return;
    const project = projectOf(event.agent.cwd);
    for (const call of malformed(event.timeline, seat.harness.timeline?.unparsed)) {
      this.deps.desk.event(project, {
        kind: "call.malformed",
        agent: event.agent.id,
        role: seat.role.role,
        tool: call.tool,
        error: call.quote,
      });
      this.deps.troubles.add(
        project,
        "call.malformed",
        `the ${seat.role.label}'s ${call.tool} was written with an input that is not JSON, and never reached the desk`,
      );
    }
  }

  forget(agentId: string): void {
    this.startedAt.delete(agentId);
    this.lastEnding.delete(agentId);
  }

  private async ownerOf(
    project: Project,
    agentId: string,
    role: RoleSpec,
  ): Promise<{ to: string | undefined; reader: "lead" | "supervisor" | "leadGone" }> {
    // A Lead's owner is whoever supervises; an unreadable ledger must not stop its failures reaching anyone.
    if (can(role, "lead")) {
      let opener: string | undefined;
      try {
        opener = laneOfLead(loadLedger(project.state), agentId)?.opener;
      } catch {
        // No opener then: whoever supervises the project is asked.
      }
      return { to: await this.deps.desk.supervisorFor(project, opener), reader: "supervisor" };
    }
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, agentId);
    if (!task) return { to: undefined, reader: "lead" };
    // A Lead no longer seated would never read it: whoever supervises is told, and can seat one.
    const reader = await this.deps.desk.readerOf(project, ledger.lanes[task.lane]);
    return { to: reader.to, reader: reader.as === "lead" ? "lead" : "leadGone" };
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
    const owner = permitter ? undefined : await this.ownerOf(project, agent.id, role);
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

  /** The Human wrote to a Lead or Peer in its own chat: whoever supervises is told, so nothing reaches a lane past its owner unseen. */
  async spoke(seat: { id: string; provider: string; cwd: string }, text: string): Promise<void> {
    const role = seatOf(this.deps.kit, seat.provider)?.role;
    if (!role || can(role, "supervise")) return;
    const project = projectOf(seat.cwd);
    const ledger = loadLedger(project.state);
    const task = taskOfPeer(ledger, seat.id);
    const lane = task ? ledger.lanes[task.lane] : leadLaneOf(ledger, seat.id);
    if (!lane) return;
    const to = await this.deps.desk.supervisorFor(project, lane.opener);
    await this.deps.desk.post(to, messageLetters.humanWrote(lane, task, seat.id, text));
  }

  async ended(event: TurnEnded): Promise<void> {
    const { agent, outcome, timeline } = event;
    const role = seatOf(this.deps.kit, agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(agent.cwd);
    this.deps.remember(project);
    const started = this.startedAt.get(agent.id) ?? Date.now() - 30 * 60_000;
    this.startedAt.delete(agent.id);
    if (outcome.kind === "canceled") return;
    const text = outputText(timeline);
    this.lastEnding.set(agent.id, text);
    if (outcome.kind === "failed") {
      const owner = await this.ownerOf(project, agent.id, role);
      await this.deps.desk.post(
        owner.to,
        seatLetters.failed(
          agent.id,
          event.turnId ?? Date.now(),
          agent.title ?? `${role.label} ${agent.id}`,
          outcome.error.message,
          owner.reader,
          turnFailure(this.deps.kit, outcome.error.message),
        ),
      );
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    // The read-only status tool counts as heard from, but not as reaching somebody.
    const spoke = (ledger.agents[agent.id]?.spokeAt ?? 0) >= started;
    if (worksTasks(role)) await this.workerEnded(project, ledger, event, text, recorded, spoke);
  }

  private async workerEnded(
    project: Project,
    ledger: Ledger,
    event: TurnEnded,
    text: string,
    recorded: boolean,
    spoke: boolean,
  ): Promise<void> {
    const task = taskOfPeer(ledger, event.agent.id);
    if (!task) return;
    if (DECIDED.includes(task.status) && !recorded) return;
    // Handed back, or its merge failed: what comes next is its Lead's call, so a quiet turn is no silence.
    if (recorded || task.status === "done" || task.status === "failed")
      return this.heard(project, task, recorded, spoke);
    // A call still in flight is not silence: a nudge here started a second gate beside the first.
    if (this.deps.desk.inFlight(event.agent.id)) return;
    await this.silent(project, ledger.lanes[task.lane], task, event, text);
  }

  /** Heard from, so the quiet count restarts; left standing it was a lifetime tally. */
  private heard(project: Project, task: Task, recorded: boolean, spoke: boolean): void {
    const { desk } = this.deps;
    if (spoke && task.silent > 0)
      desk.setTask(project, task.id, (entry) => {
        entry.silent = 0;
      });
    // Nothing else sets a stalled task back to running once its Peer works again.
    if (recorded && task.status === "stalled")
      desk.moveTask(project, task.id, "resume", (entry) => {
        delete entry.peerGone;
      });
  }

  /** A turn ended with no hand-back and no ask: counted and nudged, then stalled and told to its Lead, and once to whoever supervises. */
  private async silent(
    project: Project,
    lane: Lane | undefined,
    task: Task,
    event: TurnEnded,
    text: string,
  ): Promise<void> {
    const { desk } = this.deps;
    const { agent, timeline } = event;
    const { silentTurns, quietChars } = this.deps.attention(project);
    const denied = deniedCall(timeline, this.deps.kit.ecosystem.watch.refused, quietChars);
    desk.event(project, {
      kind: "turn.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
      lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600),
    });
    const updated = desk.setTask(project, task.id, (entry) => {
      entry.silent += 1;
      if (entry.silent >= silentTurns || denied) TASK.move(entry, "stall");
    });
    if (!updated) return;
    if (updated.status !== "stalled") {
      await desk.post(agent.id, seatLetters.nudge(updated, "done"));
      return;
    }
    const reader = await desk.readerOf(project, lane);
    await desk.post(reader.to, seatLetters.stalled(task, text, updated.silent, denied, reader.as));
    desk.event(project, {
      kind: "task.silent",
      task: task.id,
      denied: denied?.what ?? null,
      refused: denied?.refused ?? false,
    });
    if (task.status === "stalled") return;
    const why = denied
      ? `its Peer's last call ${denied.refused ? "was refused" : "did not finish"}: ${denied.what}`
      : `its Peer ended ${updated.silent} turns without a hand-back or an ask`;
    const seat = { id: agent.id, provider: agent.provider, title: agent.title };
    await desk.notice(project, seat, findingsOf([fact("stalled", why)]));
  }
}

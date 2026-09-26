import { turnFailure } from "../catalog/kit/ecosystem-patterns.ts";
import type { Attention } from "../../shared/views.ts";
import type { Kit } from "../catalog/kit/kit.ts";
import { can, seatOf, worksTasks } from "../catalog/kit/roles.ts";
import type { TurnEnded } from "../core/ports.ts";
import type { Lane } from "../domain/lane.ts";
import { DECIDED, TASK, type Task } from "../domain/task.ts";
import { fact, findingsOf } from "../domain/incident.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, leadLaneOf, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { messageLetters } from "../desk/letters/message-letters.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { deniedCall, lastToolCall, malformed, outputText } from "./timeline.ts";
import type { Troubles } from "./troubles.ts";
import { ownerOf } from "./owner-of.ts";

type TurnDeps = {
  kit: Kit;
  desk: Desk;
  attention: (project: Project) => Pick<Attention, "silentTurns" | "quietChars">;
  remember: (project: Project) => void;
  troubles: Troubles;
};

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
      const owner = await ownerOf(this.deps.desk, project, agent.id, role);
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

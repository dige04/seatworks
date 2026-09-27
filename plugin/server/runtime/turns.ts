import { turnFailure } from "../catalog/kit/ecosystem-patterns.ts";
import type { Attention } from "../../shared/views.ts";
import type { Kit } from "../catalog/kit/kit.ts";
import { can, seatOf, worksTasks } from "../catalog/kit/roles.ts";
import type { TurnEnded } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { leadLaneOf, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { messageLetters } from "../desk/letters/message-letters.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { deniedCall, lastToolCall, malformed, outputText } from "./timeline.ts";
import { ownerOf } from "./owner-of.ts";

type TurnDeps = {
  kit: Kit;
  desk: Desk;
  attention: (project: Project) => Pick<Attention, "quietChars">;
  remember: (project: Project) => void;
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

  /** A call the harness refused because its input was not JSON; it never reaches the desk, so only this records it. */
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
    if (!worksTasks(role)) return;
    const denied = deniedCall(timeline, this.deps.kit.ecosystem.watch.refused, this.deps.attention(project).quietChars);
    await this.deps.desk.workerEnded(project, ledger, {
      seat: { id: agent.id, provider: agent.provider, title: agent.title },
      text,
      recorded,
      spoke,
      calling: this.deps.desk.inFlight(agent.id),
      ...(denied ? { denied } : {}),
      lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600),
    });
  }
}

import { tmpdir } from "node:os";
import type { Kit } from "../catalog/kit/kit.ts";
import { watchPatterns } from "../catalog/kit/ecosystem-patterns.ts";
import { TEAM_SERVER } from "../catalog/kit/kit.ts";
import { seatOf } from "../catalog/kit/roles.ts";
import { errorText } from "../core/errors.ts";
import type { TurnEnded } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { laneOfLead, taskOfPeer } from "../domain/ledger.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { type Project, gateCommands, projectOf, readProjectConfig } from "../desk/project/project.ts";
import type { TeamSource } from "./team-source.ts";
import { malformed } from "./timeline.ts";
import type { Fact } from "../domain/incident.ts";
import { callsTo } from "./watch/facts.ts";
import type { SeatContext, SeatLook, SeatWatch, WatchedSeat, Watches } from "./watch/watches.ts";
import { daemonLog } from "../core/logger.ts";

const TROUBLES = 10;

export type Trouble = { kind: string; at: number; detail: string };

type WatchingDeps = { kit: Kit; source: TeamSource; desk: Desk; watches: () => Watches };

/** Between the watch and the desk: what the watch reads of a seat, what it noticed, and trouble shown on screen rather than mailed. */
export class Watching {
  private readonly deps: WatchingDeps;
  private readonly troubles = new Map<string, Trouble[]>();

  constructor(deps: WatchingDeps) {
    this.deps = deps;
  }

  troublesOf(project: Project): Trouble[] {
    return this.troubles.get(project.slug) ?? [];
  }

  context(seat: WatchedSeat): SeatContext | undefined {
    const found = seatOf(this.deps.kit, seat.provider);
    if (!found) return undefined;
    const project = projectOf(seat.cwd);
    const attention = this.deps.source.teamFor(project).attention;
    let scope: string[] | undefined;
    let placed = false;
    try {
      const ledger = loadLedger(project.state);
      const task = taskOfPeer(ledger, seat.id);
      scope =
        task?.kind !== "code" ? undefined : task.mode === "parallel" ? task.holds : ledger.lanes[task.lane]?.writeSet;
      placed = Boolean(task ?? laneOfLead(ledger, seat.id));
    } catch (error) {
      this.deps.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: errorText(error) });
    }
    const orders = readProjectConfig(project.state);
    if ("fault" in orders)
      this.deps.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: orders.fault });
    return {
      placed,
      rules: {
        ...watchPatterns(this.deps.kit, attention),
        desk: callsTo(found.harness.mcpCall, found.harness.mcpServerField, TEAM_SERVER),
        gates: gateCommands(seat.cwd, "config" in orders ? orders.config.gate : undefined, this.deps.kit.ecosystem),
        cwd: seat.cwd,
        temp: tmpdir(),
        scope,
        repeatsAt: attention.repeatsAt,
        recoverWithin: attention.recoverWithin,
        refusalsAt: attention.refusalsAt,
        stuckWithin: attention.stuckWithin,
      },
      handedBack: (at) => {
        try {
          const handback = taskOfPeer(loadLedger(project.state), seat.id)?.handback;
          return handback && handback.at >= at && !handback.gate ? handback.outcome : undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  private noticed(watch: SeatWatch, facts: Fact[]): void {
    if (this.deps.watches().get(watch.seat.id) !== watch) return;
    const project = projectOf(watch.seat.cwd);
    this.deps.desk
      .saw(project, watch.seat, facts, { instruction: watch.window.instruction(), turn: watch.turnId })
      .catch((error) => daemonLog.error("what the watch noticed could not be recorded:", error));
  }

  /** Trouble nobody is mailed about, kept where a screen can show it rather than only in the log. */
  private troubled(project: Project, kind: string, detail: string): void {
    const list = this.troubles.get(project.slug) ?? [];
    list.push({ kind, at: Date.now(), detail });
    if (list.length > TROUBLES) list.splice(0, list.length - TROUBLES);
    this.troubles.set(project.slug, list);
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
      this.troubled(
        project,
        "call.malformed",
        `the ${seat.role.label}'s ${call.tool} was written with an input that is not JSON, and never reached the desk`,
      );
    }
  }

  /** A look's new words go to the brains: the seat's own only, its thinking and what it said, never a tool's output. */
  looked(watch: SeatWatch, look: SeatLook): void {
    const project = projectOf(watch.seat.cwd);
    const items = look.units.flatMap((unit) =>
      (unit.kind === "thought" || unit.kind === "said") && unit.text.trim()
        ? [{ kind: unit.kind, text: unit.text }]
        : [],
    );
    const { facts, since, instruction } = look;
    this.deps.desk
      .look(project, watch.seat, { items, facts, since, ...(instruction ? { instruction } : {}) })
      .catch((error) => daemonLog.error("what the watch looked at could not be read:", error));
  }

  found(watch: SeatWatch, facts: Fact[]): void {
    const project = projectOf(watch.seat.cwd);
    for (const fact of facts)
      this.deps.desk.event(project, {
        kind: "watch.fact",
        agent: watch.seat.id,
        fact: fact.kind,
        level: fact.level,
        quote: fact.quote,
      });
    this.noticed(watch, facts);
  }
}

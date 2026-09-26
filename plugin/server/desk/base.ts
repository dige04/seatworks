import type { Kit, SensorSpec } from "../catalog/kit/kit.ts";
import type { Team } from "../catalog/team/team.ts";
import type { KeyedQueue } from "../core/keyed-queue.ts";
import type { Limiter } from "../core/limiter.ts";
import type { CodeIndex, Judge, Posted } from "../core/ports.ts";
import type { Claims } from "./claims.ts";
import type { Letter } from "./letters/envelope.ts";
import type { Project } from "./project/project.ts";
import type { IncidentStore } from "./store/incident-store.ts";
import type { LedgerStore } from "./store/ledger-store.ts";

/** How the desk mails a seat; "nobody" when there is nobody to read it. */
type Mail = { post(to: string | undefined, letter: Letter): Promise<Posted | "nobody"> };

export type DeskBase = {
  kit: Kit;
  projects: Map<string, Project>;
  ledgers: LedgerStore;
  incidents: IncidentStore;
  mail: Mail;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor: (project: Project) => CodeIndex[];
  sensorFor: (spec: SensorSpec, key: string) => Judge | undefined;
  seating: Claims;
  closing: Claims;
  landings: KeyedQueue;
  gates: Limiter;
  stopping: AbortSignal;
};

import { LANE, type LaneMove } from "../../domain/lane.ts";
import { TASK, type TaskMove, type TaskStatus } from "../../domain/task.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { keptFault } from "../../core/store.ts";
import { loadLedger, readLedgerFile, saveLedger } from "./ledger.ts";
import type { Project } from "../project/project.ts";

/** What a transaction returns: never a promise, since awaiting inside one lets another change in between read and write. */
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;

/** Every project's ledger. A change is read, decided and saved with nothing awaited between, so none lands in the middle. */
export class LedgerStore {
  private readonly touched: (project: Project) => void;

  constructor(touched: (project: Project) => void) {
    this.touched = touched;
  }

  read(project: Project): Ledger {
    return loadLedger(project.state);
  }

  transact<T>(project: Project, decide: (ledger: Ledger) => Sync<T>): T {
    this.touched(project);
    const read = readLedgerFile(project.state);
    if ("fault" in read) throw keptFault(read.fault);
    const result = decide(read.ledger);
    saveLedger(project.state, read.ledger);
    return result;
  }

  setLane<T = void>(project: Project, laneId: string, change: (lane: Lane) => Sync<T>): T | undefined {
    return this.transact<T | undefined>(project, (ledger) => {
      const lane = ledger.lanes[laneId];
      return lane ? change(lane) : undefined;
    });
  }

  setTask(project: Project, taskId: string, change: (task: Task) => void): Task | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      change(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  moveTask(
    project: Project,
    taskId: string,
    move: TaskMove,
    change?: (task: Task) => void,
  ): Task | TaskStatus | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      if (!TASK.move(task, move)) return task.status;
      change?.(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  moveLane(project: Project, laneId: string, move: LaneMove): void {
    this.setLane(project, laneId, (lane) => {
      LANE.move(lane, move);
    });
  }
}

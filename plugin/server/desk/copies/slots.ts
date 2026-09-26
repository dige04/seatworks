import { recordEvent } from "../store/event-log.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addWorktree,
  branchExists,
  currentBranch,
  dropMerged,
  git,
  lockWorktree,
  pristineState,
  removeWorktree,
  unlockWorktree,
} from "../../core/git.ts";
import type { Workspace, Workspaces } from "../../core/ports.ts";
import { worktreeRoot } from "../../core/paths.ts";
import type { DeskBase } from "../base.ts";
import { closeIndexes, openIndexes } from "./indexes.ts";
import { sweepCopies } from "./sweep.ts";
import { type Slot, nextSlotId } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { type Project, gitTimeout, loadConfig } from "../project/project.ts";
import { runGate } from "../../core/gate.ts";
import { errorText } from "../../core/errors.ts";
import { firstUnder } from "../../core/fs.ts";
import { unsavedIn } from "./unsaved.ts";
import { bringIncluded } from "./worktree-include.ts";

type Holder = { lane?: string; task?: string };

/** How the project's setup went in a copy it just made, for whoever works there first. */
export type SetUp = { command: string; ok: boolean; seconds: number; failed: string; logFile: string; tail: string };

export class Slots {
  private readonly desk: Pick<DeskBase, "ledgers" | "log" | "projects" | "indexesFor" | "stopping">;
  private readonly workspaces: Workspaces;

  constructor(
    desk: Pick<DeskBase, "ledgers" | "log" | "projects" | "indexesFor" | "stopping">,
    workspaces: Workspaces,
  ) {
    this.desk = desk;
    this.workspaces = workspaces;
  }

  /** `work` is what the copy is taken for, as its workspace is named: a lane or a task, its id and title. */
  async acquire(
    project: Project,
    branch: string,
    base: string,
    holder: Holder,
    work: string,
  ): Promise<Slot & { setUp?: SetUp }> {
    const picked = this.reserve(project, holder);
    let checkedOut = false;
    try {
      const reused = await this.checkOut(project, picked, branch, base);
      checkedOut = true;
      const missed = await bringIncluded(project.root, picked.path);
      if (missed) this.desk.log(project, `working copy ${picked.id}: ${missed}`);
      const setUp = await this.setUp(project, picked);
      await lockWorktree(
        project.root,
        picked.path,
        `seatworks: the working copy of ${work}, which the desk removes itself`,
      );
      const workspaceId = await this.workspaceFor(project, picked, work);
      recordEvent(project, { kind: "slot.taken", slot: picked.id, branch, ...holder });
      openIndexes(this.desk, project, picked, reused);
      return { ...picked, workspaceId, setUp };
    } catch (error) {
      // The branch it made goes with the copy: left behind, it would refuse every later try at the same work.
      if (checkedOut) await this.release(project, picked.id, branch, base);
      else this.free(project, picked.id);
      throw error;
    }
  }

  /** The project's setup, run in a copy it just made before anyone works there, told which copy by its number. */
  private async setUp(project: Project, slot: Slot): Promise<SetUp | undefined> {
    const { setup, gateTimeoutMinutes } = loadConfig(project.state);
    if (!setup) return undefined;
    const logFile = join(project.state, "gates", `setup-${slot.id}-${Date.now()}.log`);
    const copy = { SEATWORKS_COPY: slot.id.replace(/\D/g, "") };
    const run = await runGate(setup, slot.path, logFile, gitTimeout(project), this.desk.stopping, copy);
    const failed = run.stopped
      ? "was stopped as the plugin stopped"
      : run.timedOut
        ? `timed out after ${gateTimeoutMinutes} minutes`
        : `failed with exit ${run.code}`;
    if (!run.ok) this.desk.log(project, `setup in working copy ${slot.id} ${failed}; its log is ${logFile}`);
    return { command: setup, ok: run.ok, seconds: run.seconds, failed, logFile, tail: run.tail };
  }

  async projectWorkspace(project: Project): Promise<Workspace> {
    const kept = await this.workspaces.named(project.slug).catch(() => undefined);
    return kept ?? (await this.workspaces.make(project.slug, project.root));
  }

  /**
   * Returns the branch it kept because its work is not in `into` yet; `into` is named, as `branch -d` reads what is
   * checked out. A copy holding work no commit does is never removed: it stays, off the record, for the Human.
   */
  async release(
    project: Project,
    slotId: string | undefined,
    dropBranch?: string,
    into?: string,
  ): Promise<string | undefined> {
    if (!slotId) return undefined;
    const slot = loadLedger(project.state).slots[slotId];
    let kept: string | undefined;
    const unsaved = slot && existsSync(slot.path) ? await unsavedIn(slot.path) : undefined;
    // Its work is over: a copy kept for the Human is theirs to move or remove as git lets them.
    if (slot && unsaved) await unlockWorktree(project.root, slot.path);
    if (slot) {
      closeIndexes(this.desk, project, slot);
      if (unsaved)
        this.desk.log(project, `working copy ${slot.id} ${unsaved}, so it stays at ${slot.path}, with its branch`);
      else kept = await this.remove(project, slot, dropBranch, into);
      if (slot.workspaceId) {
        try {
          await this.workspaces.archive(slot.workspaceId);
        } catch (error) {
          this.desk.log(project, `workspace ${slot.workspaceId} could not be put away: ${errorText(error)}`);
        }
      }
    }
    this.drop(project, slotId);
    recordEvent(project, { kind: "slot.released", slot: slotId, removed: Boolean(slot) && !unsaved, kept });
    return kept;
  }

  /** Removes a copy whose work is all committed, and the branches it no longer needs; returns one it kept. */
  private async remove(project: Project, slot: Slot, dropBranch?: string, into?: string): Promise<string | undefined> {
    // A lane's copy left on a task's branch: that branch goes with the copy once the lane branch has all of it.
    const off = slot.lane && existsSync(slot.path) ? await currentBranch(slot.path) : undefined;
    if (existsSync(slot.path)) {
      await git(slot.path, ["switch", "--detach"]);
      await removeWorktree(project.root, slot.path);
      // And the directory the desk made: git leaves one often enough, and nothing else reliably sweeps it.
      this.discard(project, slot.path);
    }
    // A branch whose commits are not in `into` holds the only copy of that work: clutter is cheaper.
    const kept = dropBranch && !(into && (await dropMerged(project.root, dropBranch, into))) ? dropBranch : undefined;
    const laneBranch = slot.lane ? loadLedger(project.state).lanes[slot.lane]?.branch : undefined;
    if (off && laneBranch && off !== laneBranch && off !== dropBranch) await dropMerged(project.root, off, laneBranch);
    return kept;
  }

  private reserve(project: Project, holder: Holder): Slot {
    return this.desk.ledgers.transact(project, (ledger) => {
      const free = Object.values(ledger.slots)
        .filter((slot) => !slot.lane && !slot.task)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (free) {
        Object.assign(free, holder);
        return { ...free };
      }
      const id = nextSlotId(ledger);
      const slot: Slot = { id, path: join(worktreeRoot(), project.slug, id), createdAt: Date.now(), ...holder };
      ledger.slots[id] = slot;
      return { ...slot };
    });
  }

  private async checkOut(project: Project, slot: Slot, branch: string, base: string): Promise<boolean> {
    if (!(await branchExists(project.root, base))) throw new Error(`the base branch ${base} does not exist`);
    if (await branchExists(project.root, branch)) throw new Error(`the branch ${branch} already exists`);
    if (existsSync(join(slot.path, ".git"))) {
      const held = await pristineState(slot.path);
      if (held !== "clean")
        throw new Error(
          held === "dirty"
            ? `working copy ${slot.id} has uncommitted changes`
            : `git could not read working copy ${slot.id} at ${slot.path}`,
        );
      const run = await git(slot.path, ["switch", "-c", branch, base]);
      if (run.code !== 0) throw new Error(run.stderr.trim() || "git switch failed");
      return true;
    }
    mkdirSync(dirname(slot.path), { recursive: true });
    const added = await addWorktree(project.root, slot.path, branch, base, gitTimeout(project));
    if (!added.ok) throw new Error(added.message);
    return false;
  }

  /**
   * The copy's workspace, named after the project and then its work: the sweep knows the desk's copies by that first
   * word. A new one is filed under its project, since a bare directory makes a Paseo project the plugin cannot remove.
   */
  private async workspaceFor(project: Project, slot: Slot, work: string): Promise<string> {
    const title = `${project.slug} ${slot.id} · ${work}`;
    if (slot.workspaceId) {
      await this.workspaces
        .retitle(slot.workspaceId, title)
        .catch((error) =>
          this.desk.log(project, `workspace ${slot.workspaceId} kept its old name: ${errorText(error)}`),
        );
      return slot.workspaceId;
    }
    const home = await this.projectWorkspace(project);
    if (!home.project)
      throw new Error(
        `the project's workspace in Paseo names no Paseo project, so its working copy was not made: Paseo would have made it a project of its own`,
      );
    const { id: workspaceId } = await this.workspaces.make(title, slot.path, home.project);
    this.desk.ledgers.transact(project, (ledger) => {
      const entry = ledger.slots[slot.id];
      if (entry) entry.workspaceId = workspaceId;
    });
    return workspaceId;
  }

  sweep(project: Project, busy = false): Promise<void> {
    return sweepCopies(this.desk, this.workspaces, project, busy);
  }

  /** Removes a path the desk made under its own worktree root, and the project's folder once empty. */
  private discard(project: Project, path: string): void {
    const root = join(worktreeRoot(), project.slug);
    if (!firstUnder(root, path)) return;
    try {
      rmSync(path, { recursive: true, force: true });
      if (readdirSync(root).length === 0) rmdirSync(root);
    } catch {
      // Gone already, or still in use: the next sweep tries again.
    }
  }

  private free(project: Project, slotId: string): void {
    return this.desk.ledgers.transact(project, (ledger) => {
      const entry = ledger.slots[slotId];
      if (entry) {
        delete entry.lane;
        delete entry.task;
      }
    });
  }

  private drop(project: Project, slotId: string): void {
    return this.desk.ledgers.transact(project, (ledger) => {
      delete ledger.slots[slotId];
    });
  }
}

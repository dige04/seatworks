import type { Amendment } from "./amendment.ts";
import { Lifecycle, type Moves } from "./lifecycle.ts";

export type LaneStatus = "waiting" | "open" | "closed";

const MOVES = {
  open: { from: ["waiting"], to: "open" },
  wait: { from: ["open"], to: "waiting" },
  close: { from: ["open"], to: "closed" },
  drop: { from: ["waiting"], to: "closed" },
} satisfies Moves<LaneStatus>;

export type LaneMove = keyof typeof MOVES;

export const LANE = new Lifecycle<LaneStatus, LaneMove>(MOVES);

/**
 * The project's own copy waiting to come off `branch`, then drop it `into` its lane; only while still on it, since a
 * later lane may own it.
 */
type Restoring = { writers: string[]; base: string; branch: string; into?: string };

/**
 * A land_lane that met seats mid-turn in the lane's copy, carried out by the desk once their turns end: for `by`, over
 * the gate as it asked, and only on the lane as it stood when asked, at `tip` with the READY and amendments it had.
 */
export type LandOrder = {
  by: string;
  writers: string[];
  at: number;
  tip: string;
  ready?: number;
  amended: number;
  overGate: boolean;
  reason: string;
};

export type Lane = {
  id: string;
  title: string;
  outcome: string;
  humanSaid?: string;
  acceptance: string[];
  appetite?: string;
  deadline?: string;
  outOfScope: string[];
  issue?: string;
  base: string;
  branch: string;
  detourOf?: string;
  onBranch?: boolean;
  startSha?: string;
  worktree?: string;
  slot?: string;
  writeSet: string[];
  contracts: string[];
  /** The lane that audits what lands on its base before it goes out: its Lead hears of each landing there. */
  audit?: true;
  lead?: string;
  workspaceId?: string;
  opener: string;
  status: LaneStatus;
  after?: string[];
  opening?: { home?: "newBranch" | "isolate"; role?: string };
  held?: { why: string; tried?: boolean };
  onHold?: { at: number; by: string; reason: string };
  ready?: { at: number };
  tipGate?: { sha: string; ok: boolean };
  landApproval?: {
    since: number;
    head: string;
    signals: string[];
    paths: string[];
    evidence: string[];
    overGate: boolean;
    reason?: string;
    approved?: { at: number; note: string };
  };
  landed?: boolean;
  closedAt?: number;
  amended?: Amendment[];
  restoring?: Restoring;
  landing?: LandOrder;
  openedAt: number;
  tasks: number;
  reviews?: number;
};

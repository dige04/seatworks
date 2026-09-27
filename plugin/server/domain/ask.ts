import { Lifecycle } from "./lifecycle.ts";

type AskStatus = "open" | "answered";

export const ASK = new Lifecycle<AskStatus, "answer">({ answer: { from: ["open"], to: "answered" } });

/** How a challenge weighed: it changes the plan, it is another sound option the plan need not take, or it is not worth stopping for. */
export const VERDICTS = ["changes", "alternative", "minor"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A question one seat put to another, open until answered. */
export type Ask = {
  id: string;
  from: string;
  fromRole: string;
  to: string;
  lane?: string;
  task?: string;
  kind: string;
  /** A challenge's: the premise, constraint or choice the asker's evidence shows does not fit. */
  disputes?: string;
  text: string;
  default?: string;
  status: AskStatus;
  openedAt: number;
  movedAt?: number;
  answer?: string;
  /** Why the answer changes the plan or keeps it, and how the challenge weighed: a challenge is never answered without both. */
  why?: string;
  verdict?: Verdict;
};

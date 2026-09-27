import { Lifecycle } from "./lifecycle.ts";

type AskStatus = "open" | "answered";

export const ASK = new Lifecycle<AskStatus, "answer">({ answer: { from: ["open"], to: "answered" } });

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
  /** Why the answer changes the plan or keeps it: a challenge is never answered without one. */
  why?: string;
};

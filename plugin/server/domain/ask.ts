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
  text: string;
  default?: string;
  status: AskStatus;
  openedAt: number;
  remindedAt?: number;
  reminders: number;
  escalated?: boolean;
  answer?: string;
};

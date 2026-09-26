import { hash } from "../../core/text.ts";
import { type Letter, mail } from "./envelope.ts";

/** A call a seat was told to stop waiting for: the one identity its late answer and its lost answer share. */
type Waited = { agent: string; tool: string; started: number };

export const callLetters = {
  /**
   * The answer to a call that ran longer than the seat that made it could wait for; `cut` when the call was stopped on
   * the seat's side before its answer came, rather than outrunning the wait.
   */
  later(call: Waited, reply: { ok: boolean; text: string }, cut = false): Letter {
    const why = cut
      ? "which was stopped on your side before its answer reached you"
      : "which ran longer than a tool call can wait";
    const text = [
      `ANSWER to your ${call.tool} call, ${why}.`,
      "",
      reply.ok ? reply.text : `It was refused: ${reply.text}`,
    ].join("\n");
    return mail(
      "later",
      [hash(call.agent, call.tool, String(call.started))],
      text,
      reply.ok
        ? "Go on from this answer as if the call had just returned it."
        : "Read why it was refused before you call it again.",
    );
  },

  unanswered(call: Waited): Letter {
    return mail(
      "unanswered",
      [hash(call.agent, call.tool, String(call.started))],
      `NO ANSWER to your ${call.tool} call: the desk stopped before it finished, so the answer it said would come as mail will not.`,
      `Call ${call.tool} again if it still needs doing.`,
    );
  },
};

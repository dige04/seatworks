import { z } from "zod";
import { answerAsk } from "../messaging/asks.ts";
import { str } from "../context.ts";
import { defineTool } from "../services.ts";

export const answer = defineTool({
  name: "answer",
  speaks: true,
  input: z.strictObject({ ask: z.string(), text: z.string(), why: z.string().optional() }),
  handle: (desk, caller, args) =>
    answerAsk(desk, caller, { ask: str(args.ask), text: str(args.text), why: str(args.why) }),
});

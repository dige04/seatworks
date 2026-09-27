import { z } from "zod";
import { VERDICTS } from "../../domain/ask.ts";
import { answerAsk } from "../messaging/asks.ts";
import { str } from "../context.ts";
import { defineTool } from "../services.ts";

export const answer = defineTool({
  name: "answer",
  speaks: true,
  input: z.strictObject({
    ask: z.string(),
    text: z.string(),
    why: z.string().optional(),
    verdict: z.enum(VERDICTS).optional(),
  }),
  handle: (desk, caller, args) =>
    answerAsk(desk, caller, { ask: str(args.ask), text: str(args.text), why: str(args.why), verdict: args.verdict }),
});

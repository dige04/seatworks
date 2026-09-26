import { z } from "zod";
import { withdrawQuestion as withdraw } from "../human/questions.ts";
import { defineTool } from "../services.ts";

/** Takes a question off the Human's queue, with why, which they read on the Report. */
export const withdrawQuestion = defineTool({
  name: "withdraw_question",
  input: z.strictObject({ question: z.string(), why: z.string() }),
  handle: async (desk, caller, args) => withdraw(desk, caller, args),
});

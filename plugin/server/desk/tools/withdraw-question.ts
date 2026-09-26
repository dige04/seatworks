import { z } from "zod";
import { withdrawQuestion as withdraw } from "../human/questions.ts";
import { defineTool } from "../services.ts";

export const withdrawQuestion = defineTool({
  name: "withdraw_question",
  input: z.strictObject({ question: z.string(), why: z.string() }),
  handle: async (desk, caller, args) => withdraw(desk, caller, args),
});

import { z } from "zod";
import { recordHumanAnswer as record } from "../human/questions.ts";
import { defineTool } from "../services.ts";

export const recordHumanAnswer = defineTool({
  name: "record_human_answer",
  input: z.strictObject({ question: z.string(), choice: z.string(), quote: z.string(), text: z.string().optional() }),
  handle: (desk, caller, args) => record(desk, caller, args),
});

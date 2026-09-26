import { z } from "zod";
import { defineTool } from "../services.ts";
import { reseatTask } from "../tasks/reseat.ts";

export const reseat = defineTool({
  name: "reseat",
  input: z.strictObject({ task: z.string(), why: z.string() }),
  handle: (desk, caller, args) => reseatTask(desk, caller, args),
});

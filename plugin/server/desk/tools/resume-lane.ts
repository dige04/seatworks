import { z } from "zod";
import { str } from "../context.ts";
import { resumeLane as resume } from "../lanes/hold.ts";
import { defineTool } from "../services.ts";

export const resumeLane = defineTool({
  name: "resume_lane",
  input: z.strictObject({ lane: z.string(), note: z.string().optional() }),
  handle: (desk, caller, args) => resume(desk, caller, args.lane, str(args.note)),
});

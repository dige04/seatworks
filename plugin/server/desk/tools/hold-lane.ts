import { z } from "zod";
import { str } from "../context.ts";
import { holdLane as hold } from "../lanes/hold.ts";
import { defineTool } from "../services.ts";

export const holdLane = defineTool({
  name: "hold_lane",
  input: z.strictObject({ lane: z.string(), reason: z.string() }),
  handle: (desk, caller, args) => hold(desk, caller, str(args.lane), str(args.reason)),
});

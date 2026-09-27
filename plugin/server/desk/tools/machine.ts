import { z } from "zod";
import { machineCall } from "../machine/machine.ts";
import { str } from "../context.ts";
import { defineTool } from "../services.ts";

export const machine = defineTool({
  name: "machine",
  input: z.strictObject({ hold: z.number().optional(), why: z.string().optional() }),
  handle: (desk, caller, args) => machineCall(desk, caller, { hold: args.hold, why: str(args.why) }),
});

import { z } from "zod";
import { amendLane as amend } from "../lanes/amend-lane.ts";
import { defineTool } from "../services.ts";

export const amendLane = defineTool({
  name: "amend_lane",
  input: z.strictObject({
    lane: z.string(),
    why: z.string(),
    outcome: z.string().optional(),
    acceptance: z.array(z.string()).optional(),
    outOfScope: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    choices: z.array(z.string()).optional(),
    unknowns: z.array(z.string()).optional(),
    writeSet: z.array(z.string()).optional(),
    contracts: z.array(z.string()).optional(),
  }),
  handle: (desk, caller, args) => amend(desk, caller, args),
});

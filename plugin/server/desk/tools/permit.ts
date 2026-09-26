import { z } from "zod";
import { permit as answer } from "../messaging/permit.ts";
import { defineTool } from "../services.ts";

/** Answers a Lead's or Peer's permission for the Human while they are out of the loop. */
export const permit = defineTool({
  name: "permit",
  input: z.strictObject({ from: z.string(), request: z.string(), allow: z.boolean(), why: z.string() }),
  handle: (desk, caller, args) => answer(desk, caller, args),
});

import { z } from "zod";
import { permit as answer } from "../human/permit.ts";
import { defineTool } from "../services.ts";

export const permit = defineTool({
  name: "permit",
  input: z.strictObject({ from: z.string(), request: z.string(), allow: z.boolean(), why: z.string() }),
  handle: (desk, caller, args) => answer(desk, caller, args),
});

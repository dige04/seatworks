import { z } from "zod";
import { pushBase } from "../project/push.ts";
import { defineTool } from "../services.ts";

export const push = defineTool({
  name: "push",
  input: z.strictObject({ tag: z.string().optional(), message: z.string().optional() }),
  handle: (desk, caller, args) => pushBase(desk, caller, args),
});

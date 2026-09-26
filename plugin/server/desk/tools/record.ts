import { z } from "zod";
import { defineTool } from "../services.ts";
import { readRecord } from "../views/record.ts";

export const record = defineTool({
  name: "record",
  input: z.strictObject({ of: z.string(), limit: z.number().int().min(1).max(200).optional() }),
  handle: (desk, caller, args) => readRecord(desk, caller, args),
});

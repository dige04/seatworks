import { z } from "zod";
import { defineTool } from "../services.ts";
import { addTasks as add } from "../tasks/add-tasks.ts";

const Asked = z.strictObject({
  key: z.string(),
  title: z.string().max(60),
  goal: z.string(),
  acceptance: z.array(z.string()),
  hints: z.array(z.string()).optional(),
  holds: z.array(z.string()).optional(),
  outOfScope: z.array(z.string()).optional(),
  context: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  choices: z.array(z.string()).optional(),
  unknowns: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  parallel: z.boolean().optional(),
  after: z.array(z.string()).optional(),
  role: z.string().optional(),
});

export const addTasks = defineTool({
  name: "add_tasks",
  input: z.strictObject({ tasks: z.array(Asked) }),
  handle: (desk, caller, args) => add(desk, caller, args.tasks),
});

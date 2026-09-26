import { z } from "zod";

export const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const RoleChoice = z.strictObject({
  harness: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinking: z.string().min(1).optional(),
  rules: z.string().optional(),
});

export const Connect = z.strictObject({
  type: z.enum(["stdio", "http", "sse"]),
  command: z.array(z.string().min(1)).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const McpChoice = z.strictObject({
  enabled: z.boolean().optional(),
  removed: z.boolean().optional(),
  label: z.string().min(1).optional(),
  connect: Connect.optional(),
  roles: z.array(z.string()).optional(),
  tools: z.record(z.string(), z.array(z.string())).optional(),
  rule: z.string().optional(),
  settings: z.record(z.string(), Scalar).optional(),
});

export type Scalar = z.infer<typeof Scalar>;
export type RoleChoice = z.infer<typeof RoleChoice>;
export type Connect = z.infer<typeof Connect>;
export type McpChoice = z.infer<typeof McpChoice>;

/** A pattern handed to `new RegExp` later, inside a try that reads a failure as "not reachable", so a typo must be caught here. */
export const Pattern = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        new RegExp(value, "i");
        return true;
      } catch {
        return false;
      }
    },
    { error: "is not a pattern this machine can read" },
  );

export const AttentionChoice = z.strictObject({
  tickSeconds: z.number().int().min(5).optional(),
  leadIdleMinutes: z.number().int().min(1).optional(),
  askRemindMinutes: z.number().int().min(1).optional(),
  maxReminders: z.number().int().min(0).optional(),
  /** Each attention signal the watch raises, told to whoever supervises (on) or only recorded (shadow, the default). */
  signals: z.record(z.string(), z.enum(["shadow", "on"])).optional(),
  destructive: Pattern.optional(),
  testPath: Pattern.optional(),
  repeatsAt: z.number().int().min(2).optional(),
  /** Steps after a failed command with neither it nor the gate passing, before the watch calls it no recovery. */
  recoverWithin: z.number().int().min(2).optional(),
  reworksAt: z.number().int().min(2).optional(),
  reviewsAt: z.number().int().min(2).optional(),
  suppressed: Pattern.optional(),
  longTurnMinutes: z.number().int().min(1).optional(),
  /** How often the watch's eye reads a running seat's new words; it also reads at every turn's end. */
  lookMinutes: z.number().int().min(1).optional(),
  incidentsPerLane: z.number().int().min(0).optional(),
  /** Which brains read what the watch's eye sees: none, the sensor, the Watcher seat, or both (the sensor sifts, the seat judges). */
  brain: z.enum(["off", "sensor", "seat", "both"]).optional(),
  /** The sensor the brain uses, by its id in the kit's catalog. */
  sensor: z.string().min(1).optional(),
});

/** Off, only the concept is the Human's; on, questions may queue for them, at most `questionsPerDay` across this machine. */
export const HitlChoice = z.strictObject({
  on: z.boolean().optional(),
  questionsPerDay: z.number().int().min(0).optional(),
});

/** A sensor's key buys paid calls, so it is kept on this machine only and the screen never reads it back: it sees KEPT. */
const SensorChoice = z.strictObject({ key: z.string().min(1).optional() });

export const KEPT = "kept, not shown";

const FlowChoice = z.strictObject({
  live: z.boolean().optional(),
  everySeconds: z.number().int().min(2).max(120).optional(),
});

/** One shape for both layers: the machine's, and a project's over it. */
export const LayerSchema = z.strictObject({
  roles: z.record(z.string(), RoleChoice).optional(),
  mcp: z.record(z.string(), McpChoice).optional(),
  rules: z.string().optional(),
  flow: FlowChoice.optional(),
  attention: AttentionChoice.optional(),
  hitl: HitlChoice.optional(),
  sensor: z.record(z.string(), SensorChoice).optional(),
  /** The language whoever supervises speaks to the Human in; the rest of the team writes English, which the watch reads. */
  language: z.string().min(1).optional(),
});

export type Layer = z.infer<typeof LayerSchema>;
export type AttentionChoice = z.infer<typeof AttentionChoice>;
export type HitlChoice = z.infer<typeof HitlChoice>;

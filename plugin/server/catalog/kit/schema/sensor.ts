import { z } from "zod";
import { Json, text } from "./fields.ts";

/** A model the watch may ask over HTTP; `key` names the secret it takes, which the machine settings keep. */
export const SensorFile = z.strictObject({
  id: text,
  label: text,
  key: text,
  url: z.url({ protocol: /^https$/, error: "is not an https address" }),
  model: text,
  terms: text,
  body: Json.optional(),
  timeoutSeconds: z.number().min(1).max(30),
  retries: z.number().int().min(0).max(3),
});

/** A field the code fills is null in `instructions` until the moment it is asked at fills it; `question` is the question itself. */
const Instructions = z.union([
  text,
  z
    .record(z.string(), text.nullable())
    .refine((fields) => typeof fields.question === "string", { error: "names no question" }),
]);

const Mode = z.enum(["off", "shadow"]);
const unit = z.number().min(0).max(1);

/** The facts the code raises at a turn's end that open a question about that turn. */
const Facts = z.array(text).min(1).optional();

/**
 * One condition, answered yes or no: at or above `yes` it holds, at or below `no` it does not, and between is unclear. A question
 * about an act names in `acts` each fact that opens it and the act as it asks it, the fact's own words where `{quote}` is.
 */
const Noul = z
  .strictObject({
    type: z.literal("noul"),
    instructions: Instructions,
    criteria: z.strictObject({ true: text, false: text }),
    acts: z.record(z.string(), text.includes("{quote}")).optional(),
    facts: Facts,
    mode: Mode,
    yes: unit,
    no: unit,
  })
  .refine((check) => check.no < check.yes, { error: "no must sit below yes" });

/** One of several answers, taken at `sure` or more and unclear below; `after` names who an instruction must come from for it to be asked. */
const Choice = z
  .strictObject({
    type: z.literal("choice"),
    instructions: Instructions,
    criteria: z.record(z.string(), text),
    facts: Facts,
    mode: Mode,
    sure: unit,
    after: z.array(text).optional(),
  })
  .refine((check) => Object.keys(check.criteria).length >= 2, { error: "a choice needs two criteria or more" });

/** `catalog/checks.json`: the questions the watch asks a sensor, by name. */
export const ChecksFile = z.record(
  z.string().regex(/^[a-z][a-z_]*$/, { error: "is not a lowercase name" }),
  z.discriminatedUnion("type", [Noul, Choice]),
);

/**
 * One thing the watch's brains read a seat's own words for: the capabilities of the seats it watches, which of their items
 * it reads, the sensor's one-condition question on an item's `text` (none when only the seat can judge it), the seat's
 * question on the whole look, what each answer means, the signs the look must hold for a yes to count, its thresholds,
 * whether a yes asks attention or is only kept, a note, and what it asks of whoever supervises beyond the plain next step.
 */
const Pattern = z
  .strictObject({
    title: text,
    source: text,
    watches: z.array(text).min(1),
    reads: z.array(z.enum(["thought", "said", "brief"])).min(1),
    instructions: text.includes("`text`").optional(),
    seat: text,
    criteria: z.strictObject({ true: text, false: text }),
    gate: z.array(z.enum(["stuck", "reworked", "handed-back", "edit-before-look"])).optional(),
    level: z.enum(["attend", "note"]).optional(),
    next: text.optional(),
    yes: unit,
    no: unit,
  })
  .refine((pattern) => pattern.no < pattern.yes, { error: "has no that is not below yes" });

/** `catalog/patterns.json`: the patterns the watch's brains read for, each by its id, which is also its signal's. */
export const PatternsFile = z.record(z.string().regex(/^[a-z][a-z-]*$/), Pattern);

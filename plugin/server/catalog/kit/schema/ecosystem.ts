import { z } from "zod";
import { pattern, text, texts } from "./fields.ts";

const Gate = z.strictObject({
  files: z.array(text).min(1),
  script: text.optional(),
  run: text,
  lockfiles: z.record(z.string(), text).optional(),
});

/** `reviewQuestion` goes to every review of a change under `paths`, and `rehearse`, a project command, runs with the lane gate. It never holds a landing. */
export const RiskRule = z.strictObject({
  paths: z.array(text).min(1),
  invariant: text,
  reviewQuestion: text,
  rehearse: text.optional(),
});

export type RiskRule = z.infer<typeof RiskRule>;

/** `catalog/ecosystem.json`: the project gates, risk rules and file patterns the desk and the watch read calls with. */
export const EcosystemFile = z.strictObject({
  serialOnly: texts,
  riskRules: z.array(RiskRule),
  gates: z.array(Gate),
  scriptRunners: texts,
  unsetScript: text,
  files: z.strictObject({ test: pattern, docs: pattern }),
  /** How a lane's issue is read: the first form whose `match` takes the reference runs, and prints title, url and body as JSON. */
  issues: z.array(z.strictObject({ match: pattern, run: z.array(text).min(1) })),
  watch: z.strictObject({
    destructive: pattern,
    testPath: pattern,
    suppressed: pattern,
    skipped: pattern,
    assertion: pattern,
    refused: pattern,
    runners: texts,
    /** A review told to report only what it is sure of. */
    certainty: pattern,
    /** A brief that writes the answer out: code in a fence, or numbered build steps that name files or follow on. */
    prewritten: z.strictObject({ code: pattern, step: pattern, then: pattern, fileMember: pattern }),
  }),
});

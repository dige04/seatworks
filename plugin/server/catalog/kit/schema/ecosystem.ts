import { z } from "zod";
import { text, texts } from "./fields.ts";
import { Pattern } from "../../../../shared/settings.ts";

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
  /** Programs that start another by its name, such as npx: a command a seat may not start is refused through each. */
  launchers: texts,
  unsetScript: text,
  files: z.strictObject({ test: Pattern, docs: Pattern }),
  /** How a lane's issue is read: the first form whose `match` takes the reference runs, and prints title, url and body as JSON. */
  issues: z.array(z.strictObject({ match: Pattern, run: z.array(text).min(1) })),
  watch: z.strictObject({
    destructive: Pattern,
    testPath: Pattern,
    suppressed: Pattern,
    skipped: Pattern,
    assertion: Pattern,
    refused: Pattern,
    runners: texts,
    /** A review told to report only what it is sure of. */
    certainty: Pattern,
    /** A brief that writes the answer out: code in a fence, or numbered build steps that name files or follow on. */
    prewritten: z.strictObject({ code: Pattern, step: Pattern, then: Pattern, fileMember: Pattern }),
  }),
});

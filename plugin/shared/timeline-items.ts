/**
 * The rows Seatworks puts in the Supervisor's chat with `timeline.append`, one schema per kind, drawn by the client.
 * A row's id is its subject's, `<project>:<question id>` or `<project>:<lane id>`, so appending it again with
 * `settled` set turns the card into its one-line outcome in place; a report is appended again under its project's id.
 */
import { z } from "zod";
import { FlowLane, FlowQuestion } from "./flow-views.ts";
import { ReportView } from "./views.ts";

/** How a decision ended, in the desk's words: answered, declined, withdrawn, approved or sent back. */
const Settled = z.object({ text: z.string(), minutes: z.number() }).nullable();

const HeldLane = FlowLane.pick({ id: true, title: true, base: true, branch: true }).extend({
  landApproval: FlowLane.shape.landApproval.unwrap(),
});

export const TIMELINE = {
  question: {
    kind: "question",
    version: 1,
    schema: z.object({ project: z.string(), question: FlowQuestion, settled: Settled, decider: z.string().optional() }),
  },
  landing: {
    kind: "landing",
    version: 1,
    schema: z.object({ project: z.string(), lane: HeldLane, settled: Settled, decider: z.string().optional() }),
  },
  report: {
    kind: "report",
    version: 1,
    schema: z.object({ project: z.string(), report: ReportView }),
  },
} as const;

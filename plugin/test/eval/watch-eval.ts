// npm run eval:watch -- [--sensor] [--seat "claude -p --model <watcher model>"] [--pattern <id>] [--jobs 4]
// Not part of npm test: every case costs a model call. --sensor asks the sensor this machine's settings name (its key
// is read from those settings and never printed), each case one question as the watch asks it; --seat gives the
// Watcher's prompt and a CASE letter to the command named, the way the Watcher model would be run, and reads one JSON
// object of answers from what it prints. Cases are test/fixtures/watch-eval/patterns.json; the code-fact cases are
// unit-tested in test/runtime/watch-eval.test.ts. It prints precision and recall per pattern for each brain asked.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decisionsJudge } from "../../server/adapters/decisions.ts";
import { type PatternSpec, loadKit } from "../../server/catalog/kit/kit.ts";
import { stateRoot } from "../../server/core/paths.ts";
import type { Answer, Question } from "../../server/core/ports.ts";
import { caseLetters } from "../../server/desk/letters/case-letters.ts";
import { holds } from "../../server/desk/store/assessments.ts";
import { TeamSource } from "../../server/runtime/team-source.ts";
import { type PatternCase, patternCases } from "./cases.ts";

const { values } = parseArgs({
  options: {
    sensor: { type: "boolean", default: false },
    seat: { type: "string" },
    pattern: { type: "string" },
    jobs: { type: "string", default: "4" },
    timeout: { type: "string", default: "180" },
  },
});
if (!values.sensor && !values.seat) {
  console.error('Name a brain to ask: --sensor, --seat "claude -p --model <model>", or both.');
  process.exit(2);
}

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const kit = loadKit(plugin, stateRoot());
const cases = patternCases().filter((one) => !values.pattern || one.pattern === values.pattern);
const watcher = readFileSync(join(plugin, "content", "prompts", "WATCHER.md"), "utf-8");

const question = (pattern: PatternSpec, words: string, rule?: string): Question => ({
  type: "condition",
  instructions: rule === undefined ? words : { question: words, rule },
  criteria: pattern.criteria,
});

type Brain = (one: PatternCase, pattern: PatternSpec) => Promise<Answer | undefined>;

function sensorBrain(): Brain {
  const sensor = new TeamSource(kit).teamFor().brains.sensor;
  if (!sensor?.key) {
    console.error("The machine's settings name no sensor with a key: set one on the Team tab first.");
    process.exit(2);
  }
  const judge = decisionsJudge(sensor.sensor, sensor.key);
  return async (one, pattern) => {
    const asked = { [one.pattern]: question(pattern, pattern.instructions, one.rule) };
    const judged = await judge.ask({ text: one.text }, asked).catch((error: unknown) => {
      console.error(`${one.pattern}: the sensor did not answer: ${String(error)}`);
      return undefined;
    });
    return judged?.answers[one.pattern];
  };
}

function seatBrain(command: string): Brain {
  const [program, ...args] = command.split(/\s+/).filter(Boolean);
  const run = (prompt: string) =>
    new Promise<string>((resolve) => {
      const child = spawn(program!, [...args, prompt], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      const timer = setTimeout(() => child.kill(), Number(values.timeout) * 1000);
      child.on("close", () => (clearTimeout(timer), resolve(out)));
      child.on("error", () => (clearTimeout(timer), resolve(out)));
    });
  return async (one, pattern) => {
    const letter = caseLetters.case(
      "C1",
      "the eval",
      { items: [`[${one.item}] ${one.text}`] },
      {
        [one.pattern]: question(pattern, pattern.seat, one.rule),
      },
    );
    const said = await run(
      `${watcher}\n\n${letter.text}\n\nThere is no judge tool here: answer with one JSON object mapping each question's name to yes, no or unsure, and nothing else.`,
    );
    const found = /\{[^{}]*\}/.exec(said)?.[0];
    const says = found ? (JSON.parse(found) as Record<string, string>)[one.pattern]?.toLowerCase() : undefined;
    return says === undefined ? undefined : { likely: says === "yes" ? 1 : says === "no" ? 0 : 0.5 };
  };
}

async function measure(name: string, brain: Brain): Promise<void> {
  const answers = new Map<PatternCase, Answer | undefined>();
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: Number(values.jobs) }, async () => {
      for (let one = queue.shift(); one; one = queue.shift())
        answers.set(one, await brain(one, kit.patterns[one.pattern]!));
    }),
  );
  console.log(`\n${name}: pattern, precision, recall (true positives, false positives, missed, unanswered)`);
  for (const id of [...new Set(cases.map((one) => one.pattern))]) {
    const pattern = kit.patterns[id]!;
    const mine = cases.filter((one) => one.pattern === id);
    const said = mine.map((one) => ({ one, yes: holds(pattern, answers.get(one)) === "yes", none: !answers.get(one) }));
    const tp = said.filter((entry) => entry.yes && entry.one.expect).length;
    const fp = said.filter((entry) => entry.yes && !entry.one.expect).length;
    const fn = said.filter((entry) => !entry.yes && entry.one.expect).length;
    const ratio = (part: number, whole: number) => (whole === 0 ? "  -  " : (part / whole).toFixed(2));
    const unanswered = said.filter((entry) => entry.none).length;
    console.log(`${id.padEnd(24)} ${ratio(tp, tp + fp)}  ${ratio(tp, tp + fn)}  (${tp}, ${fp}, ${fn}, ${unanswered})`);
  }
}

if (values.sensor) await measure("sensor", sensorBrain());
if (values.seat) await measure("seat", seatBrain(values.seat));

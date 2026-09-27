import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { skillSources } from "../../server/catalog/kit/content.ts";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { hiddenWordsIn } from "../../server/catalog/kit/hidden-words.ts";
import { RECORDS } from "../../server/core/paths.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const kit = loadKit(PLUGIN);

const ACRONYMS = new Set(["API", "CLI", "JSON", "SQL", "URL", "HTTP"]);

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const files = (dir: string, ending: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name), ending)
          : entry.name.endsWith(ending)
            ? [join(dir, entry.name)]
            : [],
      )
    : [];
const skills = readdirSync(join(PLUGIN, "content", "skills")).flatMap((set) =>
  readdirSync(join(PLUGIN, "content", "skills", set)).map((name) => ({
    name,
    dir: join(PLUGIN, "content", "skills", set, name),
  })),
);
const deltas = files(join(PLUGIN, "harness"), ".md").filter((file) => file.includes("/delta/"));
type Schema = { description?: string; properties?: Record<string, Schema>; items?: Schema };
type Hints = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
type Tool = { name: string; title?: string; description?: string; annotations?: Hints; inputSchema?: Schema };
const tools = JSON.parse(readFileSync(join(PLUGIN, "mcp", "tools.json"), "utf-8")) as Record<string, Tool[]>;
/** Every parameter a schema names, with its description: the fields of a list's items too, which a seat reads as closely. */
const params = (schema: Schema | undefined, prefix = ""): [string, string][] =>
  Object.entries(schema?.properties ?? {}).flatMap(([name, field]) => [
    [`${prefix}${name}`, field.description ?? ""] as [string, string],
    ...params(field.items, `${prefix}${name}.`),
  ]);
const deskTools = new Set(Object.values(tools).flatMap((set) => set.map((tool) => tool.name)));

test("every agent reads the Seatworks block without a word hidden from it, each skill says when it is for and when not, and tools keep within what harnesses take", () => {
  const block = readFileSync(join(PLUGIN, "content", "project", "AGENTS.md"), "utf-8");
  for (const role of kit.roles)
    assert.deepEqual(
      hiddenWordsIn(block, role.hidesWords ?? []),
      [],
      `every agent in the project reads its Seatworks block, the ${role.role} included`,
    );
  for (const { name, dir } of skills) {
    const [, head = ""] = readFileSync(join(dir, "SKILL.md"), "utf-8").match(/^---\n([\s\S]*?)\n---\n/) ?? [];
    const description = head.match(/^description:\s*"?(.*?)"?$/m)?.[1] ?? "";
    assert.ok(
      description.length <= 1024 && /Use when/.test(description) && /not for/i.test(description),
      `skill ${name}'s description: ${description.length} characters, over the 1,024 agents list, or it lacks "Use when" and "not for"`,
    );
  }
  assert.deepEqual(
    params({ properties: { tasks: { items: { properties: { key: { description: "k" } } } } } }),
    [
      ["tasks", ""],
      ["tasks.key", "k"],
    ],
    "the fields of a list's items are counted too",
  );
  for (const [set, list] of Object.entries(tools)) {
    for (const tool of list) {
      assert.ok(words(tool.description ?? "") <= 60, `${set} ${tool.name}: ${words(tool.description ?? "")} words`);
      for (const [param, description] of params(tool.inputSchema))
        assert.ok(words(description) <= 25, `${set} ${tool.name}.${param}: ${words(description)} words`);
    }
  }
});

test("every tool has a title, says what it changes and describes each field within what harnesses take, and each set's server says what it is for", () => {
  const told = JSON.parse(readFileSync(join(PLUGIN, "mcp", "instructions.json"), "utf-8")) as Record<string, string>;
  for (const [set, list] of Object.entries(tools)) {
    assert.ok(told[set] && told[set].length <= 300, `${set}: its server says what it is for, in 300 characters`);
    for (const tool of list) {
      assert.match(tool.name, /^[a-z_]{1,64}$/);
      assert.ok(tool.title, `${set} ${tool.name} has no title`);
      const hints = tool.annotations ?? {};
      assert.deepEqual(
        [typeof hints.readOnlyHint, typeof hints.openWorldHint],
        ["boolean", "boolean"],
        `${set} ${tool.name} says whether it writes and whether it reaches outside`,
      );
      const writing = hints.readOnlyHint ? ["undefined", "undefined"] : ["boolean", "boolean"];
      assert.deepEqual(
        [typeof hints.destructiveHint, typeof hints.idempotentHint],
        writing,
        `${set} ${tool.name}: whether a call destroys or repeats safely means something only for a tool that writes`,
      );
      assert.ok(
        JSON.stringify(tool.inputSchema).length < 5000 && (tool.description ?? "").length < 2048,
        `${set} ${tool.name} is too large for a harness: Codex refuses a schema over 5,000 bytes and Claude cuts a description at 2,048 characters`,
      );
      for (const [param, description] of params(tool.inputSchema))
        assert.ok(description, `${set} ${tool.name}.${param} says nothing of what it takes`);
    }
  }
});

test("seat text shouts nothing, never says mail waits for a running turn to end, and never makes one task a lane's norm", () => {
  const texts = [...files(join(PLUGIN, "content"), ".md"), ...deltas].map(
    (file) => [file, readFileSync(file, "utf-8")] as const,
  );
  texts.push([
    "mcp/tools.json",
    Object.values(tools)
      .flat()
      .map((tool) => tool.description ?? "")
      .join("\n"),
  ]);
  for (const [file, text] of texts) {
    assert.deepEqual(text.match(/\b(IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS|DO NOT)\b/g), null, `${file} shouts`);
    assert.deepEqual(
      text.match(/between (your|its|their) turns|never interrupt|if in doubt/gi),
      null,
      `${file}: mail steers into a running turn on the agents that take that, and a text saying otherwise was believed`,
    );
    assert.deepEqual(
      text.match(/usually (just )?one task|one task (per|to a|for the whole) lane/gi),
      null,
      `${file} makes one task a lane's norm, which put whole lanes into one beside the Lead's rule`,
    );
  }
});

test("seat text names only what that seat can reach and what exists: its own tools, the Paseo tools its policy allows, the skills it is given, files, guides and letters", () => {
  const everySkill = new Set(skills.map(({ name }) => name));
  for (const role of kit.roles) {
    const own = new Set((tools[role.tools ?? ""] ?? []).map((tool) => tool.name));
    const given = new Set(skillSources(kit, role).keys());
    const allowed = role.paseoTools?.allow;
    const texts = [
      [role.prompt, readFileSync(join(PLUGIN, "content", role.prompt), "utf-8")],
      ...[...skillSources(kit, role).values()].map((dir) => [dir, readFileSync(join(dir, "SKILL.md"), "utf-8")]),
      ...deltas.filter((file) => file.endsWith(`/${role.role}.md`)).map((file) => [file, readFileSync(file, "utf-8")]),
    ] as const;
    for (const [where, text] of texts) {
      for (const [, name] of text.matchAll(/`([a-z][a-z_-]{2,})`/g)) {
        if (kit.paseoTools.includes(name!))
          assert.ok(
            allowed ? allowed.includes(name!) : role.paseoTools?.enabled !== false,
            `${where} tells the ${role.role} to use the Paseo tool ${name}, which its policy denies it`,
          );
        else if (deskTools.has(name!))
          assert.ok(own.has(name!), `${where} tells the ${role.role} to call ${name}, which is not in its tool set`);
        if (everySkill.has(name!))
          assert.ok(
            given.has(name!),
            `${where} tells the ${role.role} to open the skill ${name}, which it is not given`,
          );
      }
    }
  }
  for (const { dir } of skills) {
    for (const file of files(dir, ".md")) {
      const text = readFileSync(file, "utf-8");
      for (const [, link] of text.matchAll(/\]\((references\/[^)#]+)\)/g))
        assert.ok(existsSync(join(dir, link!)), `${file} links ${link}, which is not there`);
      for (const [, path] of text.matchAll(/\$SEATWORKS_KIT\/([\w./-]+[\w-])/g))
        assert.ok(existsSync(join(PLUGIN, path!)), `${file} names $SEATWORKS_KIT/${path}, which is not there`);
    }
  }
  const letters = new Set<string>();
  for (const file of readdirSync(join(PLUGIN, "server", "desk", "letters")))
    for (const match of readFileSync(join(PLUGIN, "server", "desk", "letters", file), "utf-8").matchAll(
      /[`"]([A-Z]{2,}(?: [A-Z]{2,})*)(?=[ :]|\$|`|")/g,
    ))
      letters.add(match[1]!);
  for (const role of kit.roles) {
    const text = readFileSync(join(PLUGIN, "content", role.prompt), "utf-8");
    for (const [, guide] of text.matchAll(/\{\{guides\}\}\/([\w.-]+)/g))
      assert.ok(
        existsSync(join(PLUGIN, "content", "guides", guide!)),
        `${role.role} names the guide ${guide}, which is not there`,
      );
    for (const [, heading] of text.matchAll(/(?<![$\w])([A-Z]{3,}(?: [A-Z]{3,})*)(?![\w.])/g)) {
      if (!ACRONYMS.has(heading!))
        assert.ok(
          letters.has(heading!),
          `${role.role}'s prompt names ${heading}, a word in capitals that is no acronym, file or variable, so a letter the desk does not send`,
        );
    }
  }
});

test("seat text names only logs the desk keeps, and every notebook section it sends a line to is in the page the desk seeds", () => {
  const texts = files(join(PLUGIN, "content"), ".md").map((file) => [file, readFileSync(file, "utf-8")] as const);
  const kept = new Set(RECORDS.map((name) => `${name}.log`));
  const seeded = readFileSync(join(PLUGIN, "content", "records", "notebook.md"), "utf-8");
  for (const [file, text] of texts) {
    for (const [, log] of text.matchAll(/(?:\$SEATWORKS_STATE|\{\{state\}\})\/([\w-]+\.log)\b/g))
      assert.ok(kept.has(log!), `${file} sends a seat to ${log}, which the desk never writes`);
    for (const [, section] of text.matchAll(/\bunder\s+([A-Z][a-z]+(?:\s+[A-Za-z]+)*?)\s+in\s+the\s+notebook\b/g))
      assert.match(
        seeded,
        new RegExp(`^## ${section}$`, "m"),
        `${file} keeps lines under ${section} in the notebook, which the seeded page has no section for`,
      );
  }
});

test("the severities the Lead and the reviewers name are the review tool's own, and what a Peer or reviewer reads never sends it to the concept file its copy lacks", () => {
  const done = tools.reviewer!.find((tool) => tool.name === "done")!;
  const severity = (done.inputSchema?.properties?.findings?.items?.properties?.severity ?? {}) as Schema & {
    enum?: string[];
  };
  const levels = new Set(severity.enum ?? []);
  assert.ok(levels.size > 0, "the review tool rates findings");
  for (const role of kit.roles.filter((entry) => entry.role === "lead" || entry.prompt === "prompts/REVIEWER.md")) {
    const text = readFileSync(join(PLUGIN, "content", role.prompt), "utf-8");
    const named = new Set([...text.matchAll(/\bP\d\b/g)].map(([level]) => level));
    assert.deepEqual(
      [...named].filter((level) => !levels.has(level)),
      [],
      `${role.role}: a severity the review tool does not take is one no finding can carry`,
    );
    assert.deepEqual(
      [...levels].filter((level) => !named.has(level)),
      [],
      `${role.role}: every severity a finding can carry says what it means for the lane`,
    );
  }
  for (const role of kit.roles.filter((entry) => entry.hidesWords?.includes("supervisor"))) {
    const texts = [
      [role.prompt, readFileSync(join(PLUGIN, "content", role.prompt), "utf-8")],
      ...[...skillSources(kit, role).values()].map((dir) => [dir, readFileSync(join(dir, "SKILL.md"), "utf-8")]),
    ] as const;
    for (const [where, text] of texts)
      assert.doesNotMatch(
        text,
        /CONTEXT\.md/,
        `${where} names the concept file, which is not in the ${role.role}'s copy: it reads the concept as its brief quotes it`,
      );
  }
});

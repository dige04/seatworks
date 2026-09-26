import { execFile } from "node:child_process";

export type Issue = { title: string; url: string; body: string };

/** One way to read an issue: a reference `match`es it, and `run`, given `$1`… for what the match caught, prints it as JSON. */
type IssueForm = { match: string; run: string[] };

function issueCommand(forms: IssueForm[], ref: string): string[] | undefined {
  const text = ref.trim();
  for (const form of forms) {
    const caught = new RegExp(form.match).exec(text);
    if (caught) return form.run.map((arg) => arg.replace(/\$(\d)/g, (_, group: string) => caught[Number(group)] ?? ""));
  }
  return undefined;
}

/** Zero-width, direction and tag characters: text a reader of the issue page never sees, which a model still reads. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu;

/** An issue as its page shows it: an HTML comment, closed or not, and invisible characters say nothing to its reader. */
const unseen = (text: string) => text.replace(/<!--[^]*?(-->|$)/g, "").replace(INVISIBLE, "");

export function fetchIssue(forms: IssueForm[], ref: string, cwd: string): Promise<Issue | { error: string }> {
  const command = issueCommand(forms, ref);
  if (!command) return Promise.resolve({ error: `no issue form in ecosystem.json reads "${ref}"` });
  const [file, ...args] = command as [string, ...string[]];
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: (String(stderr) || error.message).trim().slice(0, 300) });
        return;
      }
      try {
        const value = JSON.parse(String(stdout)) as Partial<Record<keyof Issue, unknown>>;
        const field = (name: keyof Issue) => (typeof value[name] === "string" ? unseen(value[name]) : "");
        resolve({ title: field("title"), url: field("url"), body: field("body") });
      } catch {
        resolve({ error: `${file} printed what is not JSON` });
      }
    });
  });
}

/** The issue `ref` names, read as its form says; none when it cannot be. */
export async function issueOf(forms: IssueForm[], ref: string | undefined, cwd: string): Promise<Issue | undefined> {
  const fetched = ref ? await fetchIssue(forms, ref, cwd) : undefined;
  return fetched && !("error" in fetched) ? fetched : undefined;
}

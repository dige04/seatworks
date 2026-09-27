import type { Counts } from "../../core/git-diff.ts";
import type { Task } from "../../domain/task.ts";
import { type Letter, fyi, mail } from "./envelope.ts";

/** A lane with no work left after a merge: its base, when it lands onto one, and the files where that base conflicts with it. */
export type Settled = { base?: string; conflicts: string[] };

/** What a lane asks of its Lead once its last task merged: its base taken in first where they conflict, then its review. */
function whatIsLeft({ base, conflicts }: Settled): { said: string[]; next: string } {
  const said = ["Every task of the lane is settled."];
  // Its last merge is this one, so no review of the whole lane has read the lane as it now stands.
  const review = "have the whole lane reviewed if it needs it (start_review with scope lane)";
  if (!base || conflicts.length === 0) return { said, next: `If its outcome is met, ${review}, then report it ready.` };
  said.push(
    `${base} conflicts with it in ${conflicts.join(", ")}, so it does not land as it is: a Peer takes ${base} in with git merge --no-edit ${base} on its task's branch and commits what it settles.`,
  );
  return { said, next: `Have a task take ${base} in first; then ${review} and report it ready.` };
}

export const mergeLetters = {
  /**
   * `reach` is what of its files the Lead should weigh; `settled` when no other task of the lane is left to accept, cut
   * or review: only then does a merge with nothing to note ask anything of the Lead, and what it asks is what is left.
   */
  merged(task: Task, counts: Counts | undefined, reach: string[], gate: string, settled?: Settled): Letter {
    const lines = [
      counts?.files.length === 0
        ? `MERGED ${task.id} (${task.title}): it changed no files, so there was nothing to merge.`
        : `MERGED ${task.id} (${task.title}) into the lane branch.`,
      counts
        ? `Lines changed: source ${counts.src}, tests ${counts.test}, docs ${counts.docs}.`
        : "Lines changed: git could not say, so this is the merge without its size.",
      `Gate: ${gate}`,
    ];
    const notes: string[] = [];
    if (counts && counts.src === 0 && counts.test + counts.docs > 0) notes.push("Note: no source lines changed.");
    for (const note of reach) notes.push(`Note: ${note}.`);
    const letter = (next: string, more: string[] = []) =>
      mail("merge", [task.id, Date.now()], [...lines, ...notes, ...more].join("\n"), next);
    if (settled) {
      const { said, next } = whatIsLeft(settled);
      return letter(next, said);
    }
    return notes.length > 0
      ? letter("Act on a note only if it matters to the lane.")
      : fyi(letter("Nothing now: the next hand-back arrives as mail."));
  },

  /**
   * The Lead's accept stands while something keeps the merge from its lane: the task stays queued and merges once that
   * clears; `clears` when clearing it asks for the Lead.
   */
  waits(task: Task, why: string, clears: boolean): Letter {
    const text = `MERGE WAITS ${task.id} (${task.title}): ${why}. It merges by itself once that clears, tried again as each turn ends.`;
    return clears
      ? mail(
          "merge",
          [task.id, Date.now()],
          text,
          "Have what is left there committed or cleared, or cut the task to withdraw it.",
        )
      : fyi(
          mail(
            "merge",
            [task.id, Date.now()],
            text,
            "Nothing now: MERGED arrives as mail, and cut withdraws the task.",
          ),
        );
  },

  /**
   * Its gate failed on its branch with the lane brought in: `run` when this merge ran it, none when its hand-back did.
   */
  red(task: Task, lane: string, note: string, run?: { tail: string; logFile: string }): Letter {
    const lines = [
      `MERGE RED ${task.id} (${task.title}): the gate failed on its branch with ${lane} brought in, the tree the lane would become. The lane branch is unchanged.`,
      `Gate: ${note}`,
    ];
    lines.push(...(run ? ["", run.tail, "", `Full log: ${run.logFile}`] : ["Its hand-back carries the log."]));
    return mail(
      "merge",
      [task.id, Date.now()],
      lines.join("\n"),
      "Send rework to its Peer with what must change, or accept it again with overGate and a reason to merge it over the gate.",
    );
  },

  mergeFailed(task: Task, reason: string, tail: string): Letter {
    const lines = [`MERGE FAILED ${task.id} (${task.title}): ${reason}`, "The lane branch is unchanged."];
    if (tail) lines.push("", "```", tail, "```");
    return mail("merge", [task.id, Date.now()], lines.join("\n"), "Clear what it names, then accept it again.");
  },

  /**
   * `settling` is how bringing the lane branch into the task's own copy went: left with its conflicts, clean, or not
   * begun; `by`, the tasks whose merges wrote the lane's side.
   */
  conflict(
    task: Task,
    conflicts: string[],
    laneBranch: string,
    settling: "left" | "clean" | { not: string },
    by: string[] = [],
  ): Letter {
    const [done, next] =
      settling === "left"
        ? [
            `The desk began merging ${laneBranch} into the task's branch in its own copy and left the conflicts there.`,
            "Send rework asking its Peer to settle them and commit the merge with git commit --no-edit, since an editor would wait forever in its session, then accept it again; or cut the task.",
          ]
        : settling === "clean"
          ? [
              `The desk merged ${laneBranch} into the task's branch in its own copy without conflicts.`,
              "Accept it again.",
            ]
          : [
              `The desk could not begin merging ${laneBranch} into the task's branch in its own copy, because ${settling.not}.`,
              "Send rework asking its Peer to commit what is left there, then accept it again; or cut the task.",
            ];
    const text = [
      `MERGE CONFLICT ${task.id} (${task.title}) with ${laneBranch}.`,
      `Files: ${conflicts.join(", ") || "unknown"}${by.length > 0 ? `, changed there by ${by.join(", ")}` : ""}`,
      `The lane branch is unchanged. ${done}`,
    ].join("\n");
    return mail("merge", [task.id, Date.now()], text, next);
  },
};

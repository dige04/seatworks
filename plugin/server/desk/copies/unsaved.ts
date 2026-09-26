import { pristineState, uncommittedIn } from "../../core/git.ts";

/** What a copy holds that no commit does, as "has work uncommitted (…)"; nothing when all of it is committed. */
export async function unsavedIn(copy: string): Promise<string | undefined> {
  const state = await pristineState(copy);
  if (state === "clean") return undefined;
  return state === "dirty" ? `has work uncommitted (${await uncommittedIn(copy)})` : "could not be read by git";
}

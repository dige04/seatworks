import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stateRoot } from "../core/paths.ts";
import { readJson, writeJson } from "../core/store.ts";
import type { Project } from "../desk/project/project.ts";
import { daemonLog } from "../core/logger.ts";

/** The projects attached on this machine, each on record by the meta.json in its state folder. */
export class ProjectRegistry {
  private readonly recorded = new Set<string>();

  record(project: Project): void {
    // The Set only skips rewrites: a project detached this session leaves it set with no file on disk.
    if (this.recorded.has(project.slug) && existsSync(join(project.state, "meta.json"))) return;
    try {
      mkdirSync(project.state, { recursive: true });
      writeJson(join(project.state, "meta.json"), { root: project.root, slug: project.slug });
      this.recorded.add(project.slug);
    } catch (error) {
      daemonLog.error("could not record the project:", error);
    }
  }

  /** Whether the project is still on record: detached, or its state removed by hand, it is not. */
  onRecord(project: Project): boolean {
    return existsSync(join(project.state, "meta.json"));
  }

  /** A project that is no longer on record: the next attach has to write it again. */
  forget(slug: string): void {
    this.recorded.delete(slug);
  }

  known(): Project[] {
    const root = join(stateRoot(), "projects");
    if (!existsSync(root)) return [];
    const found: Project[] = [];
    for (const slug of readdirSync(root)) {
      const meta = readJson<{ root?: string; slug?: string }>(join(root, slug, "meta.json"), {});
      if (typeof meta.root === "string" && meta.slug === slug)
        found.push({ root: meta.root, slug, state: join(root, slug) });
    }
    return found.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  named(slug: string): Project | undefined {
    return this.known().find((project) => project.slug === slug);
  }
}

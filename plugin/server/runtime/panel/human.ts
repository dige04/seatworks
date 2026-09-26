import { join } from "node:path";
import type { Kit } from "../../catalog/kit/kit.ts";
import { readJson, writeJson } from "../../core/store.ts";
import type { Human } from "../../desk/human/human.ts";
import type { Project } from "../../desk/project/project.ts";
import { ordersView } from "../../desk/views/orders.ts";
import { reportView } from "../../desk/views/report.ts";
import type { LandDecided, OrdersRead, QuestionAnswered, ReportRead, ReportSeen } from "../../../shared/views.ts";
import { unknownProject } from "./projects.ts";
import type { HumanRpc } from "./rpc.ts";
import type { TeamSource } from "../team-source.ts";

type Refused = { error: string };

type HumanDeps = { kit: Kit; source: TeamSource; human: Human };

/** Where the Human last marked the Report read; lost, the next Report only runs over more of the record. */
const seenFile = (project: Project) => join(project.state, "report.json");

function seenAt(project: Project): number | null {
  const seen = readJson<{ seen?: unknown }>(seenFile(project), {}).seen;
  return typeof seen === "number" ? seen : null;
}

/** The Human's side of the panel for one project: what only they may decide, and what they read of it. */
export class HumanPanel implements HumanRpc {
  private readonly deps: HumanDeps;

  constructor(deps: HumanDeps) {
    this.deps = deps;
  }

  private project(slug: string): Project | Refused {
    return this.deps.source.named(slug) ?? { error: unknownProject(slug) };
  }

  /** Their word on a held landing, from the panel, the one place it comes from: landing is already the Supervisor's call. */
  async decideLand(slug: string, lane: string, approve: boolean, note: string): Promise<LandDecided> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const decided = await this.deps.human.decideLand(project, lane, approve, note.trim());
    return decided.ok ? { decided: decided.text } : { error: decided.text };
  }

  async answer(slug: string, question: string, choice: string, note: string): Promise<QuestionAnswered> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const said = await this.deps.human.answer(project, question.trim().toUpperCase(), choice.trim(), note.trim());
    return said.ok ? { answered: said.text } : { error: said.text };
  }

  orders(slug: string): OrdersRead {
    const project = this.project(slug);
    return "error" in project ? project : ordersView(this.deps.kit, project);
  }

  report(slug: string): ReportRead {
    const project = this.project(slug);
    if ("error" in project) return project;
    return reportView(project, this.deps.source.teamFor(project).hitl.questionsPerDay, seenAt(project));
  }

  /** `until` is the end of the page they read, so what came after it stays for the next; a page older than the mark moves nothing. */
  reportSeen(slug: string, until: number): ReportSeen {
    const project = this.project(slug);
    if ("error" in project) return project;
    const seen = Math.max(seenAt(project) ?? 0, Math.min(until, Date.now()));
    writeJson(seenFile(project), { seen });
    return { seen };
  }
}

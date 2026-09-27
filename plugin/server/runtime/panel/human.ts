import type { Kit } from "../../catalog/kit/kit.ts";
import { daemonLog } from "../../core/logger.ts";
import type { Human } from "../../desk/human/human.ts";
import type { Project } from "../../desk/project/project.ts";
import { ordersView } from "../../desk/views/orders.ts";
import type { LandDecided, OrdersRead, QuestionAnswered, ReportSeen } from "../../../shared/views.ts";
import { unknownProject } from "./projects.ts";
import type { HumanRpc } from "./rpc.ts";
import type { ProjectRegistry } from "../project-registry.ts";
import type { ChatCards } from "./chat-cards.ts";
import { markSeen } from "./report-seen.ts";

type Refused = { error: string };

type HumanDeps = {
  kit: Kit;
  registry: Pick<ProjectRegistry, "named">;
  human: Human;
  cards: Pick<ChatCards, "sync">;
};

/** The Human's side of the panel for one project: what only they may decide, and what they read of it. */
export class HumanPanel implements HumanRpc {
  private readonly deps: HumanDeps;

  constructor(deps: HumanDeps) {
    this.deps = deps;
  }

  private project(slug: string): Project | Refused {
    return this.deps.registry.named(slug) ?? { error: unknownProject(slug) };
  }

  /** Their word on a held landing, from the panel, the one place it comes from: landing is already the Supervisor's call. */
  async decideLand(slug: string, lane: string, approve: boolean, note: string): Promise<LandDecided> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const decided = await this.deps.human.decideLand(project, lane, approve, note.trim());
    if (decided.ok) await this.settleCards(project);
    return decided.ok ? { decided: decided.text } : { error: decided.text };
  }

  async answer(slug: string, question: string, choice: string, note: string): Promise<QuestionAnswered> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const said = await this.deps.human.answer(project, question.trim().toUpperCase(), choice.trim(), note.trim());
    if (said.ok) await this.settleCards(project);
    return said.ok ? { answered: said.text } : { error: said.text };
  }

  /** The card they acted on settles at once rather than at the next round; a failure leaves it to that round. */
  private async settleCards(project: Project): Promise<void> {
    await this.deps.cards
      .sync(project)
      .catch((error) => daemonLog.error("the cards in the Supervisor's chat could not be posted:", error));
  }

  orders(slug: string): OrdersRead {
    const project = this.project(slug);
    return "error" in project ? project : ordersView(this.deps.kit, project);
  }

  /** `until` is the end of the page they read, so what came after it stays for the next; a page older than the mark moves nothing. */
  async reportSeen(slug: string, until: number): Promise<ReportSeen> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const seen = markSeen(project, until);
    await this.settleCards(project);
    return { seen };
  }
}

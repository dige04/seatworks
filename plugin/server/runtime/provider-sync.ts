import type { Kit } from "../catalog/kit/kit.ts";
import { type ModelCache, applyModels, fetchModels, listingProviders } from "../catalog/paseo/models.ts";
import { providerPatches } from "../catalog/paseo/providers.ts";
import { daemonLog } from "../core/logger.ts";
import { stateRoot } from "../core/paths.ts";
import type { Models, PaseoConfig, Seats } from "../core/ports.ts";
import type { TeamSource } from "./team-source.ts";

type SyncOptions = {
  kit: Kit;
  models: Models;
  config: PaseoConfig;
  seats: Seats;
  source: TeamSource;
  modelsChanged: () => void;
};

/** Keeps Paseo's providers, and the agents' model lists, in step with the kit and the attached projects' teams. */
export class ProviderSync {
  private asked = false;
  private readonly options: SyncOptions;
  private running: Promise<void> = Promise.resolve();
  private waiting: Promise<void> | undefined;

  constructor(options: SyncOptions) {
    this.options = options;
  }

  /** A panel call is the first sign someone looks at the models, so the first one of a load asks the agents for them. */
  firstLook(): void {
    if (this.asked) return;
    this.asked = true;
    this.refreshModels().catch((error) => daemonLog.error("could not list the agents' models:", error));
  }

  /** Asked once per load and on demand: Paseo keeps a catalog until told to refresh it. */
  async refreshModels(): Promise<ModelCache> {
    const { kit, models } = this.options;
    // Scoped to one directory: unscoped, Paseo probes the agent for every workspace it has ever opened.
    const cwd = stateRoot();
    await Promise.all([...listingProviders(kit).values()].map((provider) => models.refresh(provider, cwd)));
    const { cache, changed } = await fetchModels(kit, (provider) => models.list(provider, cwd), stateRoot());
    applyModels(kit, cache);
    if (changed) {
      this.options.modelsChanged();
      await this.reconcile();
    }
    return cache;
  }

  /** One pass at a time, each reading the teams as they are when it starts, so calls made meanwhile share the next. */
  reconcile(): Promise<void> {
    if (this.waiting) return this.waiting;
    const next = this.running.then(() => {
      this.waiting = undefined;
      return this.apply();
    });
    this.waiting = next;
    this.running = next;
    return next;
  }

  private async apply(): Promise<void> {
    try {
      const { kit, source, config } = this.options;
      const held = await config.read();
      const teams = source.known().map((project) => source.teamFor(project));
      let plan = providerPatches(held, kit, teams);
      if (plan.stale.length > 0) plan = providerPatches(held, kit, teams, await this.inUse(plan.stale));
      for (const patch of plan.patches) await config.patch(patch);
      if (plan.changed.length > 0) daemonLog.info(`Paseo's providers updated: ${plan.changed.join(", ")}`);
    } catch (error) {
      daemonLog.error("could not bring Paseo's providers in step with the teams:", error);
    }
  }

  /** The providers a live seat still runs on; when Paseo cannot say, every one asked about stays. */
  private async inUse(stale: string[]): Promise<Set<string>> {
    try {
      return new Set((await this.options.seats.open()).map((seat) => seat.provider.split("/")[0]!));
    } catch {
      return new Set(stale);
    }
  }
}

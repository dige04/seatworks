import { z } from "zod";
import { type Layer, LayerSchema } from "../../../shared/settings.ts";
import type {
  CatalogView,
  Check,
  ModelsRefreshed,
  Parsed,
  SettingsRead,
  TeamRead,
  WriteResult,
} from "../../../shared/views.ts";
import type { Kit } from "../../catalog/kit/kit.ts";
import { seatProblems } from "../../catalog/seat/seats.ts";
import { layerValues, readLayer, readShown, withKeys, withoutKeys, writeLayer } from "../../catalog/team/settings.ts";
import { type Team, resolveTeam, servingProject } from "../../catalog/team/team.ts";
import { guidesDir } from "../../core/paths.ts";
import type { Host } from "../../core/ports.ts";
import { type Project, projectOf } from "../../desk/project/project.ts";
import type { TeamSource } from "../team-source.ts";
import { describeCatalog } from "./catalog-view.ts";
import { doctor } from "./doctor.ts";
import { foldDraft } from "./draft.ts";
import { parseMcp } from "./mcp-paste.ts";
import { unknownProject } from "./projects.ts";
import type { SettingsRpc } from "./rpc.ts";
import { describeTeam } from "./team-view.ts";

type Target = { file: string; project?: Project };

type SettingsDeps = {
  kit: Kit;
  source: TeamSource;
  changed: () => void;
  reconcile: () => Promise<void>;
  models: () => Promise<Record<string, { at: string; error: string | null; models: unknown[] }>>;
  paseoTools: Host["tools"];
};

/** The machine's and a project's settings on the panel: read, checked against the team they make, and saved. */
export class SettingsPanel implements SettingsRpc {
  private readonly deps: SettingsDeps;

  constructor(deps: SettingsDeps) {
    this.deps = deps;
  }

  catalog(): CatalogView {
    return describeCatalog(this.deps.kit);
  }

  readSettings(slug?: string): SettingsRead {
    const machine = withoutKeys(slug ? this.deps.source.machineLayer() : {});
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", revision: "", error: target, machine };
    return { ...readShown(target.file), machine };
  }

  async writeSettings(slug: string | undefined, revision: string, values: unknown): Promise<WriteResult> {
    const { kit, source, changed, reconcile } = this.deps;
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", error: target };
    const resolve = (layer: Layer) =>
      target.project ? resolveTeam(kit, source.machineLayer(), layer) : resolveTeam(kit, layer);
    const paths = { guides: guidesDir(), state: target.project?.state ?? "$SEATWORKS_STATE" };
    const unbuildable = (team: Team) => Object.keys(team.roles).flatMap((role) => seatProblems(kit, team, role, paths));
    // Only what this save introduces is refused: a bad rule refuses a seat's whole build, long after the save, and an
    // error the settings already had, such as a role the kit no longer has, would refuse every save, the fix included.
    const check = (layer: Layer) => {
      const before = resolve(layerValues(target.file));
      const fresh = (problems: string[], had: string[]) => problems.filter((problem) => !had.includes(problem));
      const team = resolve(layer);
      const errors = fresh(team.errors, before.errors);
      return errors.length > 0 ? errors : fresh(unbuildable(team), unbuildable(before));
    };
    const result = writeLayer(target.file, revision, withKeys(values, layerValues(target.file)), check);
    if (result.status === "saved") {
      changed();
      await reconcile();
    }
    return result.status === "saved" ? { ...result, values: withoutKeys(result.values) } : result;
  }

  parseMcp(text: string): Parsed {
    return parseMcp(text);
  }

  /** The team `draft` would make of the project at `root`, over what it holds already, or over the machine's alone. */
  previewTeam(root: string, draft: unknown): TeamRead {
    const parsed = LayerSchema.safeParse(draft);
    if (!parsed.success) return { error: z.prettifyError(parsed.error) };
    const { kit, source } = this.deps;
    const project = projectOf(root);
    const held = source.named(project.slug) ? layerValues(source.projectFile(project)) : {};
    const machine = source.machineLayer();
    const before = resolveTeam(kit, machine, held);
    const layer = foldDraft(held, parsed.data, (role) => before.roles[role]?.harness.id);
    return describeTeam(kit, servingProject(resolveTeam(kit, machine, layer), project.root), project);
  }

  /** A setup draft folded into the project's own layer and saved as any panel save is; why not, when it is refused. */
  async adopt(project: Project, draft: unknown): Promise<string | undefined> {
    const parsed = LayerSchema.safeParse(draft);
    if (!parsed.success) return z.prettifyError(parsed.error);
    const read = readLayer(this.deps.source.projectFile(project));
    if (read.status !== "ready") return read.error;
    const before = resolveTeam(this.deps.kit, this.deps.source.machineLayer(), read.values);
    const layer = foldDraft(read.values, parsed.data, (role) => before.roles[role]?.harness.id);
    const written = await this.writeSettings(project.slug, read.revision, layer);
    return written.status === "saved" ? undefined : written.error;
  }

  team(slug?: string): TeamRead {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return { error: unknownProject(slug) };
    return describeTeam(this.deps.kit, this.deps.source.teamFor(project), project);
  }

  async doctor(slug?: string): Promise<Check[]> {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return [{ id: "project", group: "machine", ok: false, detail: unknownProject(slug) }];
    return doctor(this.deps.kit, this.deps.source.teamFor(project), this.deps.paseoTools);
  }

  async refreshModels(): Promise<ModelsRefreshed> {
    const cache = await this.deps.models();
    return Object.fromEntries(
      Object.entries(cache).map(([id, entry]) => [
        id,
        { at: entry.at, error: entry.error, count: entry.models.length },
      ]),
    );
  }

  private target(slug?: string): Target | string {
    if (!slug) return { file: this.deps.source.machineFile() };
    const project = this.deps.source.named(slug);
    if (!project) return unknownProject(slug);
    return { file: this.deps.source.projectFile(project), project };
  }
}

import type { z } from "zod";
import { contracts } from "../../../shared/rpc.ts";

type Contract = { name: string; input: z.ZodType; output: z.ZodType };
type Out<C extends Contract> = z.input<C["output"]> | Promise<z.input<C["output"]>>;

export interface SettingsRpc {
  catalog(): Out<typeof contracts.catalog>;
  readSettings(project?: string): Out<typeof contracts.settingsRead>;
  writeSettings(project: string | undefined, revision: string, values: unknown): Out<typeof contracts.settingsWrite>;
  parseMcp(text: string): Out<typeof contracts.mcpParse>;
  team(project?: string): Out<typeof contracts.team>;
  previewTeam(root: string, values: unknown): Out<typeof contracts.teamPreview>;
  doctor(project?: string): Out<typeof contracts.doctor>;
  refreshModels(): Out<typeof contracts.models>;
}

export interface ProjectsRpc {
  projects(): Out<typeof contracts.projects>;
  addProject(root: string, values?: unknown): Out<typeof contracts.projectsAdd>;
  removeProject(project: string): Out<typeof contracts.projectsRemove>;
  candidateProjects(roots: string[]): Out<typeof contracts.projectsCandidates>;
  listPaths(path?: string): Out<typeof contracts.paths>;
  status(project: string): Out<typeof contracts.status>;
  flow(project: string, since?: string, open?: string[]): Out<typeof contracts.flow>;
}

export interface UpkeepRpc {
  clean(remove?: string[]): Out<typeof contracts.clean>;
  update(apply: boolean, fetch?: boolean): Out<typeof contracts.update>;
  olderSeats(): Out<typeof contracts.olderSeats>;
  content(seen?: string[]): Out<typeof contracts.content>;
}

export interface HumanRpc {
  decideLand(project: string, lane: string, approve: boolean, note: string): Out<typeof contracts.landDecide>;
  answer(project: string, question: string, choice: string, note: string): Out<typeof contracts.questionAnswer>;
  orders(project: string): Out<typeof contracts.orders>;
  report(project: string): Out<typeof contracts.report>;
}

export type Panel = { settings: SettingsRpc; projects: ProjectsRpc; upkeep: UpkeepRpc; human: HumanRpc };

type Serve = <C extends Contract>(contract: C, answer: (input: z.output<C["input"]>) => Out<C>) => void;

/** Every panel call answered with why the plugin cannot serve it, so the panel shows that rather than nothing. */
export function refuseRpc(handle: (contract: Contract, answer: () => never) => void, reason: string): void {
  for (const contract of Object.values(contracts))
    handle(contract, () => {
      throw new Error(reason);
    });
}

export function registerRpc(handle: Serve, panel: Panel): void {
  const { settings, projects, upkeep, human } = panel;
  handle(contracts.catalog, () => settings.catalog());
  handle(contracts.settingsRead, (input) => settings.readSettings(input.project));
  handle(contracts.settingsWrite, (input) => settings.writeSettings(input.project, input.revision, input.values));
  handle(contracts.mcpParse, (input) => settings.parseMcp(input.text));
  handle(contracts.team, (input) => settings.team(input.project));
  handle(contracts.teamPreview, (input) => settings.previewTeam(input.root, input.values));
  handle(contracts.doctor, (input) => settings.doctor(input.project));
  handle(contracts.models, () => settings.refreshModels());
  handle(contracts.projects, () => projects.projects());
  handle(contracts.projectsAdd, (input) => projects.addProject(input.root, input.values));
  handle(contracts.projectsRemove, (input) => projects.removeProject(input.project));
  handle(contracts.projectsCandidates, (input) => projects.candidateProjects(input.roots));
  handle(contracts.paths, (input) => projects.listPaths(input.path));
  handle(contracts.status, (input) => projects.status(input.project));
  handle(contracts.flow, (input) => projects.flow(input.project, input.since, input.open));
  handle(contracts.clean, (input) => upkeep.clean(input.remove));
  handle(contracts.update, (input) => upkeep.update(input.apply, input.fetch));
  handle(contracts.olderSeats, () => upkeep.olderSeats());
  handle(contracts.content, (input) => upkeep.content(input.seen));
  handle(contracts.landDecide, (input) => human.decideLand(input.project, input.lane, input.approve, input.note));
  handle(contracts.questionAnswer, (input) => human.answer(input.project, input.question, input.choice, input.note));
  handle(contracts.orders, (input) => human.orders(input.project));
  handle(contracts.report, (input) => human.report(input.project));
}

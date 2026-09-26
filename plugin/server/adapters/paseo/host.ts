import type { PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import type { Host, HostHooks, Models, PaseoConfig } from "../../core/ports.ts";
import { type PaseoApi, seatsOn, workspacesOn } from "./agents.ts";
import { readConfig } from "../../core/config-file.ts";
import { getPath } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { toolNames } from "../../core/mcp-client.ts";
import { paseoConfigPath } from "../../core/paths.ts";

/** Answers one contract's calls; Paseo has read each input with the contract's schema before the answer sees it. */
type Answering = <I>(contract: { name: string }, answer: (input: I) => unknown) => void;
type Handle = (contract: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => unknown) => void;

/** Where Paseo lists its tools to its own agents: the daemon's TCP address, as its listen setting names it; a socket or pipe gives none. */
function agentToolsUrl(): string | undefined {
  const listed = getPath(readConfig(paseoConfigPath(), {}), ["daemon", "listen"]);
  const listen = process.env.PASEO_LISTEN ?? (typeof listed === "string" ? listed : "127.0.0.1:6767");
  if (/^\d+$/.test(listen)) return `http://127.0.0.1:${listen}/mcp/agents`;
  const tcp = /^([^/\\]+):(\d+)$/.exec(listen);
  if (!tcp) return undefined;
  const host = ["0.0.0.0", "::", "[::]"].includes(tcp[1]!) ? "127.0.0.1" : tcp[1]!;
  return `http://${host}:${tcp[2]!}/mcp/agents`;
}

/** Paseo hands the plugin its API only with a hook or a panel call, so each one binds it before the plugin acts. */
export class PaseoHost implements Host {
  readonly seats;
  readonly workspaces;
  readonly models: Models;
  readonly config: PaseoConfig;
  private api: PaseoApi | undefined;
  private arrived = () => {};
  private readonly arrival = new Promise<void>((resolve) => (this.arrived = resolve));

  constructor(api?: PaseoApi) {
    if (api) this.bind(api);
    this.seats = seatsOn(() => this.api);
    this.workspaces = workspacesOn(() => this.api);
    this.models = {
      refresh: async (provider, cwd) => {
        await this.reach().providers.refresh({ cwd, providers: [provider] });
      },
      list: (provider, cwd) => this.reach().providers.listModels(provider, { cwd }),
    };
    this.config = {
      read: async () => {
        await this.arrival;
        return (await this.reach().config.get()).config;
      },
      patch: async (change) => {
        await this.arrival;
        await this.reach().config.patch(change as Parameters<PaseoApi["config"]["patch"]>[0]);
      },
    };
  }

  connected(): boolean {
    return this.api !== undefined;
  }

  reached(): Promise<void> {
    return this.arrival;
  }

  async tools(): Promise<{ names: string[] } | { error: string } | undefined> {
    const url = agentToolsUrl();
    if (!url) return undefined;
    const listed = await toolNames(url, 3000);
    return listed.names
      ? { names: listed.names }
      : { error: `nothing answered at ${url}: ${listed.error ?? "no tool list"}` };
  }

  connect(server: PluginServerContext, hooks: HostHooks): void {
    server.before("agent.create", ({ request }, context) => {
      this.bind(context.paseo);
      const made = hooks.create(request.config, request.env ?? {});
      // The plugin's config type is narrower than Paseo's, and the daemon checks what a hook returns.
      return { ...request, config: made.config as typeof request.config, env: made.env };
    });
    server.before("agent.session_open", ({ request }, context) => {
      this.bind(context.paseo);
      return { ...request, ...hooks.sessionOpen(request) };
    });
    this.on(server, "agent.turn_started", ({ agent }) => hooks.turnStarted(agent));
    this.on(server, "agent.turn_ended", (event) => hooks.turnEnded(event));
    this.on(server, "agent.permission_requested", (event) => hooks.permissionRequested(event));
    this.on(server, "agent.created", ({ agent }) => hooks.created(agent));
    this.on(server, "agent.archived", ({ agent }) => hooks.archived(agent));
  }

  /** Panel calls carry the live daemon handle: after a reload with no seat hooks yet, it is the desk's only way to get one. */
  answering(server: Pick<PluginServerContext, "handle">): Answering {
    const handle = server.handle.bind(server) as unknown as Handle;
    return <I>(contract: { name: string }, answer: (input: I) => unknown) =>
      handle(contract, (input, context) => {
        this.bind(context.paseo);
        return answer(input as I);
      });
  }

  /** A hook that throws is logged here and goes no further, as Paseo would only log it too. */
  private on<N extends keyof PluginLifecycleEvents>(
    server: PluginServerContext,
    name: N,
    handler: (event: PluginLifecycleEvents[N]) => Promise<void>,
  ): void {
    server.on(name, async (event, context) => {
      this.bind(context.paseo);
      try {
        await handler(event);
      } catch (error) {
        daemonLog.error(`${name} handler failed:`, error);
      }
    });
  }

  private bind(api: PaseoApi): void {
    this.api = api;
    this.arrived();
  }

  private reach(): PaseoApi {
    if (!this.api) throw new Error("Paseo has not handed this plugin its API yet");
    return this.api;
  }
}

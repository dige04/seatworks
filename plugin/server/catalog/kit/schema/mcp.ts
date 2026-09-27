import { isAbsolute } from "node:path";
import { z } from "zod";
import { Json, text, texts } from "./fields.ts";
import { Pattern, SettingValue } from "../../../../shared/settings.ts";

export const McpTransport = z.enum(["stdio", "http", "sse"]);

const ProxyHook = {
  tool: text,
  args: Json.optional(),
  when: Pattern.optional(),
  timeoutSeconds: z.number().positive().optional(),
};

const Proxy = z.strictObject({
  backend: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("http"), url: text }),
    z.strictObject({ type: z.literal("stdio"), command: z.array(z.string()).min(1) }),
  ]),
  pin: text.optional(),
  gitExclude: texts.optional(),
  open: z
    .strictObject({ ...ProxyHook, route: z.strictObject({ when: Pattern, from: text, field: text }).optional() })
    .optional(),
  close: z.strictObject(ProxyHook).optional(),
  wait: z
    .strictObject({
      ...ProxyHook,
      busy: Pattern.optional(),
      seconds: z.number().positive().optional(),
      pollSeconds: z.number().positive().optional(),
    })
    .optional(),
  sync: z
    .strictObject({ tool: text, paths: text.optional(), maxPaths: z.number().int().positive().optional() })
    .optional(),
  errors: z.array(z.strictObject({ when: Pattern, reply: text })).optional(),
  descriptions: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().positive().optional(),
});

/** A list holds numbers or strings, as `of` says, tried in its order: several ports of an IDE, the first that answers. */
const McpSetting = z
  .strictObject({
    type: z.enum(["number", "string", "boolean", "list"]),
    of: z.enum(["number", "string"]).optional(),
    label: text,
    default: SettingValue.optional(),
  })
  .refine((spec) => (spec.type === "list") === (spec.of !== undefined), {
    error: "names what it holds with `of` exactly when it is a list",
  });

/** `catalog/mcp/<id>/mcp.json`: a server every seat of its roles may be given, or a proxy the desk runs in front of one. */
export const McpFile = z
  .strictObject({
    id: text,
    label: text,
    description: z.string().optional(),
    order: z.number().optional(),
    kind: z.enum(["proxy", "server"]),
    proxy: Proxy.optional(),
    instructions: z.string().optional(),
    server: z.looseObject({ type: McpTransport }).optional(),
    settings: z.record(z.string(), McpSetting).default({}),
    defaults: z.strictObject({ enabled: z.boolean() }).default({ enabled: false }),
    tools: z.record(z.string(), texts).optional(),
    roles: texts.optional(),
    rule: text.optional(),
    roleNotes: z.record(z.string(), z.string()).optional(),
    skills: texts.optional(),
    help: z.string().optional(),
    requires: z
      .array(text.refine((path) => !isAbsolute(path), { error: "is not a path inside the project" }))
      .optional(),
  })
  .refine((entry) => entry.kind !== "proxy" || entry.proxy, {
    error: "is a proxy with no proxy block",
    path: ["proxy"],
  })
  .refine((entry) => entry.kind !== "server" || entry.server, {
    error: "is a server with no server block",
    path: ["server"],
  });

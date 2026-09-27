import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { errorText } from "./errors.ts";
import { PLUGIN_ID } from "./paths.ts";

/** One exchange with an MCP server over HTTP, handshake first and closed after: what the desk asks of a code index is brief. */
async function withServer<T>(url: string, timeoutMs: number, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: PLUGIN_ID, version: "3" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: timeoutMs });
    return await use(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** One call at the first of `urls` that takes the handshake, in their order; one that answers and fails is that call's failure. */
export async function callTool(
  urls: string[],
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string }> {
  let unreached = "no address is set";
  for (const url of urls) {
    const client = new Client({ name: PLUGIN_ID, version: "3" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: timeoutMs });
    } catch (error) {
      unreached = errorText(error);
      await client.close().catch(() => {});
      continue;
    }
    try {
      const result = await client.callTool({ name, arguments: args }, { timeout: timeoutMs });
      const text = (result.content as { text?: string }[] | undefined)?.map((part) => part.text ?? "").join("\n") ?? "";
      return { ok: !result.isError, text };
    } catch (error) {
      return { ok: false, text: errorText(error) };
    } finally {
      await client.close().catch(() => {});
    }
  }
  return { ok: false, text: unreached };
}

export async function toolNames(url: string, timeoutMs: number): Promise<{ names?: string[]; error?: string }> {
  try {
    return {
      names: await withServer(url, timeoutMs, async (client) =>
        (await client.listTools(undefined, { timeout: timeoutMs })).tools.map((tool) => tool.name),
      ),
    };
  } catch (error) {
    return { error: errorText(error) };
  }
}

export async function reaches(url: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await withServer(url, timeoutMs, async () => undefined);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

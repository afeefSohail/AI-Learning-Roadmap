import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError, BASE_URL, getJson, UnauthorizedError, UnavailableError } from "./userauth-client";

/** Per-request state shared with the HTTP wrapper, so a 401 from the API can become an HTTP 401. */
export const requestState = new AsyncLocalStorage<{ unauthorized: boolean }>();

type Photo = { id: number; url: string; createdAt: string };

const photo = (p: { id: number; url: string; createdAt: string }): Photo => ({
  id: p.id,
  url: p.url.startsWith("http") ? p.url : `${BASE_URL()}${p.url}`,
  createdAt: p.createdAt,
});

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

function bearerToken(ctx: McpRequestContext): string | undefined {
  const header = ctx.requestInfo?.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1];
}

export function createServer(ctx: McpRequestContext): McpServer {
  const token = bearerToken(ctx);
  const server = new McpServer({ name: "userauth", version: "0.1.0" });

  // One API call per tool: a 401 means nothing ran. Keep it that way.
  async function run<T>(signal: AbortSignal, call: (token: string) => Promise<T>) {
    const state = requestState.getStore();
    if (!token) {
      if (state) state.unauthorized = true;
      return fail("Authentication required.");
    }
    try {
      return asText(await call(token));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        if (state) state.unauthorized = true; // the HTTP wrapper turns this into a 401 response
        return fail("Authentication required.");
      }
      if (err instanceof ApiError) return fail(err.message);
      if (err instanceof UnavailableError) {
        console.error("userauth api unavailable:", err.message);
        return fail("The service is unavailable. Do not retry; tell the user.");
      }
      console.error("get tool failed:", err);
      return fail("Internal error in the UserAuth tool. Please try again later.");
    }
  }

  server.registerTool(
    "get_me",
    {
      title: "My profile",
      description: "Get the signed-in user's profile and their photos.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (_args, c) =>
      run(c.mcpReq.signal, async (t) => {
        const u = (await getJson("/auth/me", t, c.mcpReq.signal)) as {
          id: number; email: string; name: string; createdAt: string; photos?: Photo[];
        };
        return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, photos: (u.photos ?? []).map(photo) };
      }),
  );

  server.registerTool(
    "list_photos",
    {
      title: "My photos",
      description: "List the signed-in user's photos, newest first. An empty list means the user has no photos.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (_args, c) =>
      run(c.mcpReq.signal, async (t) => ((await getJson("/user/me/photos", t, c.mcpReq.signal)) as Photo[]).map(photo)),
  );

  server.registerTool(
    "get_photo",
    {
      title: "One photo",
      description: "Get one of the signed-in user's photos by its ID.",
      inputSchema: z.object({ photoId: z.number().int().positive().describe("The photo's ID, from list_photos") }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ photoId }, c) =>
      run(c.mcpReq.signal, async (t) => photo((await getJson(`/user/photos/${photoId}`, t, c.mcpReq.signal)) as Photo)),
  );

  return server;
}

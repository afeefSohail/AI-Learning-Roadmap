import { createServer as createHttpServer, type Server } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { requestState } from "../day-17/create-server";
import { createServer } from "./create-server";

const mcp = createMcpHandler(createServer, { responseMode: "json" });

/** Same wrapper as Day 17: if a tool saw a 401 from the API, answer the HTTP request with 401. */
const guarded = {
  fetch: async (request: Request, options?: Parameters<typeof mcp.fetch>[1]) => {
    const state = { unauthorized: false };
    let response = await requestState.run(state, () => mcp.fetch(request, options));
    if (request.method === "POST") {
      const body = await response.arrayBuffer();
      response = new Response(body, { status: response.status, headers: response.headers });
    }
    if (!state.unauthorized) return response;
    return new Response(JSON.stringify({ error: "invalid_token", error_description: "Missing, expired or invalid access token" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer error="invalid_token"' },
    });
  },
};

export function startHttpServer(port = 3333): Promise<Server> {
  const validateHost = localhostHostValidation();
  const handle = toNodeHandler(guarded);
  const server = createHttpServer(async (req, res) => {
    if (!validateHost(req, res)) return;
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    await handle(req, res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

// Run directly: npx tsx day-18/http-server.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3333);
  await startHttpServer(port);
  console.error(`userauth MCP server (read + write tools) on http://127.0.0.1:${port}/mcp (API: ${process.env.USERAUTH_BASE_URL ?? "http://localhost:3000"})`);
}

// The same MCP server as Day 18, made ready to run in a container.
// What is new: the bind address, the allowed hosts, /health and a clean stop on SIGTERM.
import { createServer as createHttpServer, type Server } from "node:http";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { guarded } from "../day-18/http-server";

export type Config = { port: number; host: string; allowedHosts: string[] };

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** HOST: address to listen on (default 127.0.0.1). PORT: default 3333.
 *  ALLOWED_HOSTS: extra host names (no port) accepted in the Host and Origin headers, added to the loopback names. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const extra = (env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return {
    port: Number(env.PORT ?? 3333),
    host: env.HOST ?? "127.0.0.1",
    allowedHosts: [...new Set([...LOOPBACK, ...extra])],
  };
}

export function startHttpServer(config: Partial<Config> = {}): Promise<Server> {
  const cfg = { ...configFromEnv({}), ...config };
  const validateHost = hostHeaderValidation(cfg.allowedHosts);
  const validateOrigin = originValidation(cfg.allowedHosts);
  const handle = toNodeHandler(guarded);
  const server = createHttpServer(async (req, res) => {
    if (!validateHost(req, res)) return; // wrong Host header: stops DNS rebinding
    if (!validateOrigin(req, res)) return; // browser request from another site
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}'); // no API call, no token
      return;
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    await handle(req, res);
  });
  
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => resolve(server));
  });
}

// Run directly: node --import tsx day-19/http-server.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = configFromEnv();
  let server: Server | undefined;
  // `docker stop` sends SIGTERM and kills the process after 10 seconds. Stop cleanly before that.
  // The handlers are registered first, so a signal that arrives during start-up is not lost.
  const stop = () => {
    console.error("stopping");
    if (!server) process.exit(0);
    server!.close(() => process.exit(0));
    server!.closeAllConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  server = await startHttpServer(cfg);
  console.error(
    `userauth MCP server listening on ${cfg.host}:${cfg.port}/mcp (API: ${process.env.USERAUTH_BASE_URL ?? "http://localhost:3000"}, ` +
      `public URL: ${process.env.PUBLIC_BASE_URL ?? "same as API"}, hosts: ${cfg.allowedHosts.join(",")})`,
  );
}

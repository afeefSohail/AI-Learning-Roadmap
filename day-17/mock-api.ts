// A tiny stand-in for the UserAuth API, with the same response shapes, for tests.
import { createServer, type Server } from "node:http";

const photosByUser: Record<string, { id: number; url: string; userId: number; createdAt: string; updatedAt: string }[]> = {
  "token-a": [
    { id: 11, url: "/uploads/1731950000000-482913776.jpg", userId: 1, createdAt: "2026-11-18T09:12:44.000Z", updatedAt: "2026-11-18T09:12:44.000Z" },
    { id: 10, url: "/uploads/1731940000000-111111111.png", userId: 1, createdAt: "2026-11-17T09:00:00.000Z", updatedAt: "2026-11-17T09:00:00.000Z" },
  ],
  "token-b": [],
};
const users: Record<string, { id: number; email: string; name: string; createdAt: string }> = {
  "token-a": { id: 1, email: "a@example.com", name: "Alice Example", createdAt: "2026-11-01T08:00:00.000Z" },
  "token-b": { id: 2, email: "b@example.com", name: "Bob Example", createdAt: "2026-11-02T08:00:00.000Z" },
};

export const stats = { calls: 0, flakyFailed: false, refreshCalls: 0 };

export function startMockApi(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    stats.calls++;
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/auth/refresh") {
      stats.refreshCalls++;
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const { refreshToken } = JSON.parse(raw || "{}") as { refreshToken?: string };
        // a slow refresh, so parallel callers really overlap
        if (refreshToken === "refresh-a") return void setTimeout(() => send(200, { meta: { code: 200, message: "Token refreshed" }, data: "token-a" }), 150);
        send(401, { meta: { code: 401, message: "Invalid or expired refresh token" } });
      });
      return;
    }
    const header = req.headers.authorization ?? "";
    if (!/^Bearer /.test(header)) return send(401, { message: "Missing or invalid Authorization header" });
    const token = header.slice(7);
    if (token === "boom") return send(500, { meta: { code: 500, message: "Internal server error" } });
    if (token === "flaky" && !stats.flakyFailed) {
      stats.flakyFailed = true;
      return send(500, { meta: { code: 500, message: "Internal server error" } });
    }
    const key = token === "flaky" ? "token-a" : token;
    if (!users[key]) return send(401, { message: "Invalid or expired access token" });
    const mine = photosByUser[key]!;
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/auth/me") {
      return send(200, { meta: { code: 200, message: "OK" }, data: { ...users[key], photos: mine.map((p) => ({ ...p })) } });
    }
    if (url.pathname === "/user/me/photos") return send(200, { meta: { code: 200, message: "OK" }, data: mine });
    const m = /^\/user\/photos\/(\d+)$/.exec(url.pathname);
    if (m) {
      const p = mine.find((x) => x.id === Number(m[1]));
      if (!p) return send(404, { meta: { code: 404, message: "Photo not found" } });
      return send(200, { meta: { code: 200, message: "OK" }, data: p });
    }
    send(404, { meta: { code: 404, message: "Not found" } });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    }),
  );
}

// A stand-in for the UserAuth API with the write routes, for tests. It records every request.
import { createServer, type Server } from "node:http";

type Photo = { id: number; url: string; userId: number; createdAt: string; updatedAt: string };
const ts = "2026-11-18T09:12:44.000Z";

export const state = {
  photos: [] as Photo[],
  users: {} as Record<string, { id: number; email: string; name: string; createdAt: string }>,
  calls: [] as { method: string; path: string; token: string; body: unknown }[],
};
export const writes = () => state.calls.filter((c) => c.method !== "GET");
export const deletes = () => state.calls.filter((c) => c.method === "DELETE");

export function reset() {
  state.photos = [
    { id: 11, url: "/uploads/a-11.jpg", userId: 1, createdAt: ts, updatedAt: ts },
    { id: 12, url: "/uploads/a-12.jpg", userId: 1, createdAt: ts, updatedAt: ts },
    { id: 21, url: "/uploads/b-21.jpg", userId: 2, createdAt: ts, updatedAt: ts },
  ];
  state.users = {
    "token-a": { id: 1, email: "a@example.com", name: "Alice Example", createdAt: ts },
    "token-b": { id: 2, email: "b@example.com", name: "Bob Example", createdAt: ts },
  };
  state.calls = [];
}
reset();

// token -> which user it acts as, and how DELETE behaves for it
const alias: Record<string, string> = { slow: "token-a", "boom-write": "token-a" };

export function startMockApi(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const header = req.headers.authorization ?? "";
      const token = /^Bearer (.+)$/.exec(header)?.[1] ?? "";
      const path = new URL(req.url!, "http://x").pathname;
      state.calls.push({ method: req.method!, path, token, body: raw ? JSON.parse(raw) : undefined });
      const key = alias[token] ?? token;
      const me = state.users[key];
      if (!token || !me) return send(401, { message: "Invalid or expired access token" });
      const ok = (data: unknown) => send(200, { meta: { code: 200, message: "OK" }, data });
      if (req.method === "PATCH" && path === "/user/me") {
        if (token === "boom-write") return send(500, { meta: { code: 500, message: "Internal server error" } });
        const { name } = JSON.parse(raw || "{}") as { name?: string };
        if (typeof name === "string") me.name = name;
        return ok({ ...me, photos: state.photos.filter((p) => p.userId === me.id) });
      }
      const m = /^\/user\/photos\/(\d+)$/.exec(path);
      if (m) {
        const photo = state.photos.find((p) => p.id === Number(m[1]) && p.userId === me.id);
        if (!photo) return send(404, { meta: { code: 404, message: "Photo not found" } });
        if (req.method === "GET") return ok(photo);
        if (req.method === "DELETE") {
          if (token === "boom-write") return send(500, { meta: { code: 500, message: "Internal server error" } });
          state.photos = state.photos.filter((p) => p !== photo); // the delete really happens
          if (token === "slow") return void setTimeout(() => ok(photo), 1200); // but the answer comes too late
          return ok(photo);
        }
      }
      send(404, { meta: { code: 404, message: "Not found" } });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })),
  );
}

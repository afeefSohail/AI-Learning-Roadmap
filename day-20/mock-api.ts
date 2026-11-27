// The Day 18 mock only has the write routes. Day 20 also needs get_me and list_photos, so this puts the two
// read routes in front of it and forwards everything else unchanged. Day 18's file stays as it is.
import { createServer, type Server } from "node:http";
import { startMockApi as startWriteApi, state } from "../day-18/mock-api";

export { deletes, reset, state, writes } from "../day-18/mock-api";

export async function startMockApi(): Promise<{ server: Server; url: string }> {
  const inner = await startWriteApi();
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://x").pathname;
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readRoute = req.method === "GET" && (path === "/auth/me" || path === "/user/me/photos");
    if (readRoute) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
      const me = state.users[token];
      if (!me) return send(401, { message: "Invalid or expired access token" });
      const photos = state.photos.filter((p) => p.userId === me.id);
      return send(200, { meta: { code: 200, message: "OK" }, data: path === "/auth/me" ? { ...me, photos } : photos });
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const r = await fetch(`${inner.url}${req.url}`, {
        method: req.method,
        headers: { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), "content-type": "application/json" },
        body: raw || undefined,
      });
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(await r.text());
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      server.on("close", () => inner.server.close());
      resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    }),
  );
}

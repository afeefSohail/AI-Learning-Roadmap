// MCP Client probe for day-12 server
import { spawn } from "node:child_process";

const p = spawn("npx", ["tsx", "day-12/server.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
});

// Server/Discover and Tools/List are the first two requests that every MCP Client should make
// Server/Discover is like initial handshake, and Tools/List is to discover what tools the server has available
// The _meta is a standard part of every request, and it contains information about the client and its capabilities
// Client ask from MCP Server through Server/Discover what he can offer, and the server responds with its capabilities and supported features
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "probe", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

// any request: params plus the _meta that every 2026-07-28 request carries
const request = (id, method, params = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params: { ...params, _meta: meta },
});

// a tool call is just a request with `name` and `arguments`
const toolCall = (id, name, args) =>
  request(id, "tools/call", { name, arguments: args });

const msgs = [
  request(1, "server/discover"),
  request(2, "tools/list"),
  toolCall(3, "get_exchange_rate", { from: "USD", to: "PKR" }),
  toolCall(4, "get_exchange_rate", { from: "USD", to: "INR" }),
  toolCall(5, "get_exchange_rate", { from: "USD" }),
];

let out = "";
p.stdout.on("data", (d) => (out += d));

setTimeout(
  () => msgs.forEach((msg) => p.stdin.write(JSON.stringify(msg) + "\n")),
  3000,
);

setTimeout(() => {
  console.log(out);
  p.kill();
}, 7000);

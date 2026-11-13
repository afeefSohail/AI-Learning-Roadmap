// MCP Client probe for day-13 server
import { spawn } from "node:child_process";

const p = spawn("npx", ["tsx", "day-13/server.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "probe", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const request = (id, method, params = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params: { ...params, _meta: meta },
});

const msgs = [
  request(1, "server/discover"),
  request(2, "resources/list"),
  request(3, "resources/read", { uri: "rates://usd" }),
  request(4, "prompts/list"),
  request(5, "prompts/get", {
    name: "convert-and-explain",
    arguments: { amount: "2500", from: "USD", to: "PKR" },
  }),
  request(6, "prompts/get", {
    name: "convert-and-explain",
    arguments: { amount: "2500" },
  }),
  request(7, "resources/read", { uri: "rates://nope" }),
];

let out = "";
p.stdout.on("data", (d) => (out += d));
setTimeout(
  () => msgs.forEach((msg) => p.stdin.write(JSON.stringify(msg) + "\n")),
  3000,
);

setTimeout(() => {
  for (const line of out.trim().split("\n"))
    console.log(JSON.stringify(JSON.parse(line), null, 2));
  p.kill();
}, 7000);

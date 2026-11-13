// MCP Client probe for day-13 server
import { spawn } from "node:child_process";

const p = spawn("npx", ["tsx", "day-13/server.ts"], {
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


const request = (id, method, params = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params: { ...params, _meta: meta },
});

const msgs = [
  request(1, "server/discover"), // initial handshake with the server
  request(2, "resources/list"), // list all resources available on the server
  request(3, "resources/read", { uri: "rates://usd" }), // read the resource with the given URI
  request(4, "prompts/list"), // list all prompts available on the server
  request(5, "prompts/get", {
    name: "convert-and-explain",
    arguments: { amount: "2500", from: "USD", to: "PKR" },
  }), // get the prompt with the given name and arguments
  request(6, "prompts/get", {
    name: "convert-and-explain",
    arguments: { amount: "2500" },
  }), // get the prompt with the given name and arguments
  request(7, "resources/read", { uri: "rates://nope" }), // attempt to read a non-existent resource
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

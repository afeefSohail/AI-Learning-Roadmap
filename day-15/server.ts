import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./create-server";

serveStdio(createServer);
console.error("exchange-rate MCP server running on stdio");

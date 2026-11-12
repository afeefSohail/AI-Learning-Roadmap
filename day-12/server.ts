// MCP Server for day-12: exchange-rate
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// Made-up rates (same as Day 7), so the model cannot know them from training.
const RATES_PER_USD: Record<string, number> = { USD: 1, PKR: 277.35, EUR: 0.9137, GBP: 0.7712, JPY: 151.42 };
const SUPPORTED = Object.keys(RATES_PER_USD).join(", ");

function createServer(): McpServer {
  const server = new McpServer({ name: "exchange-rate", version: "1.0.0" });

  server.registerTool(
    "get_exchange_rate",
    {
      title: "Exchange rate",
      description: `Returns the exchange rate for converting one unit of one currency into another, e.g. from USD to PKR. Supported currency codes: ${SUPPORTED}. Use this for any currency conversion; you cannot know the current rate otherwise.`,
      inputSchema: z.object({
        from: z.string().describe("3-letter currency code to convert from, e.g. USD"),
        to: z.string().describe("3-letter currency code to convert to, e.g. PKR"),
      }),
    },
    async ({ from, to }) => {
      const source = from.toUpperCase();
      const target = to.toUpperCase();
      for (const code of [source, target]) {
        if (!(code in RATES_PER_USD)) {
          console.error(`unsupported currency requested: ${code}`); // stderr only: stdout is the protocol
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown currency: ${code}. Supported currencies: ${SUPPORTED}` }],
          };
        }
      }
      const rate = RATES_PER_USD[target]! / RATES_PER_USD[source]!;
      return { content: [{ type: "text", text: String(rate) }] };
    },
  );

  return server;
}

serveStdio(createServer);
console.error("exchange-rate MCP server running on stdio");
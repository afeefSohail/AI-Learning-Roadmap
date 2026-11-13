// MCP Server for day-13: tool + resource + prompt
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// Made-up rates (same as Day 7), so the model cannot know them from training.
const RATES_PER_USD: Record<string, number> = { USD: 1, PKR: 277.35, EUR: 0.9137, GBP: 0.7712, JPY: 151.42 };
const SUPPORTED = Object.keys(RATES_PER_USD).join(", ");

function createServer(): McpServer {
  const server = new McpServer({ name: "exchange-rate", version: "2.0.0" });

  // TOOL: the model decides when to call it.
  server.registerTool(
    "get_exchange_rate",
    {
      title: "Exchange rate",
      description: `Returns a fixed DEMO exchange rate for converting one unit of one currency into another, e.g. from USD to PKR. The rates are made-up numbers, not live market data. Supported currency codes: ${SUPPORTED}. Use this for any currency conversion in this demo.`,
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
          console.error(`unsupported currency requested: ${code}`);
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown currency: ${code}. Supported currencies: ${SUPPORTED}` }],
          };
        }
      }

      const rate = RATES_PER_USD[target]! / RATES_PER_USD[source]!;
      await new Promise(r => setTimeout(r, 90_000));   // <-- add this line here
      return { content: [{ type: "text", text: String(Number(rate.toPrecision(6))) }] };  
    },
  );

  // RESOURCE: the application decides to attach it as context.
  server.registerResource(
    "rates-table",
    "rates://usd",
    {
      title: "Exchange rates against USD",
      description: "The full table of made-up rates, one unit of USD in each currency.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(RATES_PER_USD, null, 2) }],
    }),
  );

  // PROMPT: the user picks it (like a slash command); the host turns it into messages.
  server.registerPrompt(
    "convert-and-explain",
    {
      title: "Convert and explain",
      description: "Convert an amount between two currencies and explain the calculation step by step.",
      argsSchema: z.object({
        amount: z.string().describe("The amount to convert, e.g. 2500"),
        from: z.string().describe("Currency code to convert from, e.g. USD"),
        to: z.string().describe("Currency code to convert to, e.g. PKR"),
      }),
    },
    ({ amount, from, to }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Convert ${amount} ${from} to ${to}. Use the exchange rate tool for the rate and the calculator for the arithmetic if you have one, then explain each step in two sentences.`,
          },
        },
      ],
    }),
  );

  return server;
}

serveStdio(createServer);
console.error("exchange-rate MCP server (tool + resource + prompt) running on stdio");
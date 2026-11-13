import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export interface McpConnection {
  client: Client;
  tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
  callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

export async function connectMcp(command: string, args: string[]): Promise<McpConnection> {
  const transport = new StdioClientTransport({ command, args, stderr: "inherit" });
  const client = new Client({ name: "day-14-client", version: "1.0.0" });
  client.onerror = (e) => console.error("[client error]", e);
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    client,
    tools,
    async callTool(name, args) {
      try {
        const response = await client.callTool({ name, arguments: args });
        const text = (response.content as Array<{ type: string; text?: string }>)
          .map((content) => (content.type === "text" ? content.text : `[${content.type}]`)).join("\n");
        return { text, isError: response.isError === true };
      } catch (e) {
        // protocol-level failure (unknown tool, timeout, dead server): surface as an error result
        return { text: `MCP request failed: ${(e as Error).message}`, isError: true };
      }
    },
    close: () => client.close(),
  };
}

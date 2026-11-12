# Day 11: MCP concepts

**Week 3: MCP fundamentals**

## What I read before coding

1. [Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture): host, client and server; the data layer and the transport layer; the three server primitives (tools, resources, prompts); the worked JSON-RPC example (`server/discover`, `tools/list`, `tools/call`, notifications).
2. [Server concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts.md): who controls each primitive.
3. [Client concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/client-concepts.md): elicitation, and why sampling is deprecated.
4. The [specification](https://modelcontextprotocol.io/specification/latest.md): overview, statelessness, and the two transports (stdio and Streamable HTTP).
5. The [client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices) page, for progressive tool discovery.
6. The [MCP SDKs page](https://modelcontextprotocol.io/docs/2026-07-28/sdk.md) and the [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) README, skimmed. No code today.

**Note on versions:** the newest spec (2026-07-28) is stateless. Older tutorials describe an `initialize` handshake and sessions, so I check every example against the spec version it was written for.

**Questions I answered before writing notes:** map Day 7 onto MCP, who controls each primitive, which transport for a UserAuth server, what stateless means, and what many tools cost. The answers are in `NOTES.md`.

## What I made

- `NOTES.md`: my answers, the primitives table and the architecture diagram (Mermaid, rendered by GitHub).
- This README.

No code today.

## Key idea: MCP moves the tools out of the agent

On Day 7 my tools lived inside the agent. With MCP they live in a server the agent connects to, so any MCP host can use them. The agent (`agent.ts`) becomes the **host**, one **client** object per server holds the connection, and the **server** (`tools.ts`) exposes tools without ever calling a model. The model call still happens in the host.

## Findings

### 1. The host is the agent, not the editor

I first named VS Code as the host, because I run the code from there. The host is the AI application that coordinates the model and creates one client per server, which in my setup is `agent.ts`.

### 2. The three primitives are independent

A tool is chosen by the model, a resource by the application, and a prompt by the user. I first described a pipeline where resources and prompts feed the model's choice of tool, but each primitive stands on its own. A user picks a prompt and the host expands it into messages.

### 3. A resource can also be a tool

The list of saved conversations can be attached as a resource or fetched by the model as a tool. I would use a tool, because the list is only fetched when needed and not attached to every request.

### 4. Stateless means self-contained requests, not "no chat history"

I first defined it as the server having no conversation memory. In MCP, every request carries the protocol version and capabilities in `_meta`, so any server instance can handle it. That is the same principle as the Messages API on Day 2, where every request carries the whole history. The gain is scaling and restarts. The cost is resending the metadata. Servers can also declare how long a response may be cached (`ttlMs`, `cacheScope`).

### 5. A JWT is signed, not encrypted

I wrote that the server "decrypts" the token. The server verifies the signature. The payload was readable when I decoded it on Day 9.

### 6. Many tools are a fixed cost in every request

From my own numbers (two tools about 626 tokens, three tools plus a system prompt 957), 30 tools would cost roughly 4,500 to 9,000 input tokens in every request, and 22,500 to 45,000 over a 5-step run, against the 4,785 I measured. This is an estimate, not a measurement.

## Not checked yet

- The exact wording of the progressive tool discovery section. My description of the mechanism (an index of tool names, fetching one schema when needed, dropping the rest) still has to be checked against the page.
- Whether discovery adds a model round trip, and what that costs.
- The cost estimate for 30 tools, which I can measure on Day 14 when the MCP client is in the agent loop.

## Rules of thumb

- The model never talks to the server. The host talks to the model, and the client talks to the server.
- Tools are the model's, resources the application's, prompts the user's.
- On stdio, stdout is the protocol. Logs go to stderr.
- Authenticate every HTTP request. Verify the signature, don't "decrypt".
- Tool definitions cost tokens in every request, so load only what the model needs.
- Check which spec version a tutorial is written for.

## Next (Day 12)

Build a stdio MCP server in TypeScript with one tool, and test it with the MCP Inspector.

# Glossary

Every new word from the AI Engineer Roadmap, in plain English. The day it first appears is in brackets.

## LLM API basics

| Word | Meaning |
|---|---|
| **LLM** | Large language model. A model that reads text and writes text, like Claude. (Day 1) |
| **Token** | A small piece of a word. Models read and write tokens, and you pay per token, for input and output. (Day 1) |
| **max_tokens** | The most tokens the model may write in one reply. Hit it, and the reply stops mid-sentence. (Day 1) |
| **stop_reason** | Why the reply ended: `end_turn` (finished), `max_tokens` (cut off), `tool_use` (wants a tool), `refusal`. (Day 1) |
| **usage** | The token count of a request: input tokens + output tokens. This is the bill. (Day 1) |
| **Context window** | Everything the model can see in one request: system prompt, messages, tool definitions and the reply. (Day 1) |
| **Stateless** | The API remembers nothing between requests. Your app resends the whole conversation every time. (Day 2) |
| **System prompt** | Instructions that set the model's role and rules for the whole conversation. A separate `system` field. (Day 2) |
| **Role** | Who wrote a message: `user` or `assistant`. They must alternate. (Day 2) |
| **History** | The list of earlier messages your app sends with each request. It is the model's only memory. (Day 2) |
| **Streaming** | Receiving the reply in small pieces as it is written, instead of all at once at the end. (Day 3) |
| **Event / delta** | In a stream, each piece arrives as an event. A delta is one new piece of text. (Day 3) |
| **Latency** | How long you wait. Time to first text and time to the full reply are different. (Day 3) |
| **JSON schema** | A description of the exact shape a JSON object must have. (Day 4) |
| **Structured output** | Asking the API to force the reply into your JSON schema. It fixes the shape, not the truth. (Day 4) |
| **Zod** | A TypeScript library that defines a schema once and checks data against it. (Day 4) |
| **Validation** | Checking that data follows your rules, like "items + tax = total". (Day 4) |
| **Repair loop** | Sending the model its own bad answer plus the errors, and asking it to try again. (Day 4) |
| **Prompt** | The text you send the model. A good one is a spec: it says exactly what output you want. (Day 5) |
| **Few-shot** | Putting a few worked examples in the prompt. (Day 5) |
| **XML tags** | Labels like `<rules>…</rules>` that separate parts of a prompt. (Day 5) |
| **Test set** | Example inputs with the right answers decided in advance, so you can measure a prompt. (Day 5) |

## Tools and agents

| Word | Meaning |
|---|---|
| **Tool** | A function your code exposes to the model, with a name, a description and an input schema. (Day 6) |
| **tool_use** | A block in the reply where the model asks to call a tool, with the arguments. (Day 6) |
| **tool_result** | The block your code sends back with the tool's output, matched by the same id. (Day 6) |
| **is_error** | A flag on a `tool_result` that says the tool failed, so the model can explain or retry. (Day 6) |
| **Agent** | An LLM that calls tools in a loop until the task is done. (Day 7) |
| **Agent loop** | Call the model, run the tools it asks for, send the results back, repeat. (Day 7) |
| **Step limit** | The most loop rounds your code allows. The API has no limit of its own. (Day 7) |
| **end_turn** | The `stop_reason` that means the model finished on its own. (Day 7) |
| **SSE** | Server-sent events. A way for a server to stream text to a browser over one HTTP response. (Day 8) |
| **Status code** | The number an HTTP response starts with: 400 bad request, 401 not logged in, 500 server bug, 502 upstream failed. (Day 8) |
| **Abort** | Stopping a model call early, for example when the user closes the page. (Day 8) |
| **JWT** | JSON Web Token. A signed token that proves who the user is. Anyone can read it; only the key holder can sign it. (Day 9) |
| **Middleware** | A function that runs before your route handler, for example to check the login token. (Day 9) |
| **HS256** | A JWT signing method with one shared secret. Whoever can verify can also sign. (Day 9) |
| **Ownership check** | Filtering every database query by the logged-in user, so nobody reads someone else's data. (Day 9) |
| **venv** | A Python virtual environment: a folder with the packages for one project. (Day 10) |
| **SDK** | Software development kit. The official library for calling an API from your language. (Day 10) |

## MCP (Model Context Protocol)

| Word | Meaning |
|---|---|
| **MCP** | Model Context Protocol. A standard way to connect tools and data to any AI app. (Day 11) |
| **Host** | The AI app that talks to the model and connects to MCP servers. (Day 11) |
| **Client** | One connection from the host to one MCP server. (Day 11) |
| **Server** | A program that offers tools, resources and prompts. It never calls the model itself. (Day 11) |
| **Resource** | Data a server offers, like a file or a table. The app decides when to attach it. (Day 11) |
| **Prompt (MCP)** | A ready-made message template a server offers. The user picks it, often as a slash command. (Day 11) |
| **stdio** | A transport where the app starts the server as a child process and talks over stdin/stdout. (Day 12) |
| **stdout / stderr** | A program's two output streams. On stdio, stdout carries protocol messages only; logs go to stderr. (Day 12) |
| **JSON-RPC** | The message format MCP uses: requests with a method name and an id, and responses with the same id. (Day 12) |
| **isError** | The MCP flag for a failed tool call that the model can read and fix. (Day 12) |
| **Protocol error** | A failure the request itself can't recover from, like an unknown tool. The model usually never sees it. (Day 12) |
| **URI** | An address for a resource, like `rates://usd`. (Day 13) |
| **listTools / callTool** | The client calls that ask a server for its tools and run one. (Day 14) |
| **Timeout** | How long a client waits for an answer. A timeout means "no answer yet", not "it failed". (Day 14) |
| **In-process test** | A test that runs the server inside the test itself, with no port and no child process. (Day 15) |
| **Cancellation** | Telling a running request to stop, so the server can stop the work. (Day 15) |
| **Mutation check** | Breaking your code on purpose to prove a test catches it. (Day 15) |

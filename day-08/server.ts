import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fileURLToPath } from "node:url";

// The server decides these. The client may not.
const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1000;
const SYSTEM = "You are a helpful assistant. Keep answers short and clear.";
const PRICE_INPUT_TOKEN = 0.1 / 1_000_000;
const PRICE_OUTPUT_TOKEN = 0.5 / 1_000_000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

const ChatRequest = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(4000),
        }),
      )
      .min(1)
      .max(30),
  })
  .strict() // .strict() rejects any extra field, so a client cannot send its own model or system prompt.
  .refine(
    (block) => block.messages[block.messages.length - 1].role === "user",
    {
      message: "The last message must be from the user.",
      path: ["messages"], // propertyKey to which the error will be attached
    },
  );

// Express Server
const app = express();
app.use(express.json({ limit: "50kb" })); // caps the size of a JSON request body at 50 KB
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url)))); // load the static assets from the public folder

function sendEvent(response: Response, event: string, data: unknown) {
  if (response.writableEnded || response.destroyed) return;
  // JSON.stringify escapes newlines, so the data stays on one line.
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.post("/chat", async (req: Request, res: Response) => {
  const parsed = ChatRequest.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });

    return;
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: parsed.data.messages,
  });

  // Close fires on a normal finish too, so only abort when the response did not finish.
  res.on("close", () => {
    if (!res.writableFinished) {
      console.log("client disconnected, aborting the model stream");
      stream.abort();
    }
  });

  // Send headers lazily, so an error before the first text can still be a real HTTP status.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
  };

  stream.on("text", (text) => {
    start();
    sendEvent(res, "text", { text });
  });

  try {
    const finalResponse = await stream.finalMessage();
    start();
    const { input_tokens, output_tokens } = finalResponse.usage;
    const cost = input_tokens * PRICE_INPUT_TOKEN + output_tokens * PRICE_OUTPUT_TOKEN;
    console.log(`chat done | ${finalResponse.stop_reason} | ${input_tokens} in / ${output_tokens} out | $${cost.toFixed(6)}`);
    sendEvent(res, "done", { stop_reason: finalResponse.stop_reason, input_tokens, output_tokens, cost });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return; // the client left; nothing to send
    console.error("model request failed:", err); // full detail stays on the server
    if (!res.headersSent) {
      const status = err instanceof Anthropic.APIConnectionTimeoutError ? 504 : 502;
      res.status(status).json({ error: "upstream_error", message: "The model request failed." });
      return;
    }
    sendEvent(res, "error", { message: "The model request failed." });
  } finally {
    res.end();
  }

});

// Express 5 sends errors thrown in async handlers and body parsing here.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "bad_request", message: "The request could not be read." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`chat API on http://localhost:${PORT}`));

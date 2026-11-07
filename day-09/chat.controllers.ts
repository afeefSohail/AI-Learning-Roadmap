import { ChatRequest, sendEvent, toApiMessages, saveAssistant } from "./chat.utils";
import { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1000;
const SYSTEM = "You are a helpful assistant. Keep answers short and clear.";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT ?? 20); // how many recent messages are sent to the model
const PRICE_INPUT_TOKEN = 0.1 / 1_000_000;
const PRICE_OUTPUT_TOKEN = 0.5 / 1_000_000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });


const chat = async (req: Request, res: Response) => {
  const userId: string = res.locals.userId;
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

  const { conversationId, message } = parsed.data;

  // 1. Find the conversation (must belong to this user) or start a new one.
  const existingConversation = conversationId
    ? await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId: userId,
        },
        include: { messages: { orderBy: { createdAt: "desc" } } },
      })
    : null;

  if (conversationId && !existingConversation) {
    res.status(404).json({ error: "not_found" }); // someone else's and a missing id look the same
    return;
  }

  // If conversation existing or not. if not create a new one.
  const conversation =
    existingConversation ??
    (await prisma.conversation.create({
      data: {
        title: message.slice(0, 60),
        user: {
          connectOrCreate: { where: { id: userId }, create: { id: userId } },
        },
      },
    }));

  const isNewConversation = !existingConversation;

  // 2. Save the user's message first, then load the recent window (it includes that message).
  const userMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: message,
    },
  });

  // to get last 20 messages rows so he dint lose the context of that chat and also reducing input token usage.
  const rows = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT, // take => set the rows limit to get how many rows from db
  });

  // 3. Stream the reply.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: toApiMessages(rows),
  });

  // close event listener (it called when stream abort)
  res.on("close", () => {
    if (!res.writableFinished) {
      console.log("client disconnected, aborting the model stream");
      stream.abort();
    }
  });

  // If the model fails before any text, undo the saved message so a retry does not duplicate it.
  const rollback = async () => {
    await prisma.message
      .delete({ where: { id: userMessage.id } })
      .catch(() => {});

    if (isNewConversation)
      await prisma.conversation
        .delete({ where: { id: conversation.id } })
        .catch(() => {});
  };

  let started = false;
  let partial = "";
  const start = () => {
    if (started) return;
    started = true;
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    sendEvent(res, "conversation", { conversationId: conversation.id }); // the client learns the id first
  };

  //
  stream.on("text", (text) => {
    start();
    partial += text;
    sendEvent(res, "text", { text });
  });

  try {
    const final = await stream.finalMessage();

    start();

    const { input_tokens, output_tokens } = final.usage;

    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text)
      await saveAssistant(
        conversation.id,
        text,
        final.stop_reason,
        input_tokens,
        output_tokens,
      );
    const cost =
      input_tokens * PRICE_INPUT_TOKEN + output_tokens * PRICE_OUTPUT_TOKEN;
    console.log(
      `chat done | ${final.stop_reason} | ${input_tokens} in / ${output_tokens} out | $${cost.toFixed(7)}`,
    );

    sendEvent(res, "done", {
      stop_reason: final.stop_reason,
      input_tokens,
      output_tokens,
      cost: Number(cost.toFixed(7)),
    });

  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      console.log(`saving partial reply (${partial.length} characters)`);

      if (partial.trim())
        await saveAssistant(
          conversation.id,
          `${partial} [stopped by user]`,
          "aborted",
        );

      return; // the finally block still ends the response
    }

    console.error("model request failed:", err);

    if (!res.headersSent) {
      await rollback();
      const status =
        err instanceof Anthropic.APIConnectionTimeoutError ? 504 : 502;
      res.status(status).json({
        error: "upstream_error",
        message: "The model request failed.",
      });
      return;
    }

    if (partial.trim())
      await saveAssistant(
        conversation.id,
        `${partial} [interrupted by an error]`,
        "error",
      );

    sendEvent(res, "error", { message: "The model request failed." });
  } finally {
    res.end();
  }
};

const converstations = async (req: Request, res: Response) => {
  const userId: string = res.locals.userId;
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ conversations });
};


const conversation =  async (req: Request, res: Response) => {
  const userId: string = res.locals.userId;
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id as string, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ conversation });
};

export { chat, conversation, converstations};

import { Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { z } from "zod";

export const ChatRequest = z
  .object({
    conversationId: z.uuid().nullish(), // missing or null = start a new conversation
    message: z.string().min(1).max(4000),
  })
  .strict();


export function sendEvent(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// Rows come lastest first. Put them in order and make the window start with a user message.
export function toApiMessages(
  rows: { role: string; content: string }[],
): Anthropic.MessageParam[] {
  const ordered = [...rows].reverse();
  while (ordered.length > 0 && ordered[0].role !== "user") ordered.shift();
  return ordered.map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
  }));
};

export async function saveAssistant(
  conversationId: string,
  content: string,
  stopReason: string | null,
  inputTokens?: number,
  outputTokens?: number,
) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: new Date(),
      messages: {
        create: {
          role: "assistant",
          content,
          stopReason,
          inputTokens,
          outputTokens,
        },
      },
    },
  });
};
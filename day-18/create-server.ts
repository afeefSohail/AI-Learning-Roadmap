import { CLIENT_CAPABILITIES_META_KEY, inputRequired, type McpRequestContext, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createServer as createReadServer, requestState } from "../day-17/create-server";
import { ApiError, BASE_URL, getJson, UnauthorizedError, UnavailableError } from "../day-17/userauth-client";
import { OutcomeUnknownError, writeJson } from "./write-client";

export const NAME_MIN = 1;
export const NAME_MAX = 100; // my choice for the tool. The API has no limit yet.

export const NOT_FOUND = "Photo not found, or you do not have permission to delete it.";
export const CANNOT_ASK = "This client cannot ask the user for confirmation, so the photo was not deleted.";
export const CANCELLED = "Deletion cancelled. The photo was not deleted.";
const unknownOutcome = (what: string, check: string) =>
  `The request failed and ${what} may or may not have happened. Do not call this tool again. ${check}`;

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const say = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

function bearerToken(ctx: McpRequestContext): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(ctx.requestInfo?.headers.get("authorization") ?? "")?.[1];
}

/** The key under which the answer for ONE photo travels. An answer for photo 2 never opens photo 3. */
export const confirmKey = (photoId: number) => `confirm_delete_photo_${photoId}`;

type Answer = { action?: string; content?: { confirm?: unknown } };

export function createServer(ctx: McpRequestContext): McpServer {
  const server = createReadServer(ctx); // get_me, list_photos, get_photo from Day 17
  const token = bearerToken(ctx);

  /** A 401 from the API (or no token) becomes an HTTP 401 in the wrapper. Nothing ran. */
  function authRequired() {
    const state = requestState.getStore();
    if (state) state.unauthorized = true;
    return fail("Authentication required.");
  }

  function failure(err: unknown, tool: string, what: string, check: string) {
    if (err instanceof UnauthorizedError) return authRequired();
    if (err instanceof OutcomeUnknownError) {
      console.error(`${tool}: outcome unknown (${err.message})`);
      return fail(unknownOutcome(what, check));
    }
    if (err instanceof ApiError) return fail(err.message);
    console.error(`${tool} failed:`, err);
    return fail("Internal error in the UserAuth tool. Please try again later.");
  }

  server.registerTool(
    "update_profile",
    {
      title: "Update my name",
      description: `Change the signed-in user's display name (${NAME_MIN} to ${NAME_MAX} characters). The old name is overwritten. The email cannot be changed.`,
      inputSchema: z.object({ name: z.string().trim().min(NAME_MIN).max(NAME_MAX).describe("The new display name") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }, c) => {
      if (!token) return authRequired();
      try {
        const u = (await writeJson("PATCH", "/user/me", token, { name }, c.mcpReq.signal)) as { id: number; email: string; name: string };
        return asText({ id: u.id, email: u.email, name: u.name });
      } catch (err) {
        return failure(err, "update_profile", "the update", "Check with get_me, or tell the user.");
      }
    },
  );

  server.registerTool(
    "delete_photo",
    {
      title: "Delete one of my photos",
      description:
        "Permanently delete one of the signed-in user's photos by its ID (from list_photos). This cannot be undone. The user is asked to confirm first.",
      inputSchema: z.object({ photoId: z.number().int().positive().describe("The photo's ID, from list_photos") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ photoId }, c) => {
      if (!token) return authRequired();
      const key = confirmKey(photoId);
      const answer = (c.mcpReq.inputResponses as Record<string, Answer> | undefined)?.[key];

      if (answer === undefined) {
        // Round 1. Fail closed BEFORE any API call if the client cannot ask the user.
        const caps = (c.mcpReq.envelope as Record<string, { elicitation?: unknown } | undefined> | undefined)?.[CLIENT_CAPABILITIES_META_KEY];
        if (!caps?.elicitation) return fail(CANNOT_ASK);
        // Look the photo up, so a 401 or a 404 shows up before the user is asked anything.
        let photo: { id: number; url: string };
        try {
          photo = (await getJson(`/user/photos/${photoId}`, token, c.mcpReq.signal)) as { id: number; url: string };
        } catch (err) {
          if (err instanceof UnauthorizedError) return authRequired();
          if (err instanceof ApiError && err.status === 404) return fail(NOT_FOUND);
          if (err instanceof ApiError) return fail(err.message);
          if (err instanceof UnavailableError) return fail("The service is unavailable. Nothing was deleted. Do not retry; tell the user.");
          console.error("delete_photo lookup failed:", err);
          return fail("Internal error in the UserAuth tool. Please try again later.");
        }
        const url = photo.url.startsWith("http") ? photo.url : `${BASE_URL()}${photo.url}`;
        return inputRequired({
          inputRequests: {
            [key]: inputRequired.elicit({
              message: `Delete photo ${photoId}? This permanently removes the photo and its file and cannot be undone.\n${url}`,
              requestedSchema: z.object({ confirm: z.boolean() }),
            }),
          },
        });
      }

      // Round 2. Only an explicit accept with confirm: true deletes. Decline, cancel or anything else does not.
      if (answer.action !== "accept" || answer.content?.confirm !== true) return say(CANCELLED);
      try {
        await writeJson("DELETE", `/user/photos/${photoId}`, token, undefined, c.mcpReq.signal);
        return say(`Photo ${photoId} was deleted.`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return fail(NOT_FOUND);
        return failure(err, "delete_photo", "the deletion", "Check with list_photos, or tell the user. Do not use get_photo for this: its 404 means both deleted and never existed.");
      }
    },
  );

  return server;
}

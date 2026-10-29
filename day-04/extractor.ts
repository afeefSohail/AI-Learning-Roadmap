import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-5-5";
const MAX_RETRIES = 2;

const SYSTEM = "Extract the requested data from the user's text. Reply with a single JSON object and nothing else.";
 
export async function extract<T extends z.ZodType>(
  schema: T,
  userText: string,
  opts: { useSchema: boolean }
) {
    // Zod -> JSON Schema (the API only needs the shape, not Zod's custom rules)
    const jsonSchema = z.toJSONSchema(schema) as Record<string, any>;
    delete jsonSchema.$schema; // Remove the $schema property to avoid confusion

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];
    let total_Input_Tokens = 0;
    let total_Output_Tokens = 0;
    let lastError = "";
    const system = opts.useSchema 
    ? SYSTEM 
    : `${SYSTEM}\nThe JSON must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
 
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {

        console.log("useSchema:", opts.useSchema);
        
        const response = await client.messages.create({
            model: MODEL,
            max_tokens: 1000,
            system: system,
            messages: messages,
            ...(opts.useSchema ? { output_config: { format: { type: "json_schema" as const, schema: jsonSchema } } } : {}),
        });

            total_Input_Tokens += response.usage.input_tokens;
            total_Output_Tokens += response.usage.output_tokens;

            // right: throws only on max_tokens, refusal, or anything unexpected
            if (response.stop_reason !== "end_turn") {
                throw new Error(`Stopped with "${response.stop_reason}", so the JSON may be incomplete`);
            }

            const raw = response.content
            .filter((content) => content.type === "text")
            .map((content) => content.text)
            .join("")
            .replace(/^```(?:json)?\s*|\s*```$/g, "")
            .trim();

            let problem : string;
            try{
                const parsed = schema.safeParse(JSON.parse(raw));
                if (parsed.success) {
                   return { data: parsed.data as z.infer<T>, attempts: attempt, inputTokens: total_Input_Tokens, outputTokens: total_Output_Tokens};
                }

                problem = parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("\n");

            } catch (error) {
                problem = "The reply was not valid JSON.";
            }

            lastError = `Attempt ${attempt + 1} failed: ${problem}`;

            // Repair: show the model its own answer and exactly what was wrong
            messages.push({ role: "assistant", content: response.content });
            messages.push({ role: "user", content: `The previous JSON was invalid. ${problem}. Please try again.` });
    }

    throw new Error(`Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
}
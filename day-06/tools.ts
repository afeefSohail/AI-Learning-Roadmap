import { input, z, ZodAny } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

//   tools: [
//     {
//       name: "get_weather",
//       description: "Get the current weather in a given location",
//       input_schema: {
//         type: "object",
//         properties: {
//           location: {
//             type: "string",
//             description: "The city and state, e.g. San Francisco, CA"
//           }
//         },
//         required: ["location"]
//       }
//     }
//   ],
//   tool_choice: { type: "tool", name: "get_weather" },
//   messages: [{ role: "user", content: "What's the weather like in San Francisco?" }]

function defineTool<Schema extends z.ZodType>(
  name: string,
  description: string,
  schema: Schema,
  run: (input: z.infer<Schema>) => string,
) {
  return { name, description, schema, run: run as (input: unknown) => string };
}

const calculator = defineTool(
  "calculator",
  "Performs exact arithmetic on two numbers. Use this for any calculation instead of working it out yourself.",
  z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number().describe("the first number"),
    b: z.number().describe("the second number"),
  }),
  ({ operation, a, b }) => {
    if (operation === "divide" && b === 0)
      throw new Error("Cannot divide by zero.");
    const result = {
      add: a + b,
      subtract: a - b,
      multiply: a * b,
      divide: a / b,
    }[operation];
    return String(result);
  },
);

const getCurrentTime = defineTool(
  "get_current_time",
  "Returns the current date and time in an IANA time zone such as Asia/Karachi or America/New_York. Use this whenever the user asks about the current time or date. You cannot know it otherwise.",
  z.object({
    timezone: z.string().describe("IANA time zone name, e.g. Asia/Tokyo"),
  }),
  ({ timezone }) => {
    const text = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, // throws RangeError for an unknown zone
      dateStyle: "full",
      timeStyle: "long",
    }).format(new Date());
    return `${text} (${timezone})`;
  },
);

const tools = [calculator, getCurrentTime];

// What we send to the API: one Zod schema is the source of truth
export const toolDefinitions: Anthropic.Tool[] = tools.map((tool) => {
  const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Tool["input_schema"],
  };
});

// Run a tool the model asked for. Never throws: failures become an error result.
export function executeTool(
  name: string,
  input: unknown,
): { content: string; isError: boolean } {
  const tool = tools.find((tool) => tool.name === name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };

  const parsed = tool.schema.safeParse(input);

  if (!parsed.success) {
    const problems = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");

    return { content: `Invalid input: ${problems}`, isError: true };
  }

  try {
    return { content: tool.run(parsed.data), isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  const response = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 300,
    messages: [
        //{ role: "user", content: "Hello, how are you?" },
        { role: "user", content: "Explain what an LLM token is in two sentences." },
      ],
  });

  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    }
  }

  console.log("\nStop reason:", response.stop_reason);
  console.log("Tokens used:", response.usage);
}

main().catch((error) => {
  console.error("Error:", error);
});
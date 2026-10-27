import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process";

const client = new Anthropic();
const MODEL = "claude-haiku-5-5";

// Example values for USD per million tokens (update with actual pricing from the provider if needed)
const INPUT_PRICE_PER_MILLION = 0.10;
const OUTPUT_PRICE_PER_MILLION = 0.50;

const SYSTEM = "You are a friendly tutor helping an iOS developer learn AI engineering. Keep answers short.";

const messages: Anthropic.MessageParam[] = []; // the conversation history
let total_Input_Tokens = 0;
let total_Output_Tokens = 0;

const rl = readline.createInterface({ input, output });
console.log('Chat started. Type "exit" to quit.\n');

while (true) {
  const userInput = (await rl.question("You: ")).trim();

  if (!userInput) continue;

  if (userInput.toLowerCase() === "exit") break;
  
  messages.push({ role: "user", content: userInput });

try {
    const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500, // 20 for testing max token cut-off, 500 for normal usage
    system: SYSTEM,
    messages: messages, // the whole history, every time. [
    // { role: "user", content: userInput }] //if you dont want to keep history, just send the last user message
  });

    
  // Save the reply so the next turn includes it
  messages.push({role: "assistant", content: response.content});

  const reply =  response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    
    console.log(`\nClaude: ${reply}`);
    if (response.stop_reason === "max_tokens") console.log("(reply was cut off by max_tokens)");

  // Update token counts
  const { input_tokens, output_tokens } = response.usage;
  total_Input_Tokens += input_tokens;
  total_Output_Tokens += output_tokens;
  
  const cost = (total_Input_Tokens * INPUT_PRICE_PER_MILLION + total_Output_Tokens * OUTPUT_PRICE_PER_MILLION) / 1_000_000;
  
  // Display token usage and estimated cost
  const inputCost = (total_Input_Tokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (total_Output_Tokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;

  console.log(`\nTotal Input Tokens: ${total_Input_Tokens}, Total Output Tokens: ${total_Output_Tokens}`);
  console.log(`Estimated Cost: $${cost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})\n`);


} catch (error) {
    messages.pop();   // remove the failed user message so roles keep alternating
    console.error("Request failed:", error instanceof Error ? error.message : error);
  }
}

rl.close();
console.log(`Total: ${total_Input_Tokens} input + ${total_Output_Tokens} output tokens`);

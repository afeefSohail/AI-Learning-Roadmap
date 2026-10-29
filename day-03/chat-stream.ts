import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const Model = "claude-haiku-5-5";

// Example values for USD per million tokens (update with actual pricing from the provider if needed)
const INPUT_PRICE_PER_MILLION = 0.10;
const OUTPUT_PRICE_PER_MILLION = 0.50;


const SYSTEM = "You are a friendly tutor helping an iOS developer learn AI engineering.";
const messages: Anthropic.MessageParam[] = []; // the conversation history
let total_Input_Tokens = 0;
let total_Output_Tokens = 0;
let current: ReturnType<typeof client.messages.stream> | null = null;

const rl = readline.createInterface({ input, output });

// Ctrl+C stops the current reply; if nothing is streaming, it quits
rl.on("SIGINT", () => {
  if (current) current.abort();
  else {
    rl.close();
    process.exit(0);
  }
});


while (true) {
  const userInput = await rl.question("You: ");
  userInput.trim();

  if (!userInput) continue;

  if (userInput.toLowerCase() === "exit") break;
  
    messages.push({ role: "user", content: userInput });
    
    const start = performance.now();
    let firstTokenAt = 0;
    let partial = "";

    const stream = client.messages.stream({
      model: Model,
      max_tokens: 1000,
      system: SYSTEM,
      messages: messages,
    });

    current = stream;

    output.write("\nClaude: ");

    stream.on("text", (delta) => {
        if (!firstTokenAt) firstTokenAt = performance.now(); // record time of first token
        partial += delta;
        output.write(delta);
    });

    try {
        const finalResponse = await stream.finalMessage(); // resolves when the stream ends
        messages.push({ role: "assistant", content: finalResponse.content });
        
        // Stream end time
        const end = performance.now();

        // Update token counts
        total_Input_Tokens += finalResponse.usage.input_tokens;
        total_Output_Tokens += finalResponse.usage.output_tokens;

        // Calculate cost
        const cost = (total_Input_Tokens * INPUT_PRICE_PER_MILLION + total_Output_Tokens * OUTPUT_PRICE_PER_MILLION) / 1_000_000;
        
        // Calculate time to first token 
        const ttft = Math.round(firstTokenAt - start);

        // Calculate total time for the response
        const total = Math.round(end - start);

        console.log(`\n\nFirst text after: ${ttft} ms \n`);
        console.log(`Total time for response: ${total} ms\n`);
        console.log(`Input Tokens: ${finalResponse.usage.input_tokens} | Output Tokens: ${finalResponse.usage.output_tokens}\n`);
        console.log(`Session Cost: $${cost.toFixed(6)}\n`);
                
    } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError) {
            console.log("\n(stopped)\n");
            // Keep what was already said so the conversation still makes sense
            if (partial) messages.push({ role: "assistant", content: `${partial} [stopped by user]` });
            else messages.pop();
        } else {
            messages.pop();
            console.error("\nRequest failed:", error instanceof Error ? error.message : error);
        }
    } finally {
        current = null;
    }   
}

rl.close();
console.log(`Total: ${total_Input_Tokens} input + ${total_Output_Tokens} output tokens`);

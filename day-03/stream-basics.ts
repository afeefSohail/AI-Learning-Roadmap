import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const Model = "claude-haiku-5-5";
const prompt = "Explain how URLSession works in about 200 words.";

// 1) Without streaming: wait for the whole reply
let startTime = performance.now();
await client.messages.create({
  model: Model,
  max_tokens: 1000,
  messages: [{ role: "user", content: prompt}],
});
let endTime = performance.now();
console.log(`Without streaming: nothing to show for ${Math.round(endTime - startTime)} ms\n`);

// 2) With streaming: look at every event
startTime = performance.now();
let firstTokenAt = 0;
let chunks = 0;

const stream = client.messages.stream({
  model: Model,
  max_tokens: 1000,
  messages: [{ role: "user", content: prompt}],
});


for await (const event of stream) {
    switch (event.type) {
        case "message_start":
            console.log(`[message_start] input tokens: ${event.message.usage.input_tokens}`);
            break;
        case "content_block_start":
            console.log(`[content_block_start] type: ${event.content_block.type}`);
            break;
        case "content_block_delta":
            if (event.delta.type === "text_delta") {
                if (!firstTokenAt) firstTokenAt = performance.now();
                chunks++;
                process.stdout.write(event.delta.text);
            }
            break;
        case "content_block_stop":
            console.log("\n[content_block_stop]");
            break;
        case "message_delta":
            console.log(`[message_delta] stop_reason: ${event.delta.stop_reason}, output tokens: ${event.usage.output_tokens}`);
            break;
        case "message_stop":
            console.log("[message_stop]");
            break;
        default:
            console.log("\n\nUnknown event:", event);
    }

}
endTime = performance.now();
console.log(`\nFirst text after: ${Math.round(firstTokenAt - startTime)} ms`);
console.log(`Full reply after: ${Math.round(endTime - startTime)} ms`);
console.log(`Text chunks received: ${chunks}`);


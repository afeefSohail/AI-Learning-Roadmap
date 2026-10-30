"use strict";

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { cases } from "./cases";
import { LABELS, templates, type Label, type Style } from "./templates";
import { file } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-5-5";
const REPEATS = 3; // same input, several runs, to check consistency
const PRICE_IN = 0.10; // USD per million tokens
const PRICE_OUT = 0.50;

function parseLabel(reply: string): Label | null {
  const found = LABELS.filter((l) => new RegExp(`\\b${l}\\b`, "i").test(reply));
  return found.length === 1 ? found[0] : null;
}

async function classify(style: Style, text: string) {
  const prompt = templates[style](text);
  const start = performance.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });

  const reply = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    reply,
    label: parseLabel(reply),
    strict: (LABELS as readonly string[]).includes(reply), // reply is exactly a label, nothing else
    stopReason: response.stop_reason,
    inputTokens: response.usage.input_tokens,
    outputToken: response.usage.output_tokens,
    ms: Math.round(performance.now() - start),
  };
}

const styles = Object.keys(templates) as Style[];
const results: any[] = [];

for (const style of styles) {
  for (const testCase of cases) {
    const runs = await Promise.all(
      Array.from({ length: REPEATS }, () => classify(style, testCase.text)),
    );
    for (const run of runs) {
      results.push({
        style,
        text: testCase.text,
        expected: testCase.expected,
        ...run,
      });
    }
    process.stdout.write(".");
  }
}
console.log("\n");

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const summary = styles.map((style) => {
  const rows = results.filter((r) => r.style === style);
  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
  const consistent = cases.filter(
    (testCase) =>
      new Set(
        rows
          .filter((row) => row.text === testCase.text)
          .map((row) => row.label),
      ).size === 1,
  ).length;

  const avgInputTokens = avg(rows.map((row) => row.inputTokens));
  const avgOutTokens = avg(rows.map((r) => r.outputToken));

  return {
    style,
    "exact format": pct(rows.filter((r) => r.strict).length),
    accuracy: pct(rows.filter((r) => r.label === r.expected).length),
    "consistent cases": `${consistent}/${cases.length}`,
    "cut off": rows.filter((r) => r.stopReason === "max_tokens").length,
    "avg in": Math.round(avgInputTokens),
    "avg out": Math.round(avgOutTokens),
    "avg ms": Math.round(avg(rows.map((r) => r.ms))),
    "$ per 1000 calls": ((avgInputTokens * PRICE_IN + avgOutTokens * PRICE_OUT) / 1000).toFixed(4),
  };
});
console.table(summary);

console.log("\nWrong or unparseable answers (first 15):");
for (const r of results.filter((r) => r.label !== r.expected).slice(0, 15)) {
  console.log(
    `${r.style.padEnd(10)} expected ${r.expected.padEnd(16)} got "${r.reply.slice(0, 60).replace(/\n/g, " ")}"  <- ${r.text.slice(0, 35)}`
  );
}

writeFileSync("day-05/results.json", JSON.stringify(results, null, 2));
console.log("\nSaved day-05/results.json");


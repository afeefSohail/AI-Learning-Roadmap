export const LABELS = [
  "billing",
  "bug",
  "feature_request",
  "general_question",
] as const;

export type Label = (typeof LABELS)[number];
export type Style = "plain" | "structured" | "fewShot";
export type Prompt = { system?: string; user: string };

const CATEGORIES = `<categories>
  <category name="billing">payments, charges, refunds, invoices, subscriptions</category>
  <category name="bug">something is broken, crashing, or not working as it should</category>
  <category name="feature_request">a request for something new or an improvement</category>
  <category name="general_question">how-to questions, account help, anything else</category>
</categories>`;

const RULES = `<rules>
- Reply with only the category name, in lowercase, and nothing else.
- If the message mixes several issues, choose the one mentioned first.
- If the message is too vague to tell, reply general_question.
</rules>`;

// These must NOT appear in cases.ts, or the test is meaningless
const EXAMPLES: [string, Label][] = [
  ["Why was I billed 15 dollars when my plan is 10?", "billing"],
  ["The app freezes on the login screen.", "bug"],
  ["It would be great to export my data as CSV.", "feature_request"],
  ["Where can I find your privacy policy?", "general_question"],
];

function structured(message: string, withExamples: boolean): Prompt {
  const examples = withExamples
    ? `\n<examples>\n${EXAMPLES.map(([m, l]) => `<example>\n<message>${m}</message>\n<category>${l}</category>\n</example>`).join("\n")}\n</examples>`
    : "";
  return {
    system: "You are a support triage assistant.",
    user: `<task>Classify the customer message into exactly one category.</task>
${CATEGORIES}
${RULES}${examples}
<message>${message}</message>`,
  };
}

export const templates: Record<Style, (messaging: string) => Prompt> = {
    plain: (message) => ({ user: `Classify this customer support message: ${message}` }),
    structured: (message) => structured(message, false),
    fewShot: (message) => structured(message, true),    
}
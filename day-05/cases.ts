"use strict";

import { Label } from "./templates";

export const cases: { text: string; expected: Label; note: string }[] = [
  {
    text: "I was charged twice for my subscription this month.",
    expected: "billing",
    note: "clear",
  },
  {
    text: "The app crashes every time I open the camera screen.",
    expected: "bug",
    note: "clear",
  },
  {
    text: "Could you add dark mode? My eyes hurt at night.",
    expected: "feature_request",
    note: "clear",
  },
  {
    text: "How do I change my profile photo?",
    expected: "general_question",
    note: "clear",
  },
  {
    text: "Please refund me, and also the export button does nothing.",
    expected: "billing",
    note: "mixed: first issue wins",
  },
  {
    text: "Mera payment cut gaya lekin subscription active nahi hui.",
    expected: "billing",
    note: "Roman Urdu",
  },
  {
    text: "Great, another update that deletes my saved drafts. Thanks a lot.",
    expected: "bug",
    note: "sarcasm",
  },
  {
    text: "It doesn't work.",
    expected: "general_question",
    note: "vague: only the rules say what to do",
  },
];

// Static option lists for the inquiry form. Kept in a plain (non-"use server")
// module so both the client InquiryForm and the server action can import them
// — Next.js requires every export from a `"use server"` file to be an async
// function, so constants have to live elsewhere.

export const BUDGETS = [
  "Under $500 / send",
  "$500–$1,000 / send",
  "$1,000–$2,500 / send",
  "$2,500+ / send",
  "Long-term (3+ months)",
  "Not sure yet",
] as const;

export const FORMATS = [
  "Sponsor line",
  "Classified",
  "Standings strip",
  "Display box",
  "Open to recommendation",
] as const;

export type Budget = (typeof BUDGETS)[number];
export type Format = (typeof FORMATS)[number];

// ============================================================
// REBEL ENGINE — Resource Snapshot (lib/resources.js)
//
// Feeds verified content to Claude before every generation call.
// Prevents hallucination of URLs, tool names, and brand facts.
//
// Two sources:
//   1. Live fetch from rebeldesigns.co.za (if RESOURCES_SUMMARY_URL is set)
//   2. Hardcoded snapshot below — always accurate, update manually
//      when you add new tools, blog posts, or projects.
// ============================================================

const LIVE_URL = process.env.RESOURCES_SUMMARY_URL;

export async function fetchResourceSnapshot() {
  if (LIVE_URL) {
    try {
      const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        return { ...data, source: "live" };
      }
    } catch {
      // Fall through to hardcoded snapshot
    }
  }

  return { ...SNAPSHOT, source: "hardcoded" };
}

// ─────────────────────────────────────────────────────────────
// HARDCODED SNAPSHOT
// Update this whenever you add new content to the site.
// ─────────────────────────────────────────────────────────────

const SNAPSHOT = {

  tools: [
    {
      name: "Password Roast",
      description: "Rates password strength with brutal, witty commentary. Built to demonstrate that security UX does not have to be boring. Client-side only — no passwords transmitted.",
      url: "https://rebeldesigns.co.za/lab/password-roast",
    },
    {
      name: "Rebel T-T-T",
      description: "A precision-designed tic-tac-toe game built to demonstrate UI craft and interaction design at a high level. Minimax algorithm, clean component architecture.",
      url: "https://rebeldesigns.co.za/lab",
    },
  ],

  blogs: [
    {
      title: "Design Rebellion",
      url: "https://rebeldesigns.co.za/blogs/design-rebellion",
      date: "2026-01-20",
      summary: "A first-hand argument against cheap DIY web development. Covers the Invisible Labour Paradox (the better the developer, the easier they make it look — which clients mistake for simplicity), the Third-Party Provider Trap (Wix/Shopify templates that break on customisation, monthly USD overhead, platform lock-in), and the Cheap Pro Cycle (hiring amateurs, then paying double to fix the mess). Core argument: doing it wrong three times costs more than doing it right once.",
      keyPoints: [
        "The budget route is often the most expensive long-term path",
        "Invisible Labour Paradox: expertise looks effortless, so clients undervalue it",
        "DIY builders create lock-in, monthly USD costs, and broken customisations",
        "The Cheap Pro Cycle: amateur work plus fixing equals double the original cost",
        "Minimum 12 months consistent work to truly understand web systems",
      ],
    },
    {
      title: "The Cup of Coffee Crisis",
      url: "https://rebeldesigns.co.za/projects/coffee-crisis",
      date: "2026",
      summary: "A real-world case study on a logistics company website so slow the author had time to grind beans, boil a kettle, and pour a full coffee before the page loaded. Audit stats: 156-second load time, 6.6MB page weight, 80% bounce rate, R8.00 average data cost per visit. Core argument: in South Africa where data is expensive, a slow website is not just a UX failure — it is a business credibility failure.",
      keyPoints: [
        "156 second load time, 6.6MB page weight, 80% bounce rate — real audited numbers",
        "R8.00 average data cost per page visit in the South African market",
        "Speed is credibility: slow website equals untrustworthy business",
        "Four fixes: compress images, prioritise render, update plugins, reduce page weight",
        "Being lightweight is a competitive advantage in the South African market",
      ],
    },
  ],

  projects: [
    {
      name: "Coffee Crisis Rebuild",
      description: "Full performance rebuild of a logistics company website. Diagnosed 156s load time, 6.6MB page weight, 80% bounce rate. Rebuilt from the ground up.",
      url: "https://rebeldesigns.co.za/projects/coffee-crisis",
    },
  ],

  brandFacts: {
    ipPolicy: "Clients own 100% of their code. No lock-in. Keys handed over on delivery.",
    complianceApproach: "POPIA/PAIA compliance engineered into every build from day one. Not a checkbox.",
    verticals: ["Shopify Hydrogen / headless", "Custom WordPress (no themes)", "Custom Web Applications"],
    location: "Johannesburg, South Africa",
    website: "rebeldesigns.co.za",
    lab: "rebeldesigns.co.za/lab",
    loot: "Free web assets and brand strategy resources at rebeldesigns.co.za/resources",
  },
};

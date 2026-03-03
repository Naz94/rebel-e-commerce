// ============================================================
// REBEL ENGINE — Trend Intelligence (lib/trends.js)
//
// Runs daily at 06:00 UTC via cron.
//
// 1. Scrapes trending topics from dev sources (no auth needed)
// 2. Monitors competitor Facebook pages for engagement signals
// 3. Claude synthesises into a strategic brief
// 4. Brief saved to Redis — injected into every generation call
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { Redis }  from "@upstash/redis";

const redis     = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRIEF_KEY = "rebel:intelligence_brief";

const TREND_SOURCES = [
  { name: "Hacker News Top", url: "https://hacker-news.firebaseio.com/v0/topstories.json", type: "hn_ids" },
  { name: "Dev.to Trending",  url: "https://dev.to/api/articles?top=7&per_page=10",         type: "devto" },
  {
    name: "GitHub Trending (JS)",
    url:  "https://api.github.com/search/repositories?q=stars:>500+pushed:>2026-01-01+language:javascript&sort=stars&order=desc&per_page=5",
    type: "github",
  },
];

const COMPETITOR_PAGES = [
  // Add public FB page IDs of SA web studios here
  // process.env.COMPETITOR_PAGE_1,
];

const FB_API = "https://graph.facebook.com/v19.0";
const TOKEN  = () => process.env.META_TOKEN;

export async function runTrendIntelligence() {
  const [devSignals, competitorSignals] = await Promise.allSettled([
    gatherDevTrends(),
    gatherCompetitorSignals(),
  ]);

  const trends     = devSignals.status     === "fulfilled" ? devSignals.value      : [];
  const competitor = competitorSignals.status === "fulfilled" ? competitorSignals.value : [];

  const brief = await synthesiseBrief(trends, competitor);

  await redis.set(BRIEF_KEY, {
    brief,
    trends,
    competitor,
    generatedAt: new Date().toISOString(),
  });

  return { brief, trendCount: trends.length, competitorSignals: competitor.length };
}

export async function getIntelligenceBrief() {
  const data = await redis.get(BRIEF_KEY);
  if (!data) return null;

  const age = Date.now() - new Date(data.generatedAt).getTime();
  if (age > 48 * 3_600_000) return null;

  return data.brief;
}

async function gatherDevTrends() {
  const signals = [];

  // Hacker News
  try {
    const idsRes = await fetch(TREND_SOURCES[0].url, { signal: AbortSignal.timeout(5000) });
    const ids    = await idsRes.json();
    const stories = await Promise.allSettled(
      ids.slice(0, 10).map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
    );
    for (const s of stories) {
      if (s.status !== "fulfilled" || !s.value?.title) continue;
      const isRelevant = /web|css|js|react|node|api|shopify|performance|security|ai|gpt|llm/i.test(s.value.title);
      if (isRelevant) signals.push({ source: "Hacker News", title: s.value.title, score: s.value.score ?? 0, url: s.value.url });
    }
  } catch { /* non-fatal */ }

  // Dev.to
  try {
    const res      = await fetch(TREND_SOURCES[1].url, { signal: AbortSignal.timeout(5000) });
    const articles = await res.json();
    for (const a of articles) {
      signals.push({ source: "Dev.to", title: a.title, score: a.positive_reactions_count ?? 0, tags: a.tag_list?.join(", ") ?? "", url: a.url });
    }
  } catch { /* non-fatal */ }

  // GitHub
  try {
    const res  = await fetch(TREND_SOURCES[2].url, { headers: { "User-Agent": "RebelDesigns-Engine/1.0" }, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    for (const repo of (data.items ?? [])) {
      signals.push({ source: "GitHub Trending", title: `${repo.name}: ${repo.description ?? ""}`, score: repo.stargazers_count, url: repo.html_url });
    }
  } catch { /* non-fatal */ }

  return signals.sort((a, b) => b.score - a.score).slice(0, 15);
}

async function gatherCompetitorSignals() {
  if (COMPETITOR_PAGES.filter(Boolean).length === 0) return [];

  const signals = [];
  for (const pageId of COMPETITOR_PAGES.filter(Boolean)) {
    try {
      const res  = await fetch(`${FB_API}/${pageId}/posts?fields=message,created_time,likes.summary(true),comments.summary(true)&limit=5&access_token=${TOKEN()}`);
      const data = await res.json();
      if (!data.data) continue;
      for (const post of data.data) {
        const engagement = (post.likes?.summary?.total_count ?? 0) + (post.comments?.summary?.total_count ?? 0);
        signals.push({ pageId, snippet: (post.message ?? "").slice(0, 200), engagement, postedAt: post.created_time });
      }
    } catch { /* non-fatal */ }
  }

  return signals.sort((a, b) => b.engagement - a.engagement).slice(0, 8);
}

async function synthesiseBrief(trends, competitor) {
  const trendSummary = trends
    .slice(0, 10)
    .map(t => `- [${t.source}] ${t.title} (score: ${t.score})`)
    .join("\n");

  const competitorSummary = competitor.length > 0
    ? competitor.map(c => `- Engagement ${c.engagement}: "${c.snippet}"`).join("\n")
    : "No competitor data available.";

  const message = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{
      role:    "user",
      content: `You are the content strategist for Rebel Designs, a premium South African web development studio.

Analyse these trending developer topics and competitor signals. Return a strategic content brief for the next 48 hours.

TRENDING DEV TOPICS:
${trendSummary}

COMPETITOR HIGH-ENGAGEMENT POSTS:
${competitorSummary}

Return a brief (max 300 words) covering:
1. The 2-3 trending topics most relevant to Rebel Designs (React, Next.js, performance, CSS, Shopify Hydrogen, SA web market)
2. Content gaps competitors are missing that Rebel Designs could own
3. A specific content angle suggestion for the next post
4. One contrarian take — a popular trend worth pushing back on

Write it as notes to the content engine, not as a finished post. Direct and specific.`,
    }],
  });

  return message.content[0].text.trim();
}

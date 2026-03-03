// ============================================================
// REBEL ENGINE — Lead Scanner (lib/leads.js)
//
// Runs every 2 hours via cron: /api/agent/scan
//
// READ ONLY. Scans comments for lead signals. Never posts.
// You see the leads. You decide what to do with them.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { Redis }  from "@upstash/redis";

const redis     = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FB_API   = "https://graph.facebook.com/v19.0";
const TOKEN    = () => process.env.META_TOKEN;
const SEEN_KEY = "rebel:seen_comments";
const LEADS_KEY = "rebel:leads";

const SPAM_PATTERNS = [
  /follow\s*for\s*follow/i,
  /dm\s*me\s*to\s*collab/i,
  /check\s*my\s*profile/i,
  /get\s*\d+\s*followers/i,
  /link\s*in\s*bio/i,
  /🔥{3,}/,
  /💯{2,}/,
  /^(nice|great|awesome|cool|love\s*it)\s*[!.]*$/i,
];

export async function runLeadScanner() {
  const published = (await redis.get("rebel:published_posts")) ?? [];
  if (published.length === 0) return { scanned: 0, leadsFound: 0 };

  const cutoff = Date.now() - 14 * 24 * 3_600_000;
  const recent = published.filter(p => new Date(p.publishedAt).getTime() > cutoff);
  const seen   = new Set((await redis.smembers(SEEN_KEY)) ?? []);

  let scanned    = 0;
  let leadsFound = 0;

  for (const record of recent) {
    const comments = await fetchComments(record.postId, record.platform);

    for (const comment of comments) {
      if (seen.has(comment.id)) continue;
      if (isSpam(comment.text))  continue;

      scanned++;
      await redis.sadd(SEEN_KEY, comment.id);

      const analysis = await scoreComment(comment.text);

      if (analysis.leadScore >= 3) {
        await saveLead({ comment, record, analysis });
        leadsFound++;
      }
    }
  }

  return { scanned, leadsFound };
}

export async function getLeads() {
  return (await redis.get(LEADS_KEY)) ?? [];
}

export async function updateLeadStatus(commentId, status) {
  const leads   = await getLeads();
  const updated = leads.map(l => l.commentId === commentId ? { ...l, status } : l);
  await redis.set(LEADS_KEY, updated);
  return updated;
}

async function fetchComments(postId, platform) {
  try {
    const res  = await fetch(`${FB_API}/${postId}/comments?fields=id,message,from,timestamp&access_token=${TOKEN()}`);
    const data = await res.json();
    if (!res.ok || !data.data) return [];

    return data.data.map(c => ({
      id:        c.id,
      text:      c.message ?? "",
      from:      c.from?.name ?? "Unknown",
      fromId:    c.from?.id,
      timestamp: c.timestamp,
      platform,
    }));
  } catch {
    return [];
  }
}

function isSpam(text) {
  if (!text || text.length < 5) return true;
  return SPAM_PATTERNS.some(p => p.test(text));
}

async function scoreComment(text) {
  const message = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 150,
    messages: [{
      role:    "user",
      content: `Score this social media comment for a web development studio called Rebel Designs.

Comment: "${text}"

Return JSON only:
{
  "intent": "question|pricing_inquiry|project_inquiry|compliment|general",
  "leadScore": 1-5,
  "summary": "one sentence — what is this person saying or asking?"
}

leadScore:
1 = generic (emoji, "nice post")
2 = positive but no intent
3 = question about services or tools
4 = asking about pricing or process
5 = ready-to-hire ("how do we start", "need a website", "what do you charge")`,
    }],
  });

  try {
    return JSON.parse(message.content[0].text.trim());
  } catch {
    return { intent: "general", leadScore: 1, summary: text.slice(0, 80) };
  }
}

async function saveLead({ comment, record, analysis }) {
  const leads = await getLeads();
  if (leads.some(l => l.commentId === comment.id)) return;

  leads.push({
    commentId:  comment.id,
    text:       comment.text,
    from:       comment.from,
    fromId:     comment.fromId,
    platform:   comment.platform,
    postId:     record.postId,
    rotationId: record.rotationId,
    leadScore:  analysis.leadScore,
    intent:     analysis.intent,
    summary:    analysis.summary,
    status:     "new",
    foundAt:    new Date().toISOString(),
  });

  await redis.set(LEADS_KEY, leads.slice(-500));
}

// ============================================================
// REBEL ENGINE — Performance Brain (lib/performance.js)
//
// Runs every 6 hours via cron: /api/agent/analyze
//
// For every published post:
//   1. Pulls Meta Insights (likes, reach, engagement, saves, clicks)
//   2. Scores the post 0–100
//   3. Saves score to Redis
//   4. Re-weights rotation priorities based on what is working
//
// Rotation IDs: value_react, value_perf, value_css, value_debug,
//               lab_tool, lab_template
// ============================================================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FB_API   = "https://graph.facebook.com/v19.0";
const TOKEN    = () => process.env.META_TOKEN;

const PUBLISHED_KEY = "rebel:published_posts";
const SCORES_KEY    = "rebel:post_scores";
const WEIGHTS_KEY   = "rebel:rotation_weights";

// ─────────────────────────────────────────────────────────────
// PUBLIC — called by /api/agent/analyze
// ─────────────────────────────────────────────────────────────

export async function runPerformanceBrain() {
  const published = (await redis.get(PUBLISHED_KEY)) ?? [];
  if (published.length === 0) return { analysed: 0, message: "No published posts yet" };

  const now      = Date.now();
  const analysed = [];

  for (const record of published) {
    const ageHours = (now - new Date(record.publishedAt).getTime()) / 3_600_000;

    // Only analyse posts 24h+ old, not yet finally scored at 7d+
    if (ageHours < 23 || ageHours > 168 * 2) continue;

    const alreadyScored = await redis.hget(SCORES_KEY, record.postId);
    if (alreadyScored?.final) continue;

    const insights = await fetchMetaInsights(record.postId, record.platform);
    if (!insights) continue;

    const score = scorePost(insights, ageHours);

    await redis.hset(SCORES_KEY, {
      [record.postId]: {
        ...insights,
        score,
        rotationId:  record.rotationId,
        platform:    record.platform,
        ageHours:    Math.round(ageHours),
        final:       ageHours >= 144,
        scoredAt:    new Date().toISOString(),
        publishedAt: record.publishedAt,
      },
    });

    analysed.push({ postId: record.postId, score, rotationId: record.rotationId });
  }

  if (analysed.length > 0) {
    await reweightRotations();
  }

  return { analysed: analysed.length, posts: analysed };
}

// ─────────────────────────────────────────────────────────────
// REGISTER a newly published post
// ─────────────────────────────────────────────────────────────

export async function registerPublishedPost({ postId, platform, rotationId, runId }) {
  const existing = (await redis.get(PUBLISHED_KEY)) ?? [];
  existing.push({ postId, platform, rotationId, runId, publishedAt: new Date().toISOString() });
  await redis.set(PUBLISHED_KEY, existing.slice(-200));
}

// ─────────────────────────────────────────────────────────────
// GET WEIGHTS — used by fire.js to pick rotation
// ─────────────────────────────────────────────────────────────

export async function getRotationWeights() {
  const weights = await redis.hgetall(WEIGHTS_KEY);

  return {
    // Pure Value rotations
    value_react:  Number(weights?.value_react  ?? 50),
    value_perf:   Number(weights?.value_perf   ?? 50),
    value_css:    Number(weights?.value_css    ?? 50),
    value_debug:  Number(weights?.value_debug  ?? 50),
    // Lab Showcase rotations
    lab_tool:     Number(weights?.lab_tool     ?? 50),
    lab_template: Number(weights?.lab_template ?? 50),
  };
}

// ─────────────────────────────────────────────────────────────
// FETCH INSIGHTS from Meta
// ─────────────────────────────────────────────────────────────

async function fetchMetaInsights(postId, platform) {
  try {
    const fields = platform === "instagram"
      ? "like_count,comments_count,saved,reach,impressions,shares_count"
      : "likes.summary(true),comments.summary(true),shares,reach,impressions";

    const res  = await fetch(`${FB_API}/${postId}?fields=${fields}&access_token=${TOKEN()}`);
    const data = await res.json();
    if (!res.ok || data.error) return null;

    if (platform === "instagram") {
      return {
        likes:       data.like_count        ?? 0,
        comments:    data.comments_count    ?? 0,
        saves:       data.saved             ?? 0,
        reach:       data.reach             ?? 0,
        impressions: data.impressions       ?? 0,
        shares:      data.shares_count      ?? 0,
      };
    } else {
      return {
        likes:       data.likes?.summary?.total_count    ?? 0,
        comments:    data.comments?.summary?.total_count ?? 0,
        saves:       0,
        reach:       data.reach       ?? 0,
        impressions: data.impressions ?? 0,
        shares:      data.shares?.count ?? 0,
      };
    }
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// SCORE a post 0–100
// Saves and comments weighted most — brand-building signals
// ─────────────────────────────────────────────────────────────

function scorePost(insights, ageHours) {
  const { likes, comments, saves, reach, impressions, shares } = insights;

  const engagements = likes + (comments * 3) + (saves * 5) + (shares * 4);
  const engRate     = reach > 0 ? (engagements / reach) * 100 : 0;
  const reachEff    = impressions > 0 ? (reach / impressions) * 100 : 0;

  const rawScore = Math.min(100,
    (engRate   * 4.0) +
    (reachEff  * 0.5) +
    (saves     * 2.0) +
    (comments  * 1.5) +
    (shares    * 1.0)
  );

  return Math.round(rawScore);
}

// ─────────────────────────────────────────────────────────────
// RE-WEIGHT rotations by historical average score
// Normalises to 30–95 range within each type group
// ─────────────────────────────────────────────────────────────

async function reweightRotations() {
  const allScores = await redis.hgetall(SCORES_KEY);
  if (!allScores) return;

  const byRotation = {};
  for (const [, data] of Object.entries(allScores)) {
    const r = data.rotationId;
    const s = data.score ?? 0;
    if (!r) continue;
    if (!byRotation[r]) byRotation[r] = [];
    byRotation[r].push(s);
  }

  const averages = {};
  for (const [rotId, scores] of Object.entries(byRotation)) {
    averages[rotId] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const maxAvg = Math.max(...Object.values(averages), 1);
  const newWeights = {};
  for (const [rotId, avg] of Object.entries(averages)) {
    newWeights[rotId] = Math.round(30 + (avg / maxAvg) * 65);
  }

  await redis.hset(WEIGHTS_KEY, newWeights);
}

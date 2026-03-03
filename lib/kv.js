// ============================================================
// REBEL ENGINE — Redis Helpers (lib/kv.js)
//
// Uses Upstash Redis.
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are
// injected automatically via the Vercel + Upstash integration.
// ============================================================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ROTATION_KEY = "rebel:rotation_index";
const TOPICS_KEY   = "rebel:posted_topics";

// ─────────────────────────────────────────────────────────────
// ROTATION INDEX (sequential fallback)
// ─────────────────────────────────────────────────────────────

export async function getAndAdvanceRotation() {
  const current = (await redis.get(ROTATION_KEY)) ?? 0;
  await redis.set(ROTATION_KEY, (Number(current) + 1) % 6); // 6 rotations now
  return Number(current);
}

// ─────────────────────────────────────────────────────────────
// POST HISTORY — anti-repetition memory
// Stores up to 50 posts. Injected into every Claude prompt.
// ─────────────────────────────────────────────────────────────

export async function getPostedTopics() {
  return (await redis.get(TOPICS_KEY)) ?? [];
}

export async function savePostedTopic(record) {
  const topics = await getPostedTopics();
  topics.push(record);
  await redis.set(TOPICS_KEY, topics.slice(-50));
}

// ─────────────────────────────────────────────────────────────
// MONITORING
// ─────────────────────────────────────────────────────────────

export async function saveLastRun(result) {
  await redis.set("rebel:last_run", {
    ...result,
    timestamp: new Date().toISOString(),
  });
}

export async function getLastRun() {
  return await redis.get("rebel:last_run");
}

// ============================================================
// REBEL ENGINE — Draft Store (lib/drafts.js)
//
// Draft lifecycle:
//   pending   → generated, waiting for review
//   approved  → approve clicked, publish in progress
//   published → live on FB + IG
//   rejected  → discarded
//   failed    → Meta returned an error
//   regenerated → copy was regenerated (old draft archived)
// ============================================================

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const DRAFTS_KEY = "rebel:drafts";
const QUEUE_KEY  = "rebel:queue";

function generateId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function saveDraft(data) {
  const draft = { ...data, id: generateId() };
  await redis.hset(DRAFTS_KEY, { [draft.id]: JSON.stringify(draft) });
  await redis.lpush(QUEUE_KEY, draft.id);
  return draft;
}

export async function getAllDrafts() {
  const ids = await redis.lrange(QUEUE_KEY, 0, 49);
  if (!ids || ids.length === 0) return [];

  const raw = await redis.hmget(DRAFTS_KEY, ...ids);
  return raw
    .filter(Boolean)
    .map(r => typeof r === "string" ? JSON.parse(r) : r)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getPendingDrafts() {
  const all = await getAllDrafts();
  return all.filter(d => d.status === "pending");
}

export async function getDraft(id) {
  const raw = await redis.hget(DRAFTS_KEY, id);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function updateDraft(id, updates) {
  const existing = await getDraft(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await redis.hset(DRAFTS_KEY, { [id]: JSON.stringify(updated) });
  return updated;
}

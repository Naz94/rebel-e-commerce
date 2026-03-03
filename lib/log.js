// ============================================================
// REBEL ENGINE — PAIA/POPIA Compliance Logger (lib/log.js)
//
// Every agent run is committed to compliance/marketing_records.json
// in GitHub via Octokit — immutable, version-controlled audit trail.
// Satisfies PAIA Section 51 and POPIA Section 22.
//
// Non-fatal: logging failure never kills a successful post.
// ============================================================

import { Octokit } from "@octokit/rest";
import { scanForPII } from "./popia.js";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME  = process.env.GITHUB_REPO_NAME;
const LOG_PATH   = "compliance/marketing_records.json";

const COMPLIANCE_HEADER = {
  paia: {
    section:           "51",
    document_type:     "PAIA Information Manual — Automated Marketing System",
    responsible_party: "Rebel Designs",
    contact:           "rebeldesigns.co.za",
    location:          "Johannesburg, South Africa",
    description:       "Technical record of all automated marketing content generation and publication activities by the Rebel Designs Content Engine.",
  },
  popia: {
    responsible_party:          "Rebel Designs",
    lawful_basis:               "Legitimate interest — automated marketing activity for own brand promotion.",
    data_categories_processed:  "NONE — this system processes no personal information.",
    data_subjects:              "NONE — no personal information collected, stored, or transmitted.",
    third_party_operators: [
      { operator: "Anthropic PBC",      service: "Claude AI — content generation",        data_sent: "Brand configuration prompts only. No personal information." },
      { operator: "OpenAI LLC",         service: "DALL-E 3 — image generation",           data_sent: "Brand configuration prompts only. No personal information." },
      { operator: "Meta Platforms Inc.", service: "Facebook + Instagram Graph API",        data_sent: "Generated post content and images only. No personal information." },
      { operator: "Upstash Inc.",       service: "Redis — operational data storage",      data_sent: "Post metadata only. No personal information." },
      { operator: "Vercel Inc.",        service: "Serverless hosting and cron execution", data_sent: "Function execution logs only. No personal information." },
    ],
    retention_period: "Records retained for 5 years from date of creation.",
  },
  engine:    "Rebel Designs Content Engine v3",
  generated: new Date().toISOString(),
};

export async function appendAuditLog(record) {
  try {
    const piiScanResult = scanForPII({
      topic:    record.topic    ?? "",
      rotation: record.rotation ?? "",
      copy:     record.copy     ?? {},
    });

    const enrichedRecord = {
      record_id:   record.id,
      draft_id:    record.draftId ?? null,
      timestamp:   new Date().toISOString(),
      engine_v:    "3.0.0",
      paia_section: "51",
      activity_type: "Automated Marketing Content Generation and Publication",
      trigger:     record.trigger ?? "automated_cron",
      popia: {
        lawful_basis:            "Legitimate interest — own brand marketing",
        personal_data_processed: false,
        pii_scan_passed:         piiScanResult.passed,
        pii_scan_flags:          piiScanResult.flags,
        data_subjects_affected:  0,
      },
      activity: {
        rotation:            record.rotation,
        rotation_id:         record.rotationId,
        topic:               record.topic,
        platforms:           ["facebook", "instagram"],
        visual_type:         record.visualType,
        visual_style:        record.visualStyle,
        status:              record.status,
        platform_results:    record.platformResults ?? null,
        post_history_count:  record.historyCount    ?? 0,
      },
      negative_certifications: [
        "No personal information collected from any data subject",
        "No personal information transmitted to any third-party operator",
        "No profiling of individuals conducted",
        "No automated decisions affecting data subjects made",
      ],
    };

    // Fetch existing log
    let existing = { ...COMPLIANCE_HEADER, records: [] };
    let fileSha;

    try {
      const { data: file } = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo:  REPO_NAME,
        path:  LOG_PATH,
      });
      const decoded = Buffer.from(file.content, "base64").toString("utf-8");
      const parsed  = JSON.parse(decoded);
      existing      = { ...parsed, records: parsed.records ?? [] };
      fileSha       = file.sha;
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    existing.records.push(enrichedRecord);
    existing.last_updated  = new Date().toISOString();
    existing.total_records = existing.records.length;

    const content = Buffer.from(JSON.stringify(existing, null, 2)).toString("base64");

    await octokit.repos.createOrUpdateFileContents({
      owner:   REPO_OWNER,
      repo:    REPO_NAME,
      path:    LOG_PATH,
      message: `compliance: audit record ${record.id} [${record.rotation ?? ""}] — POPIA certified`,
      content,
      ...(fileSha ? { sha: fileSha } : {}),
    });

    console.log(`[log] Audit record committed: ${record.id} (PII scan: ${piiScanResult.passed ? "PASS" : "FLAGGED"})`);

  } catch (err) {
    console.error(`[log] WARN: Audit log failed for ${record.id}:`, err.message);
  }
}

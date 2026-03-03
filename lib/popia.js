// ============================================================
// REBEL ENGINE — POPIA PII Scanner (lib/popia.js)
//
// Scans every AI input and output for PII patterns.
// Flags but does not block — adds warning to audit record.
// Provides documented evidence the system processes no personal info.
// ============================================================

const PII_PATTERNS = [
  {
    name:    "SA ID Number",
    pattern: /\b\d{6}\s?\d{4}\s?\d{3}\b/g,
    severity: "high",
  },
  {
    name:    "Email Address",
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    severity: "high",
  },
  {
    name:    "Phone Number",
    pattern: /(\+27|0)[- ]?(\d{2})[- ]?(\d{3})[- ]?(\d{4})\b/g,
    severity: "high",
  },
  {
    name:    "Physical Address",
    pattern: /\b\d{1,5}\s+[A-Z][a-zA-Z]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Place|Pl|Close|Cl|Crescent|Cres)\b/gi,
    severity: "medium",
  },
  {
    name:    "Passport Number",
    pattern: /\b[A-Z]\s?\d{8}\b/g,
    severity: "high",
  },
  {
    name:    "Credit Card",
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    severity: "high",
  },
  {
    name:    "Bank Account",
    pattern: /\b\d{8,11}\b/g,
    severity: "low",
  },
  {
    name:    "Named Individual",
    pattern: /\b(Mr|Mrs|Ms|Dr|Prof|Adv)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
    severity: "medium",
  },
  {
    name:    "Health Data Marker",
    pattern: /\b(HIV|ARV|diagnosis|prescription|patient|medical record|clinic)\b/gi,
    severity: "high",
  },
];

export function scanForPII(content) {
  const text  = flattenToString(content);
  const flags = [];

  for (const { name, pattern, severity } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (!matches) continue;
    if (severity === "low" && matches.length < 3) continue;

    flags.push({
      type:     name,
      severity,
      count:    matches.length,
      sample:   "[REDACTED FOR POPIA COMPLIANCE]",
    });
  }

  return {
    passed:       flags.filter(f => f.severity === "high").length === 0,
    flags,
    scan_time:    new Date().toISOString(),
    content_hash: simpleHash(text),
  };
}

export function validateAgentInput(rotation, resourceSnapshot) {
  const content = {
    copyPrompt:   rotation.copyPrompt   ?? "",
    imagePrompt:  rotation.imagePrompt  ?? "",
    resourceText: JSON.stringify(resourceSnapshot ?? {}),
  };

  const scan = scanForPII(content);

  if (!scan.passed) {
    console.warn("[popia] WARNING: Potential PII detected in agent input — review required");
    console.warn("[popia] Flags:", scan.flags.map(f => `${f.type} (${f.severity})`).join(", "));
  }

  return scan;
}

function flattenToString(obj, depth = 0) {
  if (depth > 5)             return "";
  if (typeof obj === "string") return obj;
  if (typeof obj === "number") return String(obj);
  if (Array.isArray(obj))    return obj.map(i => flattenToString(i, depth + 1)).join(" ");
  if (obj && typeof obj === "object") {
    return Object.values(obj).map(v => flattenToString(v, depth + 1)).join(" ");
  }
  return "";
}

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

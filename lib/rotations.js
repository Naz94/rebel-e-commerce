// ============================================================
// REBEL ENGINE — Content Rotations (lib/rotations.js)
//
// Strategy: Technical Mentor, not Marketer.
// Split: 70% Pure Value (value_*) / 30% Lab Showcase (lab_*)
//
// Pure Value rotations:
//   value_react   — React/Next.js architecture & patterns
//   value_perf    — Core Web Vitals, performance engineering
//   value_css     — Modern CSS, design systems, layout craft
//   value_debug   — Debugging in public, real pain points solved
//
// Lab Showcase rotations:
//   lab_tool      — Password Roast, Tic-Tac-Toe as craft case studies
//   lab_template  — Free templates from /resources
//
// Visual palette: #FFFFFF white · #080808 near-black · #FF2D2D red
// ============================================================

export const ROTATIONS = [

  // ── PURE VALUE: React / Next.js ───────────────────────────
  {
    id: "value_react",
    name: "React Architecture",
    type: "value",
    description: "Deep-dive React/Next.js patterns, trade-offs, and architectural decisions",

    copyPrompt: `Write a Pure Value social media post about a React or Next.js architectural decision, pattern, or modern shift.

Topics to draw from (rotate through, never repeat the same angle):
- Server Components vs Client Components: when the boundary matters and why getting it wrong kills performance
- Why useState is often the wrong tool (and what to reach for instead)
- App Router patterns that most tutorials get wrong
- The real cost of re-renders and how to think about component trees
- Data fetching patterns: fetch in server components, SWR, React Query — picking the right one
- Why most Next.js apps are slower than they should be (common architectural mistakes)
- Suspense boundaries done right: loading states that don't destroy UX
- TypeScript patterns that actually make React code safer (not just noisier)

Rules:
- Explain the WHY behind the decision, not just the what
- Reference a specific real-world scenario or mistake
- Be opinionated. Senior engineers have positions. Take one.
- Do NOT include a link or CTA
- End with a genuine technical question that invites debate or experience-sharing from other developers`,

    imagePrompt: `Editorial technical diagram on pure black (#080808). A clean, precise React component tree or data flow diagram rendered in white (#FFFFFF) hairlines and geometric shapes. Style: between an Apple WWDC architecture slide and a Wired magazine spread. Ultra-thin lines, generous spacing, clinical precision. One node or path highlighted in red (#FF2D2D) — the critical decision point. No gradients, no textures, no decoration. Square 1:1 format. Photorealistic print quality.`,
  },

  // ── PURE VALUE: Performance Engineering ───────────────────
  {
    id: "value_perf",
    name: "Performance Engineering",
    type: "value",
    description: "Core Web Vitals, loading patterns, edge caching, real performance trade-offs",

    copyPrompt: `Write a Pure Value social media post about web performance engineering.

Topics to draw from (rotate through, never repeat the same angle):
- LCP: what actually moves the needle and what is cargo-culted advice
- Why lazy loading images below the fold is right but lazy loading above the fold destroys LCP
- Edge caching strategies: what to cache, what not to, and the stale-while-revalidate pattern
- JavaScript bundle analysis: how to find what is actually killing your TTI
- Font loading done right: font-display, preload, subsetting, variable fonts
- The real difference between SSR, SSG, ISR, and PPR — and when each one wins
- South African context: why performance matters more when data costs R8 per page load
- INP (Interaction to Next Paint): the metric most devs have not optimised for yet

Rules:
- Be specific. Real numbers, real trade-offs. Not vague advice.
- Explain the mechanism — why does this cause the problem?
- Be opinionated. Take a position.
- Do NOT include a link or CTA
- End with a genuine technical question that invites debate or experience-sharing`,

    imagePrompt: `Dark premium data visualisation on pure black (#080808). A minimal performance waterfall or Lighthouse score breakdown rendered in clean white (#FFFFFF) lines and bars — like a stripped-down DevTools screenshot reimagined as editorial art. One bar or metric highlighted in red (#FF2D2D). Clinical, precise, no decoration. Square 1:1 format.`,
  },

  // ── PURE VALUE: Modern CSS ─────────────────────────────────
  {
    id: "value_css",
    name: "Modern CSS & Design Systems",
    type: "value",
    description: "CSS architecture, design tokens, layout craft, modern techniques",

    copyPrompt: `Write a Pure Value social media post about modern CSS or design system architecture.

Topics to draw from (rotate through, never repeat the same angle):
- Container queries: what they actually unlock that media queries cannot
- CSS custom properties as a design token system (not just theme variables)
- Why most design systems break at the component API layer — and how to fix it
- Grid vs Flexbox: the decision framework senior devs use (not the "use flex for 1D, grid for 2D" oversimplification)
- Cascade layers (@layer): the feature that makes large CSS codebases manageable
- :has() selector: the parent selector that changes how you think about component state
- CSS animations that respect prefers-reduced-motion without gutting the experience
- Why Tailwind utility-first creates specific technical debt at scale — and how to manage it

Rules:
- Show the architectural thinking, not just the syntax
- Explain what breaks when you get this wrong
- Be opinionated. Take a position on contested topics.
- Do NOT include a link or CTA
- End with a genuine technical question inviting debate`,

    imagePrompt: `Ultra-clean CSS layout diagram on pure black (#080808). Abstract grid or flexbox visualisation — geometric shapes, white (#FFFFFF) hairlines, generous whitespace. The kind of diagram you would see in a CSS specification document, redesigned by a Bauhaus typographer. One element highlighted in red (#FF2D2D). No gradients. No decoration. Square 1:1 format.`,
  },

  // ── PURE VALUE: Debug in Public ───────────────────────────
  {
    id: "value_debug",
    name: "Debug in Public",
    type: "value",
    description: "Real pain points solved — state management, accessibility, architecture mistakes",

    copyPrompt: `Write a Pure Value social media post that debugs in public — takes a common developer pain point and solves it with a specific, actionable insight.

Pain points to draw from (rotate through, never repeat):
- State management hell: when Context becomes a performance problem and what to reach for
- The hydration mismatch error: why it happens and the three patterns that prevent it
- Accessibility debt: the ARIA mistakes that actually hurt screen reader users (not just compliance theatre)
- Why your Shopify Hydrogen build is slower than it should be (specific architectural mistakes)
- The WordPress custom development traps that theme-based devs do not know about
- API route vs Server Action: when devs reach for the wrong abstraction in Next.js
- The z-index wars: why stacking contexts are misunderstood and how to think about them properly
- Race conditions in async React: the useEffect cleanup pattern most tutorials skip

Rules:
- Structure: name the pain, explain the root cause, give the fix
- Be specific. Name the actual error, the actual mechanism.
- Write like a senior dev explaining it to a mid-level dev — not dumbed down, but clear
- Do NOT include a link or CTA
- End with a genuine invitation: "What is the nastiest bug you have had to track down lately?" or similar`,

    imagePrompt: `Dark premium dev console aesthetic on pure black (#080808). A minimal terminal or error output — clean white (#FFFFFF) monospace text fragments, stack trace lines, status codes — arranged with editorial precision. Not a real screenshot: an abstraction of one, like a Wired magazine spread about debugging. One line or element in red (#FF2D2D) — the error. Square 1:1 format.`,
  },

  // ── LAB SHOWCASE: Tools ───────────────────────────────────
  {
    id: "lab_tool",
    name: "Lab Tool Showcase",
    type: "lab",
    description: "Password Roast and Tic-Tac-Toe as case studies in craft",

    copyPrompt: `Write a Lab Showcase post introducing one of Rebel Designs' live lab tools as a case study in engineering craft.

Tools available:
- Password Roast (rebeldesigns.co.za/lab/password-roast): rates password strength with brutal, witty commentary. Engineering angle: real-time entropy calculation, UX that makes security feedback non-boring, decision to use client-side only so no passwords are ever transmitted.
- Rebel T-T-T (rebeldesigns.co.za/lab): a precision-designed tic-tac-toe game. Engineering angle: minimax algorithm implementation, UI interaction design at a high level, what a "simple" game reveals about component architecture when built properly.

Rules:
- Lead with the engineering decision, not the product description
- Explain WHY it was built this way — what architectural or UX problem does it solve?
- Position the tool as proof of how Rebel Designs approaches craft: even small things are built properly
- Include ONE link to the tool
- End with a direct CTA to try it — do NOT end with a question`,

    imagePrompt: `Ultra-premium dark product photography aesthetic. A sleek dark browser window floating in pure black void (#080808), displaying a minimal web tool interface — clean white (#FFFFFF) UI elements, crisp typography, generous whitespace. Studio lighting with a single cold white light source casting a razor-sharp shadow. The screen glows slightly. Shot from 15 degrees. One small red (#FF2D2D) status indicator dot. Photorealistic, 8K quality, square 1:1 format.`,
  },

  // ── LAB SHOWCASE: Templates & Resources ───────────────────
  {
    id: "lab_template",
    name: "Free Template Showcase",
    type: "lab",
    description: "Free assets from /resources as demonstrations of Rebel Designs standards",

    copyPrompt: `Write a Lab Showcase post introducing the Rebel Designs free resources as a demonstration of engineering and design standards.

Context:
- The Loot Vault at rebeldesigns.co.za/resources contains free web assets and brand strategy resources
- Frame these as: this is the standard Rebel Designs builds to — and you can see it for free
- The angle: most free templates are shortcuts. These are built the way client projects are built.

Rules:
- Lead with a specific problem the resource solves for a developer or business
- Explain what makes it different: the technical decision, the compliance consideration, the design standard
- Include ONE link: rebeldesigns.co.za/resources
- End with a direct CTA to grab the resource — do NOT end with a question`,

    imagePrompt: `Dark luxury editorial flatlay on pure black (#080808). A collection of minimal design artifacts — a stylesheet, a component diagram, a type specimen — arranged with mathematical precision on a pure black surface. Shot directly from above. White (#FFFFFF) elements, ultra-clean typography. One red (#FF2D2D) accent detail. Square 1:1 format. Photorealistic, editorial quality.`,
  },
];

// ─────────────────────────────────────────────────────────────
// GET by index (sequential fallback)
// ─────────────────────────────────────────────────────────────

export function getRotation(index) {
  return ROTATIONS[index % ROTATIONS.length];
}

// ─────────────────────────────────────────────────────────────
// WEIGHTED SELECTION — enforces 70/30 value/lab split
//
// Value rotations get 70 pool slots total, distributed by weight.
// Lab rotations get 30 pool slots total, distributed by weight.
// Performance Brain re-weights within each group over time.
// ─────────────────────────────────────────────────────────────

export function getWeightedRotation(weights = {}) {
  return selectWithSplit(Object.values(weights).some(w => w !== 50) ? weights : null);
}

function selectWithSplit(weights) {
  const valueRotations = ROTATIONS.filter(r => r.type === "value");
  const labRotations   = ROTATIONS.filter(r => r.type === "lab");

  const pool = [];

  // Value rotations: 70 slots distributed by weight
  const totalValueWeight = valueRotations.reduce((s, r) => s + (weights?.[r.id] ?? 50), 0);
  for (const r of valueRotations) {
    const w     = weights?.[r.id] ?? 50;
    const slots = Math.max(1, Math.round((w / totalValueWeight) * 70));
    for (let i = 0; i < slots; i++) pool.push(r);
  }

  // Lab rotations: 30 slots distributed by weight
  const totalLabWeight = labRotations.reduce((s, r) => s + (weights?.[r.id] ?? 50), 0);
  for (const r of labRotations) {
    const w     = weights?.[r.id] ?? 50;
    const slots = Math.max(1, Math.round((w / totalLabWeight) * 30));
    for (let i = 0; i < slots; i++) pool.push(r);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

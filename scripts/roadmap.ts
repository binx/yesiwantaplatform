/**
 * Generate docs/roadmap.html from the task briefs.
 *
 * The briefs in docs/tasks/ are the single source of truth: their frontmatter
 * carries status, tier, size and dependencies, and this script renders them.
 * Marking a task done is therefore a one-line edit in the file the agent
 * already has open, followed by `npm run roadmap` — there is no second copy of
 * the roadmap to keep in step.
 *
 * No YAML dependency: the frontmatter dialect used here is small enough to
 * parse directly, and this project is careful about what it adds to
 * package.json for a build-time script.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TASKS_DIR = path.resolve("docs/tasks");
const OUTPUT = path.resolve("docs/roadmap.html");
const INDEX = path.resolve("docs/tasks/README.md");

const STATUSES = ["todo", "in-progress", "done"] as const;
type Status = (typeof STATUSES)[number];

interface Brief {
  task: string;
  title: string;
  status: Status;
  tier: number;
  size: string;
  migration: string;
  blockedBy: string[];
  blocks: string[];
  touches: string;
  completed: string | null;
  shippedIn: string | null;
  summary: string;
  file: string;
}

/**
 * Where each task sits on the effort/expectation plot.
 *
 * Editorial placement, not a fact about the task, so it lives here rather than
 * in the briefs' frontmatter — which stays semantic. `side` resolves label
 * collisions by hand; automatic placement produced overlaps at this density.
 * A task with no entry is not plotted, which is right for internal work nobody
 * asks for by name.
 */
const PLOT: Record<string, { effort: number; expect: number; side: "left" | "right" }> = {
  "01": { effort: 2, expect: 9.5, side: "left" },
  "02": { effort: 1.5, expect: 8, side: "right" },
  "03": { effort: 2.5, expect: 9, side: "right" },
  "04": { effort: 2, expect: 7, side: "right" },
  "05": { effort: 5, expect: 9, side: "right" },
  "06": { effort: 3.5, expect: 7.5, side: "left" },
  "07": { effort: 4.5, expect: 5.5, side: "right" },
  "08": { effort: 4, expect: 6.5, side: "right" },
  "09": { effort: 7, expect: 8.5, side: "right" },
  "10": { effort: 8.5, expect: 7, side: "left" },
  "11": { effort: 9, expect: 6, side: "left" },
  "12": { effort: 9.5, expect: 3.5, side: "left" },
};

const TIERS = [
  {
    n: 0,
    tag: "Tier 0 · No migration · Days",
    heading: "Money is currently leaking",
    verdict:
      "Gaps a merchant hits in their first week of real orders. None needs a schema reshape, and three of them are closer to correctness bugs than features.",
  },
  {
    n: 1,
    tag: "Tier 1 · Light migrations · Weeks",
    heading: "The quarter's real work",
    verdict: "Tier 0 fixes stores that already have customers. This tier is about getting them.",
  },
  {
    n: 2,
    tag: "Tier 2 · Schema reshape · Plan them",
    heading: "Don't squeeze these in",
    verdict:
      "Each one changes the shape of the data or the shape of the merchant's obligations. They're worth doing and they're worth scheduling.",
  },
  {
    n: 3,
    tag: "Tier 3 · After a real store runs on this",
    heading: "Platform bets",
    verdict: "Defensible to defer. Each assumes a merchant already trusts Beluga with their revenue.",
  },
];

/* ------------------------------------------------------------- frontmatter */

/**
 * Parse the frontmatter dialect the briefs use: `key: value` scalars,
 * `key: [a, b]` lists, and `key: >-` folded blocks whose indented lines join
 * with a space.
 */
function parseFrontmatter(source: string, file: string): Record<string, string | string[]> {
  if (!source.startsWith("---\n")) {
    throw new Error(`${file}: no frontmatter. Every brief needs one — see docs/tasks/README.md.`);
  }

  const end = source.indexOf("\n---", 4);
  if (end === -1) throw new Error(`${file}: frontmatter is not closed.`);

  const out: Record<string, string | string[]> = {};
  const lines = source.slice(4, end).split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const match = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();

    if (value === ">-" || value === ">" || value === "|") {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) {
        folded.push((lines[i + 1] ?? "").trim());
        i += 1;
      }
      out[key] = folded.join(" ");
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      continue;
    }

    out[key] = value.replace(/^"|"$/g, "");
  }

  return out;
}

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

async function loadBriefs(): Promise<Brief[]> {
  const files = (await readdir(TASKS_DIR)).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const briefs: Brief[] = [];

  for (const file of files) {
    const source = await readFile(path.join(TASKS_DIR, file), "utf8");
    const fm = parseFrontmatter(source, file);

    const status = str(fm.status) as Status;
    if (!STATUSES.includes(status)) {
      throw new Error(`${file}: status "${status}" is not one of ${STATUSES.join(", ")}.`);
    }
    if (!str(fm.summary)) throw new Error(`${file}: summary is empty.`);
    if (status === "done" && !str(fm.completed)) {
      throw new Error(`${file}: status is done but completed is empty. Add the date (YYYY-MM-DD).`);
    }

    briefs.push({
      task: str(fm.task),
      title: str(fm.title),
      status,
      tier: Number(str(fm.tier)),
      size: str(fm.size),
      migration: str(fm.migration),
      blockedBy: Array.isArray(fm.blocked_by) ? fm.blocked_by : [],
      blocks: Array.isArray(fm.blocks) ? fm.blocks : [],
      touches: str(fm.touches),
      completed: str(fm.completed) || null,
      shippedIn: str(fm.shipped_in) || null,
      summary: str(fm.summary),
      file,
    });
  }

  return briefs;
}

/* ------------------------------------------------------------------ render */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape first, then the small inline subset the summaries use. */
function inline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
}

const SIZE_CLASS: Record<string, string> = { S: "s", M: "m", L: "l" };
const SIZE_WORD: Record<string, string> = { S: "Small", M: "Medium", L: "Large" };
const STATUS_WORD: Record<Status, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Shipped",
};

function renderItem(brief: Brief, byTask: Map<string, Brief>): string {
  const meta: string[] = [
    `<span><b>Migration</b> ${inline(brief.migration)}</span>`,
    `<span><b>Touches</b> ${inline(brief.touches)}</span>`,
  ];

  if (brief.blockedBy.length > 0) {
    const names = brief.blockedBy
      .map((n) => `${n} ${byTask.get(n)?.title ?? ""}`.trim())
      .join(", ");
    meta.push(`<span><b>Blocked by</b> ${inline(names)}</span>`);
  }
  if (brief.blocks.length > 0) {
    meta.push(`<span><b>Blocks</b> ${inline(brief.blocks.join(", "))}</span>`);
  }
  if (brief.status === "done" && brief.shippedIn) {
    meta.push(`<span><b>Shipped in</b> ${inline(brief.shippedIn)}</span>`);
  }
  meta.push(`<span><b>Brief</b> docs/tasks/${escapeHtml(brief.file)}</span>`);

  return `
      <article class="item item--${brief.status}">
        <div class="item-head">
          <span class="seq">${escapeHtml(brief.task)}</span>
          <h3>${inline(brief.title)}</h3>
          <span class="chip chip--status chip--${brief.status}">${STATUS_WORD[brief.status]}</span>
          <span class="chip chip--${SIZE_CLASS[brief.size] ?? "m"}">${SIZE_WORD[brief.size] ?? brief.size}</span>
        </div>
        <p>${inline(brief.summary)}</p>
        <div class="meta">${meta.join("\n          ")}</div>
      </article>`;
}

function renderProgress(briefs: Brief[]): string {
  const done = briefs.filter((b) => b.status === "done").length;
  const active = briefs.filter((b) => b.status === "in-progress").length;

  const groups = TIERS.map((tier) => {
    const cells = briefs
      .filter((b) => b.tier === tier.n)
      .map(
        (b) =>
          `<span class="cell cell--${b.status}" title="${escapeHtml(`${b.task} ${b.title} — ${STATUS_WORD[b.status]}`)}"></span>`,
      )
      .join("");
    return `<span class="group" aria-label="Tier ${tier.n}">${cells}</span>`;
  }).join("");

  const summary =
    done === 0
      ? `Nothing shipped yet — ${briefs.length} tasks queued.`
      : `${done} of ${briefs.length} shipped${active > 0 ? `, ${active} in progress` : ""}.`;

  return `
  <section class="progress">
    <div class="progress-head">
      <h2 class="progress-title">Progress</h2>
      <p class="progress-count">${escapeHtml(summary)}</p>
    </div>
    <div class="track" role="img" aria-label="${escapeHtml(summary)}">${groups}</div>
    <div class="track-key">
      <span><i class="cell cell--done"></i> Shipped</span>
      <span><i class="cell cell--in-progress"></i> In progress</span>
      <span><i class="cell cell--todo"></i> To do</span>
      <span class="track-tiers">Grouped by tier</span>
    </div>
  </section>`;
}

function renderChangelog(briefs: Brief[]): string {
  const shipped = briefs
    .filter((b) => b.status === "done")
    .sort((a, b) => (b.completed ?? "").localeCompare(a.completed ?? ""));

  if (shipped.length === 0) {
    return `
  <section class="log log--empty">
    <h2>Shipped</h2>
    <p>
      Nothing yet. The first entry appears here when a brief's <code>status</code> becomes
      <code>done</code> — this page is generated from <code>docs/tasks/</code>, so the
      changelog writes itself as the work lands.
    </p>
  </section>`;
  }

  const rows = shipped
    .map(
      (b) => `
      <li>
        <span class="log-date">${escapeHtml(b.completed ?? "")}</span>
        <span class="log-task">${escapeHtml(b.task)}</span>
        <span class="log-title">${inline(b.title)}</span>
        <span class="log-ref">${b.shippedIn ? escapeHtml(b.shippedIn) : ""}</span>
      </li>`,
    )
    .join("");

  return `
  <section class="log">
    <h2>Shipped</h2>
    <ol class="log-list">${rows}
    </ol>
  </section>`;
}

function renderPlot(briefs: Brief[]): string {
  const byTask = new Map(briefs.map((b) => [b.task, b]));
  const x = (effort: number) => 70 + (effort / 10) * 570;
  const y = (expect: number) => 330 - (expect / 10) * 270;

  const marks = Object.entries(PLOT)
    .map(([task, pos]) => {
      const brief = byTask.get(task);
      if (!brief) return "";

      const cx = x(pos.effort);
      const cy = y(pos.expect);
      const tone = brief.tier === 0 ? "now" : brief.tier === 1 ? "next" : "later";
      // Shipped work reads as filled-and-checked; everything else stays open.
      const dot =
        brief.status === "done"
          ? `<circle cx="${cx}" cy="${cy}" r="6" class="dot dot--done"></circle><path d="M${cx - 3} ${cy} l2.2 2.4 l4-4.8" class="tick"></path>`
          : `<circle cx="${cx}" cy="${cy}" r="5.5" class="dot dot--${tone}"${brief.status === "in-progress" ? ' stroke-dasharray="3 2"' : ""}></circle>`;

      const anchor = pos.side === "left" ? ' text-anchor="end"' : "";
      const lx = pos.side === "left" ? cx - 10 : cx + 10;

      return `        ${dot}
        <text class="pt-label${tone === "now" ? " now" : ""}${brief.status === "done" ? " shipped" : ""}" x="${lx}" y="${cy + 4}"${anchor}>${escapeHtml(brief.title.split(":")[0] ?? brief.title)}</text>`;
    })
    .filter(Boolean)
    .join("\n");

  return `
    <div class="plot-scroll">
      <svg viewBox="0 0 720 400" role="img" aria-label="Roadmap tasks plotted by engineering effort against how quickly a merchant notices the gap. Low-effort, high-expectation work sits in the upper left.">
        <line class="ax-line" x1="70" y1="330" x2="655" y2="330"></line>
        <line class="ax-line" x1="70" y1="45" x2="70" y2="330"></line>
        <line class="ax-guide" x1="70" y1="115" x2="655" y2="115"></line>
        <line class="ax-guide" x1="360" y1="45" x2="360" y2="330"></line>
        <text class="zone-text" x="80" y="62">Do these first</text>
        <text class="ax-text" x="70" y="352">Low effort</text>
        <text class="ax-text" x="655" y="352" text-anchor="end">High effort</text>
        <text class="ax-text" x="70" y="378">Effort →</text>
        <text class="ax-text" transform="translate(24,330) rotate(-90)" x="0" y="0">Merchant expects it →</text>
${marks}
      </svg>
    </div>`;
}

/* -------------------------------------------------------------------- page */

async function render(briefs: Brief[]): Promise<string> {
  const byTask = new Map(briefs.map((b) => [b.task, b]));
  const css = await readFile(path.resolve("scripts/roadmap.css"), "utf8");
  const generated = new Date().toISOString().slice(0, 10);

  const tiers = TIERS.map((tier) => {
    const items = briefs.filter((b) => b.tier === tier.n);
    if (items.length === 0) return "";

    const shipped = items.filter((b) => b.status === "done").length;
    const badge =
      shipped === items.length
        ? `<span class="tier-done">All ${items.length} shipped</span>`
        : shipped > 0
          ? `<span class="tier-done">${shipped} of ${items.length} shipped</span>`
          : "";

    return `
  <section class="tier${tier.n === 0 ? " tier--now" : ""}">
    <div class="tier-head">
      <div class="tier-tag">${escapeHtml(tier.tag)} ${badge}</div>
      <h2>${escapeHtml(tier.heading)}</h2>
      <p class="tier-verdict">${inline(tier.verdict)}</p>
    </div>
    <div class="items">${items.map((b) => renderItem(b, byTask)).join("\n")}
    </div>
  </section>`;
  }).join("\n");

  return `<title>Beluga v2 Roadmap</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap">

<style>
${css}</style>

<div class="wrap">

  <header class="masthead">
    <div class="eyebrow">Beluga v2 · Generated from docs/tasks · ${generated}</div>
    <h1>${briefs.length === 16 ? "Sixteen" : String(briefs.length)} things between Beluga and <em>a store someone could actually run</em></h1>
    <p class="standfirst">
      The gap review found the misses. This orders them by what they cost against what a merchant
      assumes on day one. The ranking leans on one fact about this codebase: <strong>a Drizzle schema
      change is the expensive boundary</strong>, because <code>npm run db:generate</code> has to emit
      migrations for SQLite and Postgres both, and <code>db/dialect.test.ts</code> holds them to the
      same assertions. Everything above that line is days. Everything below it is a plan.
    </p>
    <p class="standfirst">
      Every item has a full implementation brief in <code>docs/tasks/</code> — files to open, exact
      routes and schema, tests required, and what's explicitly out of scope. This page is generated
      from those briefs, so status here is whatever the briefs say.
    </p>
  </header>
${renderProgress(briefs)}
${renderChangelog(briefs)}

  <section class="plot">
    <div class="plot-head">
      <h2 class="plot-title">Why this order</h2>
      <p class="plot-note">Effort is engineering days; expectation is how quickly a merchant coming from Shopify notices it missing. Internal correctness work isn't plotted — nobody asks for it by name.</p>
    </div>
${renderPlot(briefs)}
  </section>
${tiers}

  <section class="cut">
    <h2>Deliberately not on this roadmap</h2>
    <ul>
      <li>
        <strong>Live carrier rates.</strong> They require <code>ui_mode: 'elements'</code>, which means
        owning the checkout page again and leaving PCI SAQ-A. The trade is already argued in
        <code>docs/shipping.md</code>; nothing here reopens it.
      </li>
      <li>
        <strong>An app or plugin ecosystem.</strong> Task 14 buys the useful part of this without the
        governance, review and versioning burden that a marketplace actually is.
      </li>
      <li>
        <strong>Additional payment gateways and multi-currency.</strong> A single <code>currency</code>
        on the settings row is a deliberate simplification. Revisit when a merchant asks, not before.
      </li>
      <li>
        <strong>POS and marketplace channels.</strong> Not a gap in the product — a different product.
      </li>
    </ul>
  </section>

  <p class="colophon">
    One item sits outside this ranking: the Phase 4 Lighthouse pass. It's a morning's work, the
    structural changes it measures have already landed, and it's the difference between claiming an
    accessibility score and having verified one. Do it whenever the branch is quiet.
    <br><br>
    Generated by <code>npm run roadmap</code> from <code>docs/tasks/*.md</code>. Edit a brief, not
    this page.
  </p>

</div>
`;
}

/**
 * Rewrite the task table in docs/tasks/README.md between its markers, so the
 * index cannot drift from the briefs it indexes.
 */
async function updateIndex(briefs: Brief[]): Promise<void> {
  const source = await readFile(INDEX, "utf8");
  const begin = "<!-- begin:tasks -->";
  const end = "<!-- end:tasks -->";

  const from = source.indexOf(begin);
  const to = source.indexOf(end);
  if (from === -1 || to === -1) {
    throw new Error(`docs/tasks/README.md: missing the ${begin} / ${end} markers.`);
  }

  const mark: Record<Status, string> = { todo: "·", "in-progress": "◐", done: "✅" };

  const rows = briefs
    .map(
      (b) =>
        `| ${mark[b.status]} | ${b.task} | [${b.title}](${b.file}) | ${SIZE_WORD[b.size] ?? b.size} | ${b.migration} |`,
    )
    .join("\n");

  const table = [
    "",
    "| | # | Brief | Size | Migration |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
  ].join("\n");

  await writeFile(INDEX, source.slice(0, from + begin.length) + table + source.slice(to), "utf8");
}

const briefs = await loadBriefs();
await writeFile(OUTPUT, await render(briefs), "utf8");
await updateIndex(briefs);

const done = briefs.filter((b) => b.status === "done").length;
console.log(
  `Wrote ${path.relative(process.cwd(), OUTPUT)} and updated the index in docs/tasks/README.md — ` +
    `${briefs.length} tasks, ${done} shipped.`,
);

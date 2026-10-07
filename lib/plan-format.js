// The test plan format, shared by the viewer page (browser) and tools/plan.mjs
// (Node). Plain ES module with no dependencies so it runs unchanged in both.

// Bump only for changes older viewers can't read. The viewer must keep reading
// every older version, because published plans are never rewritten.
export const PLAN_FORMAT_VERSION = 1;

export const STATUSES = {
  pass: { label: "Pass", pill: "Passed", word: "passed", icon: "✅" },
  fail: { label: "Fail", pill: "Failed", word: "failed", icon: "❌" },
  blocked: { label: "Blocked", pill: "Blocked", word: "blocked", icon: "⚠️" },
  skip: { label: "Skip", pill: "Skipped", word: "skipped", icon: "⏭️" },
};
export const STATUS_ORDER = ["pass", "fail", "blocked", "skip"];

// Plans live at plans/<repo>/<subject>/<revision>.json, e.g.
// plans/seed-bible/1234/abc1234.json: subject is the PR number, revision the
// short commit sha the plan was written for. A new commit adds a revision; it
// never replaces one. Each segment must start with a letter or digit, which
// also rules out "." and ".." path tricks.
const SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const PLAN_REF_RE = new RegExp(`^(${SEGMENT})/(${SEGMENT})(?:/(${SEGMENT}))?$`);

/**
 * Parses "<repo>/<subject>/<revision>" (one exact plan) or "<repo>/<subject>"
 * (the newest revision). Returns null for anything else.
 */
export function parsePlanRef(ref) {
  const m = typeof ref === "string" ? PLAN_REF_RE.exec(ref) : null;
  if (!m) return null;
  const [, repo, subject, revision = null] = m;
  return { repo, subject, revision, subjectId: `${repo}/${subject}`, id: revision ? `${repo}/${subject}/${revision}` : null };
}

export function planPath(ref) {
  return `plans/${ref.repo}/${ref.subject}/${ref.revision}.json`;
}

/** Generated at deploy: every revision of one subject, newest first. */
export function revisionsPath(ref) {
  return `plans/${ref.repo}/${ref.subject}/revisions.json`;
}

/**
 * Problems with where a PR plan is stored, compared with what it says about
 * itself. Warnings only: a mismatch still publishes.
 */
export function locationMismatches(ref, plan) {
  if (!plan.pr) return [];
  const out = [];
  const repoName = plan.pr.repo.split("/")[1];
  if (ref.repo !== repoName) out.push(`folder "${ref.repo}" doesn't match pr.repo "${plan.pr.repo}"`);
  if (ref.subject !== String(plan.pr.number)) out.push(`folder "${ref.subject}" doesn't match pr.number ${plan.pr.number}`);
  if (plan.pr.commit && ref.revision !== shortSha(plan.pr.commit)) {
    out.push(`file name "${ref.revision}" doesn't match pr.commit (expected "${shortSha(plan.pr.commit)}")`);
  }
  return out;
}

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isStrList = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr);
const isHttps = (v) => isStr(v) && /^https:\/\/\S+$/.test(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// A time zone is required so revisions written in different places sort correctly.
const isTimestamp = (v) =>
  isStr(v) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Returns a list of human-readable problems; an empty list means the plan is valid. */
export function validatePlan(p) {
  const e = [];
  const optStr = (v, path) => {
    if (v !== undefined && !isStr(v)) e.push(`${path}: must be a non-empty string if given`);
  };

  if (!isObj(p)) return ["The plan must be a JSON object."];

  if (p.version === undefined) e.push(`version: required (current version is ${PLAN_FORMAT_VERSION})`);
  else if (!Number.isInteger(p.version) || p.version < 1) e.push("version: must be a positive integer");
  else if (p.version > PLAN_FORMAT_VERSION) {
    return [
      `This plan uses format version ${p.version}, but this viewer only understands up to version ${PLAN_FORMAT_VERSION}.`,
    ];
  }

  if (!isStr(p.project)) e.push('project: required, the project name shown on the page (e.g. "Seed Bible")');
  if (!isStr(p.title)) e.push("title: required");
  if (!isStr(p.summary)) e.push("summary: required");
  if (!isTimestamp(p.generatedAt)) {
    e.push('generatedAt: required, an ISO date and time with a time zone, like "2026-10-07T18:04:00Z"');
  }

  if (p.pr !== undefined) {
    if (!isObj(p.pr)) e.push("pr: must be an object if given");
    else {
      if (!isStr(p.pr.repo) || !/^[^/\s]+\/[^/\s]+$/.test(p.pr.repo)) e.push('pr.repo: required, like "HelloAOLab/seed-bible"');
      if (!Number.isInteger(p.pr.number) || p.pr.number <= 0) e.push("pr.number: required positive integer");
      if (!isHttps(p.pr.url)) e.push("pr.url: required https:// URL");
      optStr(p.pr.branch, "pr.branch");
      if (p.pr.commit !== undefined && !(isStr(p.pr.commit) && /^[0-9a-f]{7,40}$/.test(p.pr.commit))) {
        e.push("pr.commit: must be a git commit sha if given");
      }
    }
  }

  if (p.links !== undefined) {
    if (!Array.isArray(p.links)) e.push("links: must be an array if given");
    else
      p.links.forEach((l, i) => {
        if (!isStr(l?.label)) e.push(`links[${i}].label: required`);
        if (!isHttps(l?.url)) e.push(`links[${i}].url: required https:// URL`);
      });
  }

  if (p.preview !== undefined) {
    if (!isObj(p.preview) || !isHttps(p.preview.url)) e.push("preview.url: required https:// URL when preview is given");
    else optStr(p.preview.label, "preview.label");
  }

  if (p.setup !== undefined) {
    if (!Array.isArray(p.setup)) e.push("setup: must be an array if given");
    else
      p.setup.forEach((s, i) => {
        if (!isStr(s?.title)) e.push(`setup[${i}].title: required`);
        optStr(s?.body, `setup[${i}].body`);
        optStr(s?.code, `setup[${i}].code`);
      });
  }

  if (!Array.isArray(p.sections) || p.sections.length === 0) e.push("sections: needs at least one section");
  else
    p.sections.forEach((s, i) => {
      if (!isStr(s?.title)) e.push(`sections[${i}].title: required`);
      optStr(s?.intro, `sections[${i}].intro`);
      if (!Array.isArray(s?.tests) || s.tests.length === 0) {
        e.push(`sections[${i}].tests: needs at least one test`);
        return;
      }
      s.tests.forEach((t, j) => {
        const at = `sections[${i}].tests[${j}]`;
        if (!isStr(t?.title)) e.push(`${at}.title: required`);
        if (!isStrList(t?.steps)) e.push(`${at}.steps: needs at least one step`);
        if (!isStrList(t?.expected)) e.push(`${at}.expected: needs at least one expected result`);
        optStr(t?.why, `${at}.why`);
        optStr(t?.before, `${at}.before`);
      });
    });

  if (p.notCovered !== undefined && !(Array.isArray(p.notCovered) && p.notCovered.every(isStr))) {
    e.push("notCovered: must be an array of strings if given");
  }
  return e;
}

/** Copy of a valid plan with every test numbered T1..Tn in reading order. */
export function normalizePlan(plan) {
  const copy = JSON.parse(JSON.stringify(plan));
  let n = 0;
  for (const section of copy.sections) {
    for (const test of section.tests) test.id = `T${++n}`;
  }
  copy.tests = copy.sections.flatMap((s) => s.tests);
  return copy;
}

// Revisions are never overwritten, so the full plan id is a stable key.
export function storageKey(planId) {
  return `pr-test-plans:${planId}`;
}

/** Revisions of one subject, newest first. Entries need { revision, generatedAt }. */
export function sortRevisions(revisions) {
  return [...revisions].sort(
    (a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt) || b.revision.localeCompare(a.revision)
  );
}

export function shortSha(sha) {
  return String(sha).slice(0, 7);
}

function prRef(plan) {
  return plan.pr ? `${plan.pr.repo}#${plan.pr.number}` : null;
}

/**
 * Markdown a tester pastes back into GitHub. `state` is
 * { tester, env, results: { T1: { status, notes } } }; `plan` is normalized.
 */
export function toResultsMarkdown(plan, state, { planUrl, date } = {}) {
  const result = (id) => state.results?.[id] ?? { status: "", notes: "" };
  const counts = { pass: 0, fail: 0, blocked: 0, skip: 0, untested: 0 };
  for (const t of plan.tests) {
    const s = result(t.id).status;
    if (STATUSES[s]) counts[s] += 1;
    else counts.untested += 1;
  }

  const lines = [`### 🧪 Manual test results: ${plan.title}`];
  const meta = [];
  if (planUrl) meta.push(`[Test plan](${planUrl})`);
  if (plan.pr) meta.push(prRef(plan));
  if (plan.pr?.commit) meta.push(`Commit \`${shortSha(plan.pr.commit)}\``);
  if (state.tester?.trim()) meta.push(`Tested by ${state.tester.trim()}`);
  if (state.env?.trim()) meta.push(state.env.trim());
  if (date) meta.push(date);
  if (meta.length) lines.push(meta.join(" · "));
  lines.push("");

  const parts = STATUS_ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${STATUSES[k].word}`);
  if (counts.untested) parts.push(`${counts.untested} not tested`);
  lines.push(`**${plan.tests.length} tests:** ${parts.join(" · ")}`);

  for (const k of ["fail", "blocked"]) {
    const ids = plan.tests.filter((t) => result(t.id).status === k).map((t) => t.id);
    if (ids.length) lines.push("", `${STATUSES[k].icon} **${STATUSES[k].pill}:** ${ids.join(", ")}`);
  }

  for (const section of plan.sections) {
    lines.push("", `#### ${section.title}`, "");
    for (const t of section.tests) {
      const r = result(t.id);
      const st = STATUSES[r.status];
      lines.push(`- ${st ? st.icon : "⬜"} **${t.id} · ${t.title}**${st ? "" : " (not tested)"}`);
      const notes = (r.notes ?? "").trim();
      if (notes) {
        for (const line of notes.split(/\r?\n/)) lines.push(line.trim() ? `  > ${line}` : "  >");
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Plain GitHub task-list version of a plan, for PR comments. `plan` is normalized. */
export function toChecklistMarkdown(plan) {
  const out = [];
  if (plan.preview) out.push(`${plan.preview.label ?? "Preview"}: ${plan.preview.url}`, "");
  if (plan.setup?.length) {
    out.push("**Before you start**", "");
    plan.setup.forEach((s, i) => {
      out.push(`${i + 1}. **${s.title}**${s.body ? ` ${s.body}` : ""}`);
      if (s.code) out.push("   ```", ...s.code.split("\n").map((l) => `   ${l}`), "   ```");
    });
  }
  for (const section of plan.sections) {
    out.push("", `**${section.title}**`, "");
    for (const t of section.tests) {
      out.push(`- [ ] **${t.id} · ${t.title}**`);
      if (t.before) out.push(`  First: ${t.before}`);
      t.steps.forEach((s, i) => out.push(`  ${i + 1}. ${s}`));
      out.push(`  - You should see: ${t.expected.join(" ")}`);
    }
  }
  if (plan.notCovered?.length) {
    out.push("", "**Not covered by this plan**", "", ...plan.notCovered.map((s) => `- ${s}`));
  }
  return out.join("\n").replace(/^\n+/, "") + "\n";
}

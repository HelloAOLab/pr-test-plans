#!/usr/bin/env node
// Command-line helper for test plans. Node 18+, no dependencies.
//
//   node tools/plan.mjs validate <plan.json>...      Check plans; exit 1 if any are invalid.
//   node tools/plan.mjs checklist <plan.json>        Print the plan as a GitHub task list.
//   node tools/plan.mjs index <plans-dir> <out.json> List every valid plan for the home page, and
//                                                    write each PR's revisions.json next to its plans.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import {
  locationMismatches,
  normalizePlan,
  parsePlanRef,
  sortRevisions,
  toChecklistMarkdown,
  validatePlan,
} from "../lib/plan-format.js";

const [command, ...args] = process.argv.slice(2);

function readPlan(path) {
  try {
    return { plan: JSON.parse(readFileSync(path, "utf8")), errors: null };
  } catch (err) {
    return { plan: null, errors: [`Not valid JSON: ${err.message}`] };
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function check(path) {
  const { plan, errors } = readPlan(path);
  return { plan, errors: errors ?? validatePlan(plan) };
}

function usage() {
  console.error(
    [
      "Usage:",
      "  node tools/plan.mjs validate <plan.json>...",
      "  node tools/plan.mjs checklist <plan.json>",
      "  node tools/plan.mjs index <plans-dir> <out.json>",
    ].join("\n")
  );
  process.exit(2);
}

if (command === "validate") {
  if (!args.length) usage();
  let bad = 0;
  for (const path of args) {
    const { errors } = check(path);
    if (errors.length) {
      bad += 1;
      console.error(`✗ ${path} has ${errors.length} problem(s):`);
      for (const e of errors) console.error(`    - ${e}`);
    } else {
      console.log(`✓ ${path}`);
    }
  }
  process.exit(bad ? 1 : 0);
} else if (command === "checklist") {
  if (args.length !== 1) usage();
  const { plan, errors } = check(args[0]);
  if (errors.length) {
    console.error(`${args[0]} is not a valid plan. Run "validate" to see why.`);
    process.exit(1);
  }
  process.stdout.write(toChecklistMarkdown(normalizePlan(plan)));
} else if (command === "index") {
  if (args.length !== 2) usage();
  const [dir, out] = args;
  // GitHub Actions shows ::warning lines as annotations on the run.
  const warn = (path, msg) => console.log(`::warning file=${path}::${msg}`);
  const subjects = new Map();
  let planCount = 0;

  for (const path of walk(dir)) {
    const rel = relative(dir, path).split(sep).join("/");
    if (rel === "index.json" || rel.endsWith("/revisions.json") || !rel.endsWith(".json")) continue;
    const ref = parsePlanRef(rel.replace(/\.json$/, ""));
    if (!ref?.revision) {
      warn(path, `Left out of the index: plans must be stored at plans/<repo>/<pr>/<commit>.json, not plans/${rel}`);
      continue;
    }
    const { plan, errors } = check(path);
    if (errors.length) {
      warn(path, `Left out of the index: ${errors.join("; ")}`);
      continue;
    }
    const mismatches = locationMismatches(ref, plan);
    if (mismatches.length) warn(path, `Stored in the wrong place? ${mismatches.join("; ")}`);

    planCount += 1;
    const entry = subjects.get(ref.subjectId) ?? { ref, dir: dirname(path), revisions: [] };
    entry.revisions.push({
      id: ref.id,
      revision: ref.revision,
      commit: plan.pr?.commit,
      generatedAt: plan.generatedAt,
      project: plan.project,
      title: plan.title,
      pr: plan.pr ? { repo: plan.pr.repo, number: plan.pr.number } : undefined,
    });
    subjects.set(ref.subjectId, entry);
  }

  const index = [];
  for (const [subjectId, { dir: subjectDir, revisions }] of subjects) {
    const sorted = sortRevisions(revisions);
    writeFileSync(
      join(subjectDir, "revisions.json"),
      JSON.stringify({ revisions: sorted.map(({ id, revision, commit, generatedAt, title }) => ({ id, revision, commit, generatedAt, title })) }, null, 2) + "\n"
    );
    const latest = sorted[0];
    index.push({
      id: subjectId,
      latest: latest.id,
      revisionCount: sorted.length,
      project: latest.project,
      title: latest.title,
      pr: latest.pr,
      generatedAt: latest.generatedAt,
    });
  }
  index.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt) || a.id.localeCompare(b.id));
  writeFileSync(out, JSON.stringify({ plans: index }, null, 2) + "\n");
  console.log(`Indexed ${planCount} plan(s) across ${index.length} pull request(s) into ${out}`);
} else {
  usage();
}

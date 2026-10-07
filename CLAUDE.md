# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Style

Write explanations to be understood on the first read. The reader may not have the code in front of them.

- **Plain language over jargon.** When a technical term is unavoidable, explain it in everyday words right after.
- **Lead with the short answer**, then the detail.
- **Use concrete before/after** to explain a change in behavior.
- **Explain the _why_, not just the _what_.** If something couldn't be done, say plainly what blocked it.
- **Don't bury trade-offs.** When presenting options, make the consequence of each one obvious.

## Project Overview

**HelloAO Test Plans** is a static site on GitHub Pages (https://helloaolab.github.io/pr-test-plans/) that shows step-by-step manual test plans for HelloAO pull requests. Testers mark each test Pass / Fail / Blocked / Skip, add notes, and copy their results as markdown to paste back into the pull request. It's org-wide: any HelloAO project can publish plans here.

Plans are JSON files at `plans/<repo>/<pr>/<commit>.json` (e.g. `plans/seed-bible/1234/abc1234.json`): one **revision** per commit, so a pull request accumulates plans and old ones are never overwritten. `?plan=<repo>/<pr>/<commit>` opens one revision; `?plan=<repo>/<pr>` opens the newest and pins the address to it. ("Revision" is the per-commit plan; `version` inside the JSON is the *format* version. Don't mix them up.) Most are written and committed by the `routine-pr-human-review-plan` Claude Code skill that lives in each project's repo (e.g. `HelloAOLab/seed-bible` → `.claude/skills/routine-pr-human-review-plan/`). That skill owns *how to write a good plan*; this repo owns *the format and the page*.

`README.md` is the user-facing reference (plan format table, CLI, local preview). Keep it in sync with any format or CLI change.

## Commands

No install step and no dependencies. Node 18+.

```bash
npm test                                          # node --test (tests/)
node tools/plan.mjs validate <plan.json>...       # exit 1 if any plan is invalid
node tools/plan.mjs checklist <plan.json>         # plain GitHub task list for a PR comment
node tools/plan.mjs index <plans-dir> <out.json>  # home page list; invalid plans skipped with ::warning
npm run index && npx http-server -c-1 .           # local preview at http://localhost:8080/
```

The page uses `fetch` and ES modules, so it must be served over HTTP; opening `index.html` from disk won't work.

## Architecture

- `lib/plan-format.js`: **the single source of truth for the format**. Validation, test numbering (T1..Tn), the browser storage key, the copied-results markdown, and the checklist markdown. Imported by both `app.js` (browser) and `tools/plan.mjs` (Node), so it must stay a dependency-free ES module that runs in both. Don't duplicate its rules elsewhere.
- `app.js`, `index.html`, `styles.css`: the viewer. Home page (no `?plan`) lists `plans/index.json`, one entry per pull request linking to its newest revision. A plan page loads the subject's `revisions.json` to resolve the newest revision, show a "there's a newer plan" notice on older ones, and list every revision. It validates the plan before rendering and shows a plain-language error page for a bad link, a missing plan, a load failure, or an invalid plan.
- `tools/plan.mjs`: CLI wrapper around `lib/plan-format.js`.
- `.github/workflows/pages.yml`: on push to `main`, runs tests, copies the site into `_site/`, runs `tools/plan.mjs index` there (writes `plans/index.json` and every `plans/<repo>/<pr>/revisions.json`), and deploys. Those files are generated, never committed.

## Invariants (don't break these)

- **Published plans are never rewritten, and the viewer renders all of them.** Every viewer change must keep reading every older plan. Adding an optional field is fine within a version. Anything an older viewer couldn't read (renamed or newly required field, changed meaning) needs a `PLAN_FORMAT_VERSION` bump plus code that still handles the older versions. Update the README format table too.
- **Plan text is untrusted.** Plans come from automated routines, so render text only through `esc()`/`fmt()` in `app.js` (plain text plus `` `code` ``, `**bold**`, bare `https://` links). Never insert plan strings as raw HTML, and keep every link `https://`-only (the format rejects anything else).
- **Revisions are append-only.** A new commit gets a new file; existing files are edited only to fix a broken plan. Everything below relies on that.
- **Plan links are parsed by `parsePlanRef`** before any fetch (two or three segments, each starting with a letter or digit), so a link can't load anything outside `plans/`.
- **Saved results are keyed by the full revision id (`storageKey`).** Changing its shape silently wipes every tester's in-progress results. Test ids come from reading order, which is safe only because revisions aren't edited.
- **"Newest" is decided by `generatedAt`** (a full timestamp with a time zone) via `sortRevisions`, not by file name, since commit shas don't sort.
- **A plan stored somewhere that doesn't match its own `pr` details** (`locationMismatches`) is a warning, not an error: it still publishes.
- **One bad plan must not block the deploy.** The workflow validates while indexing and skips invalid plans with a warning. Don't make validation failures fail the deploy job.
- **No build step, no dependencies, no frameworks.** The site is the files as committed. Fonts come from Google Fonts; nothing else loads from other hosts.

## Commits to this repo

Two kinds of change land here:

- **Plan files** (`plans/**.json`) are committed straight to `main` by routines and people. That's expected; each one publishes about a minute later.
- **Viewer, format, CLI, workflow changes** should go through a pull request, since they affect every plan at once.

## Conventions

- Plain modern JavaScript (ES modules), no TypeScript. Match the existing style: 2-space indent, double quotes, trailing commas.
- Styling uses the CSS custom properties at the top of `styles.css` (HelloAO website palette: cream/ink/gold/terra, Radley + Inter). Every color is a token with a light and a dark value; never hard-code a color in a component rule.
- Page copy is written for non-developers: plain words, name things by what people see, error messages say what went wrong and what to do next.
- Tests (`tests/*.test.js`, `node:test`) assert observable output: validation messages, generated markdown, the index file, CLI exit codes. Add a test for every format rule or markdown change, and cover the invalid case, not just the happy path.
- Only add comments when the _why_ isn't obvious from the code.

# HelloAO Test Plans

Step-by-step manual test plans for HelloAO pull requests, published at **https://helloaolab.github.io/pr-test-plans/**.

A test plan walks someone through checking a change by hand, written so that anyone can follow it, not just developers. Testers mark each test Pass, Fail, Blocked or Skip, add notes, and copy their results as markdown to paste back into the pull request. Results save in the tester's browser, so they can stop and come back.

Plans are usually written by the `routine-pr-human-review-plan` Claude Code skill in each project's repo, but you can write or edit one by hand too.

## How it works

- Each plan is a JSON file at **`plans/<repo>/<pr>/<commit>.json`**: the repository name (without `HelloAOLab/`), the pull request number, and the first 7 characters of the commit the plan was written for. For example, `plans/seed-bible/1234/abc1234.json`.
- **A pull request can have many plans, one per commit.** When new commits come in and a new plan is written, it's added next to the old ones. Old plans are never overwritten, so links posted earlier keep working and testers partway through an older plan don't lose their place.
- There are two kinds of link:
  - `?plan=seed-bible/1234/abc1234` opens that exact plan.
  - `?plan=seed-bible/1234` opens the newest plan for the pull request. The page then switches the address to the exact plan it opened, so reloading never swaps the plan out from under a tester.
- An older plan shows a notice linking to the newest one, and every plan with more than one revision lists all of them.
- There is one viewer page (`index.html`, `app.js`, `styles.css`) for every plan. A change to the viewer reaches every plan, old and new.
- Every push to `main` runs the tests and redeploys the site with GitHub Pages ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)). A new plan is live about a minute after it's committed. The deploy also builds `plans/index.json` (the home page list, one entry per pull request) and a `revisions.json` in each pull request's folder (its plans, newest first). Neither is committed.
- A plan file that isn't valid, or isn't stored at `plans/<repo>/<pr>/<commit>.json`, is left out of those lists (the deploy run shows a warning), and opening its link explains what's wrong. A plan whose location doesn't match its own `pr` details still publishes, with a warning. One bad plan never blocks other plans from publishing.

## Adding a plan

1. Write the plan JSON (format below).
2. Check it: `node tools/plan.mjs validate plans/<repo>/<pr>/<commit>.json`
3. Commit it to `main`.

Don't edit a published plan to update it for new commits. Add a new file for the new commit instead. Editing an existing file is only for fixing a broken one. Testers' saved results are tied to the exact plan, so a new revision starts everyone with a clean checklist.

Plans that aren't about a single pull request (a release check, say) use the same three-part layout with names of your choosing, e.g. `plans/seed-bible/v1.9.0/rc1.json`. Leave out `pr` for those.

## Plan format

Format version **1**. The rules live in [`lib/plan-format.js`](lib/plan-format.js), which both the page and the command-line tool use. [`plans/examples/note-shortcut/example.json`](plans/examples/note-shortcut/example.json) is a complete example.

| Field | Required | What it is |
|---|---|---|
| `version` | yes | Format version. Currently `1`. |
| `project` | yes | Project name shown at the top, e.g. `"Seed Bible"`. |
| `title` | yes | What's being tested, usually the pull request title. |
| `summary` | yes | Two or three plain sentences: what changed for the user and why. |
| `generatedAt` | yes | When the plan was written: ISO date and time with a time zone, e.g. `"2026-10-07T18:04:00Z"`. Decides which revision is newest. |
| `pr` | no | `{ "repo": "HelloAOLab/seed-bible", "number": 1234, "url": "https://…", "branch"?: "…", "commit"?: "<full sha>" }`. Should match where the plan is stored. |
| `links` | no | Extra links shown under the title, e.g. linked issues: `[{ "label": "Issue 1200: …", "url": "https://…" }]` |
| `preview` | no | Where to test, shown as a button: `{ "url": "https://…", "label"?: "Open the preview build" }` |
| `setup` | no | Steps before the tests: `[{ "title": "…", "body"?: "…", "code"?: "command to copy" }]` |
| `sections` | yes | `[{ "title": "…", "intro"?: "…", "tests": [ … ] }]`, at least one section with at least one test. |
| `notCovered` | no | Plain-language list of things this plan doesn't check, e.g. internal changes covered by automated tests. |

Each test:

| Field | Required | What it is |
|---|---|---|
| `title` | yes | What the test checks, as a short sentence. |
| `steps` | yes | Exact actions, in order. |
| `expected` | yes | What the tester should see on screen. |
| `why` | no | Why the test matters. |
| `before` | no | Anything that must be true first, e.g. "You need the note from the first test." |

Don't number tests yourself. The page numbers them T1, T2, … in reading order.

Text fields are plain text with three extras: `` `code` ``, `**bold**`, and bare `https://` links. HTML is shown as literal text, and every link must be `https://`.

**Changing the format.** Adding an optional field is fine within version 1. Anything an older viewer couldn't read (a renamed or newly required field) needs a version bump, and the viewer must keep reading every older version, because published plans are never rewritten.

## Command-line tool

Node 18 or newer, no install needed.

```bash
node tools/plan.mjs validate <plan.json>...       # check plans; exits 1 if any are invalid
node tools/plan.mjs checklist <plan.json>         # print the plan as a GitHub task list
node tools/plan.mjs index <plans-dir> <out.json>  # build the home page's plan list
npm test                                          # run the tests
```

## Previewing locally

The page loads plans with `fetch`, so it needs a local web server; opening `index.html` directly won't work. Run:

```bash
npm run preview
```

To use a different port: `PORT=3000 npm run preview` (macOS, Linux, Git Bash) or `$env:PORT=3000; npm run preview` (PowerShell).

Then open http://localhost:8080/, or the example plan at http://localhost:8080/?plan=examples/note-shortcut/example. Stop it with Ctrl+C.

The preview server ([`tools/serve.mjs`](tools/serve.mjs)) needs no install. It turns caching off, so edits show on a normal reload, and it rebuilds the plan list and each pull request's `revisions.json` whenever the page asks for them, so adding or editing a plan file only needs a reload. Plans that would be left out on deploy are reported in the terminal.

## One-time repository setup

- **Settings → Pages → Source:** GitHub Actions.
- Anything that writes plans (for example the Claude GitHub app used by Claude Code routines) needs write access to this repository's contents.

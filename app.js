import {
  STATUSES,
  STATUS_ORDER,
  normalizePlan,
  parsePlanRef,
  planPath,
  revisionsPath,
  shortSha,
  storageKey,
  toResultsMarkdown,
  validatePlan,
} from "./lib/plan-format.js";

const app = document.getElementById("app");

// Plan text is plain text plus `code`, **bold** and bare https links; never raw HTML.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmt(s) {
  return String(s)
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(
          /https:\/\/[^\s<>"]*[^\s<>".,;:!?)]/g,
          (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
        );
    })
    .join("");
}
function el(tag, attrs, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  return node;
}
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function homeUrl() {
  return location.pathname;
}
function planUrl(id) {
  return `${location.origin}${location.pathname}?plan=${id}`;
}

function showProblem(title, message, details) {
  document.title = `${title} · HelloAO Test Plans`;
  app.replaceChildren();
  const box = el("div", { class: "problem" });
  box.appendChild(el("p", { class: "eyebrow" }, `<a href="${esc(homeUrl())}">HelloAO Test Plans</a>`));
  box.appendChild(el("h1", null, esc(title)));
  box.appendChild(el("p", { class: "intro" }, message));
  if (details?.length) {
    const ul = el("ul");
    for (const d of details) ul.appendChild(el("li", null, esc(d)));
    box.appendChild(ul);
  }
  app.appendChild(box);
}

// ─── Home page: list of every published plan ────────────────────────────────

async function showHome() {
  app.replaceChildren();
  const header = el("header");
  header.appendChild(el("p", { class: "eyebrow" }, "HelloAO"));
  header.appendChild(el("h1", null, "Test Plans"));
  header.appendChild(
    el(
      "p",
      { class: "summary" },
      "Step-by-step manual test plans for HelloAO pull requests. Open one, work through the checklist, and copy your results back to the pull request."
    )
  );
  app.appendChild(header);

  const sec = el("section");
  sec.appendChild(el("h2", null, "Recent plans"));
  const field = el("div", { class: "field" });
  field.appendChild(el("label", { for: "plan-filter" }, "Find a plan"));
  const filter = el("input", {
    type: "search",
    id: "plan-filter",
    placeholder: "Project, pull request number or title",
    autocomplete: "off",
  });
  field.appendChild(filter);
  sec.appendChild(field);
  const list = el("ul", { class: "plan-list" });
  sec.appendChild(list);
  const empty = el("p", { class: "intro" });
  sec.appendChild(empty);
  app.appendChild(sec);

  let plans = [];
  try {
    const res = await fetch("plans/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    plans = (await res.json()).plans ?? [];
  } catch {
    empty.textContent = "The list of plans couldn't be loaded. A direct link to a plan still works.";
    filter.disabled = true;
    return;
  }

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = plans.filter((p) =>
      [p.project, p.title, p.latest, p.pr ? `#${p.pr.number} ${p.pr.number}` : ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    list.replaceChildren(
      ...shown.map((p) => {
        const li = el("li");
        const a = el("a", { href: `?plan=${p.latest}` });
        a.appendChild(el("span", { class: "plan-title" }, esc(p.title)));
        const bits = [p.project];
        if (p.pr) bits.push(`PR ${p.pr.number}`);
        bits.push(when(p.generatedAt));
        if (p.revisionCount > 1) bits.push(`${p.revisionCount} revisions`);
        a.appendChild(el("span", { class: "plan-meta" }, esc(bits.join(" · "))));
        li.appendChild(a);
        return li;
      })
    );
    empty.textContent = shown.length
      ? ""
      : plans.length
        ? "No plans match that search."
        : "No plans have been published yet.";
  };
  filter.addEventListener("input", render);
  render();
}

// ─── Plan page ───────────────────────────────────────────────────────────────

// Every revision of the plan's subject, newest first, or null if the list
// isn't available (e.g. local preview before `npm run index`).
async function loadRevisions(ref) {
  try {
    // no-cache: revalidate so a just-published revision shows up right away.
    const res = await fetch(revisionsPath(ref), { cache: "no-cache" });
    if (!res.ok) return null;
    const list = (await res.json()).revisions;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

function showNotFound(name) {
  showProblem(
    "Plan not found",
    `There's no plan called <code>${esc(name)}</code> yet. New plans take a minute or two to publish, so if you were just sent this link, reload the page shortly.`
  );
}

async function showPlan(refText) {
  const ref = parsePlanRef(refText);
  if (!ref) {
    showProblem(
      "That link doesn't point to a plan",
      `Plan links look like <code>?plan=seed-bible/1234</code>. Check the link you were given, or <a href="${esc(homeUrl())}">browse all plans</a>.`
    );
    return;
  }

  const revisions = await loadRevisions(ref);
  let id = ref.id;
  if (!id) {
    // A link without a revision opens the newest one. Pin the address to that
    // revision so a reload never swaps the plan out from under a tester.
    if (!revisions?.length) {
      showNotFound(ref.subjectId);
      return;
    }
    id = revisions[0].id;
    history.replaceState(null, "", `?plan=${id}`);
  }

  let raw;
  try {
    const res = await fetch(planPath(parsePlanRef(id)), { cache: "no-cache" });
    if (res.status === 404) {
      showNotFound(id);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    showProblem(
      "The plan couldn't be loaded",
      "Check your connection and reload the page.",
      [String(err.message ?? err)]
    );
    return;
  }

  const errors = validatePlan(raw);
  if (errors.length) {
    showProblem(
      "This plan has problems",
      "The plan file is missing information the page needs. Let whoever shared the link know, and include the list below.",
      errors
    );
    return;
  }
  renderPlan(id, normalizePlan(raw), revisions ?? []);
}

function renderPlan(id, plan, revisions) {
  document.title = plan.pr
    ? `PR ${plan.pr.number} Test Plan · ${plan.project}`
    : `${plan.title} · ${plan.project}`;

  const STORE_KEY = storageKey(id);
  let storageOk = true;
  const blank = () => ({ tester: "", env: "", results: {} });
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
      if (!s || typeof s !== "object") return blank();
      return {
        tester: typeof s.tester === "string" ? s.tester : "",
        env: typeof s.env === "string" ? s.env : "",
        results: s.results && typeof s.results === "object" ? s.results : {},
      };
    } catch {
      storageOk = false;
      return blank();
    }
  };
  const state = load();

  const storageNotice = el("p", { class: "notice" });
  storageNotice.textContent =
    "This browser isn't letting the page save your progress, so your results will be lost if you reload. Copy your results before you leave the page.";
  const renderStorageNotice = () => {
    storageNotice.hidden = storageOk;
  };
  const save = () => {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ ...state, savedAt: new Date().toISOString() })
      );
      storageOk = true;
    } catch {
      storageOk = false;
    }
    renderStorageNotice();
  };
  const result = (tid) => state.results[tid] ?? { status: "", notes: "" };
  const setResult = (tid, patch) => {
    const next = { ...result(tid), ...patch };
    if (!next.status && !next.notes) delete state.results[tid];
    else state.results[tid] = next;
    save();
  };
  const markdown = () => toResultsMarkdown(plan, state, { planUrl: planUrl(id), date: today() });

  // Header
  app.replaceChildren(storageNotice);
  renderStorageNotice();
  const header = el("header");
  header.appendChild(
    el(
      "p",
      { class: "eyebrow" },
      `<a href="${esc(homeUrl())}">HelloAO Test Plans</a> · ${esc(plan.project)}`
    )
  );
  header.appendChild(el("h1", null, fmt(plan.title)));
  const bits = [];
  if (plan.pr) {
    bits.push(
      `<a href="${esc(plan.pr.url)}" target="_blank" rel="noopener">Pull request ${esc(plan.pr.number)}</a>`
    );
  }
  for (const l of plan.links ?? []) {
    bits.push(`<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`);
  }
  if (plan.pr?.branch) bits.push(`Branch <code>${esc(plan.pr.branch)}</code>`);
  if (plan.pr?.commit) bits.push(`Commit <code>${esc(shortSha(plan.pr.commit))}</code>`);
  bits.push(`Written ${esc(when(plan.generatedAt))}`);
  header.appendChild(el("p", { class: "meta" }, bits.map((b) => `<span>${b}</span>`).join("")));

  const position = revisions.findIndex((r) => r.id === id);
  if (position > 0) {
    const newest = revisions[0];
    const commit = newest.commit ? ` for commit <code>${esc(shortSha(newest.commit))}</code>` : "";
    header.appendChild(
      el(
        "p",
        { class: "notice" },
        `<strong>There's a newer plan.</strong> This one was written for an earlier version of the change. A new plan was written ${esc(when(newest.generatedAt))}${commit}. Your results on this page are kept. <a href="?plan=${esc(newest.id)}">Open the newest plan</a>`
      )
    );
  }
  if (revisions.length > 1) {
    const historyEl = el("details", { class: "history" });
    historyEl.appendChild(el("summary", null, `All ${revisions.length} plans for this pull request`));
    const ul = el("ul");
    revisions.forEach((r, i) => {
      const label = `${esc(when(r.generatedAt))}${r.commit ? ` · commit <code>${esc(shortSha(r.commit))}</code>` : ""}${i === 0 ? " · newest" : ""}`;
      ul.appendChild(
        el("li", null, r.id === id ? `${label} <strong>(this plan)</strong>` : `<a href="?plan=${esc(r.id)}">${label}</a>`)
      );
    });
    historyEl.appendChild(ul);
    header.appendChild(historyEl);
  }
  header.appendChild(el("p", { class: "summary" }, fmt(plan.summary)));
  header.appendChild(
    el(
      "p",
      { class: "intro" },
      "Work through the tests in order and mark each one. Your results save in this browser as you go, so you can close the page and come back. When you're done, choose <strong>Copy results</strong> and paste them into a comment on the pull request."
    )
  );
  app.appendChild(header);

  // Setup
  if (plan.preview || plan.setup?.length) {
    const sec = el("section", { id: "setup" });
    sec.appendChild(el("h2", null, "Before you start"));
    if (plan.preview) {
      const p = el("p");
      p.appendChild(
        el(
          "a",
          { class: "link-button", href: plan.preview.url, target: "_blank", rel: "noopener" },
          `${esc(plan.preview.label ?? "Open the preview")} ↗`
        )
      );
      sec.appendChild(p);
    }
    if (plan.setup?.length) {
      const ol = el("ol", { class: "setup" });
      for (const step of plan.setup) {
        const li = el("li");
        li.appendChild(el("p", { class: "setup-title" }, fmt(step.title)));
        if (step.body) li.appendChild(el("p", null, fmt(step.body)));
        if (step.code) {
          const pre = el("pre");
          const code = el("code");
          code.textContent = step.code;
          pre.appendChild(code);
          li.appendChild(pre);
        }
        ol.appendChild(li);
      }
      sec.appendChild(ol);
    }
    app.appendChild(sec);
  }

  // Tester details
  const testerSec = el("section", { id: "tester" });
  testerSec.appendChild(el("h2", null, "About you"));
  testerSec.appendChild(
    el(
      "p",
      { class: "intro" },
      "Optional. This is added to the results you copy, so the team knows who tested and on what."
    )
  );
  const grid = el("div", { class: "tester" });
  for (const f of [
    { id: "tester-name", key: "tester", label: "Your name", hint: "", ph: "e.g. Sam" },
    {
      id: "tester-env",
      key: "env",
      label: "Device and browser",
      hint: " (where you ran the tests)",
      ph: "e.g. Chrome on Windows, Safari on iPhone",
    },
  ]) {
    const wrap = el("div", { class: "field" });
    wrap.appendChild(el("label", { for: f.id }, `${esc(f.label)}<span class="hint">${esc(f.hint)}</span>`));
    const input = el("input", { type: "text", id: f.id, placeholder: f.ph, autocomplete: "off" });
    input.value = state[f.key];
    input.addEventListener("input", () => {
      state[f.key] = input.value;
      save();
      refreshPreview();
    });
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }
  testerSec.appendChild(grid);
  app.appendChild(testerSec);

  // Tests
  plan.sections.forEach((s, i) => {
    const sec = el("section", { id: `section-${i + 1}` });
    sec.appendChild(el("h2", null, fmt(s.title)));
    if (s.intro) sec.appendChild(el("p", { class: "intro" }, fmt(s.intro)));
    for (const t of s.tests) sec.appendChild(renderTest(t));
    app.appendChild(sec);
  });

  function renderTest(t) {
    const r = result(t.id);
    const art = el("article", { class: "test", id: t.id });
    const head = el("div", { class: "test-head" });
    head.appendChild(el("span", { class: "test-id" }, esc(t.id)));
    head.appendChild(el("h3", null, fmt(t.title)));
    head.appendChild(el("span", { class: "pill", "data-pill": t.id }));
    art.appendChild(head);
    if (t.why) art.appendChild(el("p", { class: "why" }, fmt(t.why)));
    if (t.before) art.appendChild(el("p", { class: "before" }, `<strong>First:</strong> ${fmt(t.before)}`));

    const steps = el("div");
    steps.appendChild(el("p", { class: "label" }, "Steps"));
    const ol = el("ol");
    for (const s of t.steps) ol.appendChild(el("li", null, fmt(s)));
    steps.appendChild(ol);
    art.appendChild(steps);

    const exp = el("div");
    exp.appendChild(el("p", { class: "label" }, "You should see"));
    const ul = el("ul");
    for (const s of t.expected) ul.appendChild(el("li", null, fmt(s)));
    exp.appendChild(ul);
    art.appendChild(exp);

    const fs = el("fieldset", { class: "status" });
    fs.appendChild(el("legend", { class: "sr" }, `Result for ${esc(t.id)}`));
    for (const key of STATUS_ORDER) {
      const label = el("label");
      const input = el("input", { type: "radio", name: `${t.id}-status`, id: `${t.id}-${key}`, value: key });
      input.checked = r.status === key;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        setResult(t.id, { status: key });
        refresh();
      });
      label.appendChild(input);
      label.appendChild(el("span", null, STATUSES[key].label));
      fs.appendChild(label);
    }
    art.appendChild(fs);

    const notes = el("div", { class: "field" });
    notes.appendChild(el("label", { for: `${t.id}-notes` }, 'Notes <span class="hint">(optional)</span>'));
    const ta = el("textarea", {
      id: `${t.id}-notes`,
      rows: "2",
      placeholder: "What did you see? Anything odd, slow or confusing?",
    });
    ta.value = r.notes ?? "";
    ta.addEventListener("input", () => {
      setResult(t.id, { notes: ta.value });
      refreshPreview();
    });
    notes.appendChild(ta);
    art.appendChild(notes);
    return art;
  }

  // Not covered
  if (plan.notCovered?.length) {
    const sec = el("section", { id: "not-covered" });
    sec.appendChild(el("h2", null, "Not covered by this plan"));
    sec.appendChild(
      el(
        "p",
        { class: "intro" },
        "These parts of the change can't be checked by using the app, or are already covered by automated tests."
      )
    );
    const ul = el("ul", { class: "plain" });
    for (const s of plan.notCovered) ul.appendChild(el("li", null, fmt(s)));
    sec.appendChild(ul);
    app.appendChild(sec);
  }

  // Finish
  const finish = el("section", { id: "finish" });
  finish.appendChild(el("h2", null, "Share your results"));
  finish.appendChild(
    el(
      "p",
      { class: "intro" },
      "Copy your results and paste them into a comment on the pull request. Tests you didn't get to are listed as not tested."
    )
  );
  const actions = el("div", { class: "finish-actions" });
  const copy2 = el("button", { type: "button", class: "primary", id: "copy-btn-2" }, "Copy results");
  const clearBtn = el("button", { type: "button", class: "danger", id: "clear-btn" }, "Clear my results");
  actions.append(copy2, clearBtn);
  finish.appendChild(actions);
  const previewDetails = el("details", { class: "preview" });
  previewDetails.appendChild(el("summary", null, "Show the text that gets copied"));
  const previewArea = el("textarea", { id: "results-preview", readonly: "", rows: "12" });
  previewDetails.appendChild(previewArea);
  finish.appendChild(previewDetails);
  app.appendChild(finish);

  // Behaviour
  const toastEl = document.getElementById("toast");
  let toastTimer;
  const toast = (msg) => {
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.textContent = ""), 6000);
  };

  function copyResults() {
    const md = markdown();
    previewArea.value = md;
    const fallback = () => {
      previewDetails.open = true;
      previewArea.focus();
      previewArea.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      toast(
        ok
          ? "Copied. Paste it into a comment on the pull request."
          : "Your browser blocked copying. The text is selected below; press Ctrl+C (or Cmd+C on Mac) to copy it."
      );
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(md)
        .then(() => toast("Copied. Paste it into a comment on the pull request."), fallback);
    } else {
      fallback();
    }
  }

  let armTimer;
  const disarm = () => {
    clearBtn.dataset.armed = "false";
    clearBtn.textContent = "Clear my results";
  };
  clearBtn.addEventListener("click", () => {
    if (clearBtn.dataset.armed !== "true") {
      clearBtn.dataset.armed = "true";
      clearBtn.textContent = "Click again to clear every result";
      clearTimeout(armTimer);
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    clearTimeout(armTimer);
    disarm();
    state.results = {};
    save();
    for (const t of plan.tests) {
      for (const k of STATUS_ORDER) document.getElementById(`${t.id}-${k}`).checked = false;
      document.getElementById(`${t.id}-notes`).value = "";
    }
    refresh();
    toast("Cleared your results. Your name and device were kept.");
  });

  function nextUntested() {
    const t = plan.tests.find((t) => !result(t.id).status);
    if (!t) {
      toast("Every test has a result. Copy your results when you're ready.");
      finish.scrollIntoView({ block: "start" });
      return;
    }
    document.getElementById(t.id).scrollIntoView({ block: "start" });
    document.getElementById(`${t.id}-pass`).focus({ preventScroll: true });
  }

  function refreshPreview() {
    previewArea.value = markdown();
  }

  function refresh() {
    const c = { pass: 0, fail: 0, blocked: 0, skip: 0 };
    for (const t of plan.tests) {
      const s = result(t.id).status;
      if (s in c) c[s] += 1;
    }
    const done = STATUS_ORDER.reduce((n, k) => n + c[k], 0);
    const total = plan.tests.length;
    document.getElementById("progress-label").innerHTML = [
      `<strong>${done} of ${total} tested</strong>`,
      ...STATUS_ORDER.filter((k) => c[k]).map((k) => `<span>${c[k]} ${STATUSES[k].word}</span>`),
    ].join("");
    document.getElementById("meter").innerHTML = STATUS_ORDER.map((k) =>
      c[k] ? `<span class="m-${k}" style="width:${(100 * c[k]) / total}%"></span>` : ""
    ).join("");
    for (const t of plan.tests) {
      const pill = document.querySelector(`[data-pill="${t.id}"]`);
      const s = result(t.id).status;
      pill.dataset.status = s || "";
      pill.textContent = STATUSES[s]?.pill ?? "Not tested";
    }
    refreshPreview();
  }

  copy2.addEventListener("click", copyResults);
  document.getElementById("copy-btn").addEventListener("click", copyResults);
  document.getElementById("next-btn").addEventListener("click", nextUntested);
  document.getElementById("bar").hidden = false;
  refresh();
}

const planId = new URLSearchParams(location.search).get("plan");
if (planId === null) showHome();
else showPlan(planId);

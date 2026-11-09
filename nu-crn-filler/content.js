// NU CRN Filler content script.
//
// How it finds courses: Find Classes → Advanced Search → Subject + College + Campus →
// Search, then it pages through the results to find each CRN and clicks Add.
//
// Manual mode: "Search & add now" adds your main CRNs without submitting.
// Scheduled mode: at your registration time, adds and submits your main CRNs. A CRN
// that fails is retried up to MAX_ATTEMPTS times total; after that, the next
// backup CRN takes its place (with the same limit).
//
// If Banner crashes, shows an error page, or stops responding, the extension
// pauses, alerts you (sound + desktop notification), and saves its progress.
// Reload the page and it resumes where it left off. It never reloads by itself.
//
// SELECTORS and STATUS words match Banner 9's standard registration page.
// Verify them with DevTools (right-click > Inspect) and edit if NU's differs.

// ---------------- Settings ----------------
const SEL = {
  findClassesTab: "#classSearch-tab",
  searchGo: "#search-go",
  searchAgain: "#search-again-button",
  submitBtn: "#saveButton",
  summaryRows: "#summaryBody tr, #summary tr, [id*='summary' i] tr, [id*='summary' i] [role='row']",
};

const STATUS = {
  failed: [/error/i, /deleted/i, /closed/i, /not registered/i, /full/i],
  ok: [/registered/i, /waitlisted/i],
};

// Text that means Banner itself is broken, not that a course failed.
const PAGE_ERRORS = [
  /service unavailable/i, /bad gateway/i, /gateway time-?out/i, /internal server error/i,
  /\b50[234]\b.*error/i, /an unexpected error/i, /session (has )?(expired|timed out)/i,
  /your session is about to expire/i,
];

const MAX_ATTEMPTS = 3;            // submits per CRN, including the first
const RETRY_DELAY_MS = 5000;       // pause between retry rounds
const GRACE_MS = 10 * 60 * 1000;   // how long to wait for Find Classes to appear
const RESULT_TIMEOUT_MS = 60000;   // how long to wait for Banner to show results
const STALE_MS = 60 * 60 * 1000;   // give up resuming a run older than this

// ---------------- Helpers ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAB_ID = Math.random().toString(36).slice(2);

function waitFor(selector, timeout = 4000) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
  });
}

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  ["input", "change", "keyup", "blur"].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
}

// Find a button by its usual Banner id first, then by its visible text.
// scope limits the text search (e.g. to the Enter CRNs panel) so we never
// click an "Add" button in the Find Classes results by mistake.
function findButton(selector, textRe, scope = document) {
  const byId = document.querySelector(selector);
  if (byId && (byId.offsetParent || byId.getClientRects().length)) return byId;
  return [...scope.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button]")].find((b) =>
    (b.offsetParent || b.getClientRects().length) && !b.disabled &&
    textRe.test((b.innerText || b.value || b.getAttribute("aria-label") || "").trim())) || null;
}

const BTN_TEXT = {
  add: /^add( course| section)?$/i,
  submit: /^submit$/i,
};

function pageError() {
  const text = (document.title + " " + (document.body?.innerText || "")).slice(0, 20000);
  const hit = PAGE_ERRORS.find((re) => re.test(text));
  return hit ? text.match(hit)[0] : null;
}

// ---------------- Alerts ----------------
let bannerEl = null;
function showBanner(text, kind = "info") {
  if (!bannerEl) {
    bannerEl = document.createElement("div");
    bannerEl.setAttribute("role", "status");
    Object.assign(bannerEl.style, {
      position: "fixed", top: "0", left: "0", right: "0", zIndex: 2147483647,
      padding: "10px 16px", font: "600 14px/1.4 system-ui, sans-serif", color: "#fff",
      textAlign: "center", boxShadow: "0 2px 6px rgba(0,0,0,.25)",
    });
    document.documentElement.appendChild(bannerEl);
  }
  bannerEl.style.background = kind === "error" ? "#C8102E" : kind === "ok" ? "#1f7a3a" : "#333";
  bannerEl.textContent = "NU CRN Filler: " + text;
}

function beep(times = 3) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35);
      o.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
  } catch (_) { /* audio may be blocked; the notification still shows */ }
}

function alertUser(message, { urgent = true, kind = "error" } = {}) {
  showBanner(message, kind);
  if (urgent) beep();
  chrome.runtime.sendMessage({
    type: "ALERT", urgent,
    title: urgent ? "Registration needs you" : "NU CRN Filler",
    message,
  });
}

// ---------------- Find Classes search ----------------
// The extension uses Banner's Find Classes tab: it opens Advanced Search, picks
// your Subject and Campus, searches, then pages through the results to find each
// CRN and clicks that row's Add / Add Course button.

const norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const MAX_PAGES = 30;

function fire(el, types) {
  types.forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
}

async function waitUntil(fn, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(200);
  }
  return null;
}

const searchFormVisible = () => isVisible(document.querySelector(SEL.searchGo));
const resultsVisible = () => isVisible(document.querySelector(SEL.searchAgain));
const inSummary = (el) => !!el.closest("[id*='summary' i]");

// Find the select2 box for a field like "subject" or "campus", by id or by its label.
function select2Box(field) {
  const byId = document.querySelector(`#s2id_txt_${field}`);
  if (byId) return byId;
  const re = new RegExp(`^\\s*${field}\\s*$`, "i");
  const label = [...document.querySelectorAll("label")].find((l) => re.test(l.textContent));
  if (!label) return null;
  if (label.htmlFor) {
    const box = document.querySelector(`#s2id_${label.htmlFor}`);
    if (box) return box;
  }
  return label.parentElement?.querySelector(".select2-container") ||
         label.closest("div, tr, li")?.parentElement?.querySelector(".select2-container") || null;
}

async function chooseOption(field, value) {
  const box = select2Box(field);
  if (!box || !isVisible(box)) return `Couldn’t find the ${field} box.`;
  const want = norm(value);

  // Remove anything already chosen (e.g. a wrong subject left over).
  for (const x of box.querySelectorAll(".select2-search-choice-close, .select2-selection__choice__remove")) {
    fire(x, ["mousedown", "mouseup", "click"]);
    await sleep(100);
  }

  fire(box.querySelector(".select2-choices, .select2-selection, .select2-choice") || box, ["mousedown", "mouseup", "click"]);
  const input = box.querySelector("input.select2-input, input.select2-search__field") ||
                document.querySelector(".select2-drop-active input.select2-input, .select2-search__field");
  if (!input) return `Couldn’t open the ${field} dropdown.`;
  input.focus();
  setValue(input, value);
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

  // Prefer an exact match, then one that starts with the text, then one that contains it.
  const option = await waitUntil(() => {
    const opts = [...document.querySelectorAll(".select2-result-label, .select2-results__option")].filter(isVisible);
    return opts.find((o) => norm(o.innerText) === want) ||
           opts.find((o) => norm(o.innerText).startsWith(want)) ||
           opts.find((o) => norm(o.innerText).includes(want)) || null;
  }, 10000);
  if (!option) return `“${value}” didn’t appear in the ${field} list.`;
  fire(option, ["mouseover", "mousedown", "mouseup", "click"]);
  await sleep(400);
  if (!norm(box.innerText).includes(want.split(" ")[0])) return `Couldn’t confirm ${field} was set to “${value}”.`;
  return null;
}

function resultsSnapshot() {
  return [...document.querySelectorAll("tr, [role=row]")]
    .filter((r) => isVisible(r) && !inSummary(r)).slice(0, 5).map((r) => r.innerText).join("|");
}

function pagingButton(kind) {
  const re = kind === "next" ? /next/i : /first/i;
  return [...document.querySelectorAll("button, a, [role=button]")].find((b) => {
    if (!isVisible(b) || b.disabled || b.getAttribute("aria-disabled") === "true" || /disabled/i.test(b.className)) return false;
    const label = [b.className, b.title, b.getAttribute("aria-label"), b.innerText].join(" ");
    return /paging|page/i.test(label) && re.test(label);
  }) || null;
}

async function clickForNewPage(btn) {
  const before = resultsSnapshot();
  btn.click();
  return !!(await waitUntil(() => { const now = resultsSnapshot(); return now && now !== before; }, 15000));
}

async function maxPageSize() {
  const sel = [...document.querySelectorAll("select")].find((el) =>
    isVisible(el) && /page/i.test(el.id + " " + el.className + " " + el.name) &&
    el.options.length && [...el.options].every((o) => /^\d+$/.test(o.value)));
  if (!sel) return;
  const max = Math.max(...[...sel.options].map((o) => +o.value));
  if (+sel.value === max) return;
  const before = resultsSnapshot();
  sel.value = String(max);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await waitUntil(() => resultsSnapshot() !== before, 10000);
  await sleep(300);
}

async function runSearch(cfg) {
  const tab = document.querySelector(SEL.findClassesTab);
  if (tab && isVisible(tab)) { tab.click(); await sleep(300); }

  if (resultsVisible()) {
    document.querySelector(SEL.searchAgain).click();
    await waitUntil(searchFormVisible, 8000);
  }
  if (!searchFormVisible()) return "Couldn’t find the Find Classes search form.";

  // Open Advanced Search so the College and Campus boxes show.
  const advField = cfg.college ? "college" : "campus";
  if (!isVisible(select2Box(advField))) {
    const adv = [...document.querySelectorAll("a, button")].find((a) => isVisible(a) && /advanced search/i.test(a.innerText));
    if (adv) { adv.click(); await waitUntil(() => isVisible(select2Box(advField)), 5000); }
  }

  const subjErr = await chooseOption("subject", cfg.subject);
  if (subjErr) return subjErr;
  if (cfg.college) {
    const colErr = await chooseOption("college", cfg.college);
    if (colErr) return colErr;
  }
  if (cfg.campus) {
    const campErr = await chooseOption("campus", cfg.campus);
    if (campErr) return campErr;
  }

  const before = resultsSnapshot();
  document.querySelector(SEL.searchGo).click();
  const ok = await waitUntil(() => resultsVisible() && resultsSnapshot() !== before, 30000);
  if (!ok) return "Search results didn’t load within 30 seconds.";
  await sleep(400);
  await maxPageSize();
  return null;
}

function resultRowFor(crn) {
  const re = new RegExp(`\\b${crn}\\b`);
  return [...document.querySelectorAll("tr, [role=row]")].find((r) => isVisible(r) && !inSummary(r) && re.test(r.innerText)) || null;
}

function addButtonIn(row) {
  return [...row.querySelectorAll("button, a, input[type=button]")].find((b) =>
    isVisible(b) && !b.disabled && BTN_TEXT.add.test((b.innerText || b.value || b.getAttribute("aria-label") || "").trim())) || null;
}

// ---------------- Full / closed sections ----------------
// In search results Banner shows seat info like "FULL: 0 of 30 seats remain".
const FULL_IN_RESULTS = [/\bfull\b/i, /\bclosed\b/i, /(^|\D)0 of \d+ seats? remain/i];
// After Submit, the error for a full section mentions it being closed/full.
const FULL_AFTER_SUBMIT = /closed|\bfull\b|no (remaining )?seats|capacity|maximum enrollment/i;

function rowIsFull(row) {
  const text = textWithoutDropdowns(row);
  return FULL_IN_RESULTS.some((re) => re.test(text));
}

// Did Banner reject this CRN because the section is full or closed?
function rejectedAsFull(crn) {
  const texts = [];
  const row = rowFor(crn);
  if (row) texts.push(textWithoutDropdowns(row));
  document.querySelectorAll(".notification-item, [role=alert], .notification-center-message, .notification-flyout-item")
    .forEach((n) => { if (isVisible(n) && n.innerText.includes(crn)) texts.push(n.innerText); });
  return texts.some((t) => FULL_AFTER_SUBMIT.test(t));
}

// Go back to the first page of results.
async function firstPage() {
  const first = pagingButton("first");
  if (first) await clickForNewPage(first);
}

// Make sure search results are showing (search if needed).
async function ensureResults(readyTimeout) {
  const ready = await waitFor(`${SEL.searchGo}, ${SEL.searchAgain}, ${SEL.findClassesTab}`, readyTimeout);
  if (!ready) return "Couldn’t find Find Classes. Open Register for Classes and pick your term.";
  const { search: cfg = {} } = await chrome.storage.local.get("search");
  if (!cfg.subject) return "Set a Subject in the extension popup first.";
  if (resultsVisible()) return null;
  showBanner(`Searching ${[cfg.subject, cfg.college, cfg.campus].filter(Boolean).join(" · ")}…`);
  const err = await runSearch(cfg);
  if (err) return pageError() ? `Banner showed an error (“${pageError()}”).` : err;
  return null;
}

// Pass 1: page through all results and note which candidate CRNs are there
// and have an Add button. Nothing is clicked except the paging buttons.
async function scanResults(cands) {
  const found = new Map(); // crn -> page number
  const noButton = new Set();
  const full = new Set();
  await firstPage();
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (pageError()) return { error: `Banner showed an error (“${pageError()}”).` };
    for (const crn of cands) {
      if (found.has(crn) || noButton.has(crn) || full.has(crn)) continue;
      const row = resultRowFor(crn);
      if (!row) continue;
      if (rowIsFull(row)) full.add(crn);          // full: skip, next candidate moves up
      else if (addButtonIn(row)) found.set(crn, page);
      else noButton.add(crn);
    }
    if (cands.every((c) => found.has(c) || noButton.has(c) || full.has(c))) break;
    const next = pagingButton("next");
    if (!next || !(await clickForNewPage(next))) break;
  }
  return {
    found, noButton: [...noButton], full: [...full],
    notFound: cands.filter((c) => !found.has(c) && !noButton.has(c) && !full.has(c)),
  };
}

// Pass 2: click Add for exactly the chosen CRNs and confirm each lands in the summary.
async function addChosen(chosen, found) {
  await firstPage();
  const lastPage = Math.max(...chosen.map((c) => found.get(c)));
  const added = [];
  for (let page = 1; page <= lastPage; page++) {
    for (const crn of chosen.filter((c) => found.get(c) === page)) {
      const row = resultRowFor(crn);
      const btn = row && addButtonIn(row);
      if (!btn) return { error: `${crn} disappeared from the results before it could be added.`, added };
      btn.click();
      showBanner(`Added ${crn}…`);
      if (!(await waitUntil(() => rowFor(crn), 10000))) {
        return { error: `Clicked Add for ${crn}, but it didn’t appear in the summary.`, added };
      }
      added.push(crn);
      await sleep(150);
    }
    if (page < lastPage) {
      const next = pagingButton("next");
      if (!next || !(await clickForNewPage(next))) return { error: "Couldn’t move to the next results page.", added };
    }
  }
  return { added };
}

// Find candidates (in preference order), pick the first `need` that exist,
// and add them. Returns which were added and which were missing.
async function prepareRound(cands, need, readyTimeout) {
  const err = await ensureResults(readyTimeout);
  if (err) return { error: err };
  showBanner(`Looking for ${cands.join(", ")}…`);
  const scan = await scanResults(cands);
  if (scan.error) return scan;
  const chosen = cands.filter((c) => scan.found.has(c)).slice(0, need);
  const missing = [...scan.notFound, ...scan.noButton, ...scan.full];
  const base = { chosen, missing, notFound: scan.notFound, noButton: scan.noButton, full: scan.full };
  if (!chosen.length) return { ...base, added: [] };
  const add = await addChosen(chosen, scan.found);
  if (add.error) return { error: add.error };
  return { ...base, added: add.added };
}

// Click Submit once and read the results for these CRNs.
async function submitAdded(list) {
  // On a retry, give Banner a moment to replace old error rows with new pending ones.
  const t = Date.now();
  while (Date.now() - t < 3000 && list.some((c) => statusOf(c) === "failed")) await sleep(150);
  await sleep(300);
  await waitFor(SEL.submitBtn, 15000);
  const submit = findButton(SEL.submitBtn, BTN_TEXT.submit);
  if (!submit) return { error: "Couldn’t find the Submit button.", beforeSubmit: true };
  // Safety: on the Plan Ahead page this same id is "Save Plan". Never click that.
  if (/plan/i.test(submit.innerText || submit.value || "")) {
    return { error: "This looks like the Plan page, not registration. Open Register for Classes.", beforeSubmit: true };
  }
  submit.click();
  await sleep(800);
  return waitForResults(list);
}

// ---------------- Reading results ----------------
// Only rows in the Summary panel, never the search results.
function rowFor(crn) {
  const re = new RegExp(`\\b${crn}\\b`);
  return [...document.querySelectorAll(SEL.summaryRows)].filter((r) => re.test(r.innerText)).pop() || null;
}

// Read only the Status column of a summary row. The Action column holds a
// dropdown whose options (like "Web Drop Deleted") would otherwise be misread.
function textWithoutDropdowns(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll("select, option, [role=listbox], [role=option]").forEach((n) => n.remove());
  return (copy.textContent || "").replace(/\\s+/g, " ").trim();
}

function statusCellText(row) {
  const cells = [...row.children];
  // 1) Banner 9 grids label cells with data-property (e.g. data-property="status").
  const byProp = row.querySelector("[data-property*='status' i], [data-name*='status' i], [headers*='status' i]");
  if (byProp) return { text: textWithoutDropdowns(byProp), fromColumn: true, how: "data-property" };

  // 2) Find a "Status" header. Banner often draws the header in a separate table,
  //    so look in the surrounding summary panel, not just this row's table.
  const isStatus = (c) => /^\s*status\s*$/i.test(c.textContent);
  const scopes = [
    row.closest("table, [role=grid], [role=table]"),
    row.closest("[id*='summary' i]"),
    row.closest("[id*='summary' i]")?.parentElement,
  ].filter(Boolean);
  for (const scope of scopes) {
    const header = [...scope.querySelectorAll("th, [role=columnheader], td, div")].find(
      (c) => isStatus(c) && c !== row && !row.contains(c) && c.parentElement && c.parentElement.children.length > 3);
    if (!header) continue;
    const idx = [...header.parentElement.children].indexOf(header);
    if (idx >= 0 && cells[idx] && cells.length === header.parentElement.children.length) {
      return { text: textWithoutDropdowns(cells[idx]), fromColumn: true, how: "表头第 " + (idx + 1) + " 列" };
    }
  }

  // 3) Fallback: whole row, with spaces between cells so words don't run together.
  const text = cells.length ? cells.map(textWithoutDropdowns).join(" ") : textWithoutDropdowns(row);
  return { text: text.replace(/\s+/g, " ").trim(), fromColumn: false, how: "整行" };
}

function statusOf(crn) {
  const row = rowFor(crn);
  if (!row) return "unknown";
  const text = statusCellText(row).text;
  if (STATUS.failed.some((re) => re.test(text))) return "failed";
  if (STATUS.ok.some((re) => re.test(text))) return "ok";
  return "unknown";
}

async function waitForInSummary(crns, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pageError()) return false;
    if (crns.every((c) => rowFor(c))) return true;
    await sleep(200);
  }
  return false;
}

async function waitForResults(crns, timeout = RESULT_TIMEOUT_MS) {
  const start = Date.now();
  let results = {};
  while (Date.now() - start < timeout) {
    const err = pageError();
    if (err) return { error: `Banner showed an error (“${err}”).` };
    results = Object.fromEntries(crns.map((c) => [c, statusOf(c)]));
    if (Object.values(results).every((s) => s !== "unknown")) break;
    if (Date.now() - start > 15000) showBanner("Banner is slow. Still waiting for results…");
    await sleep(300);
  }
  return { results };
}

// ---------------- Saved progress ----------------
// schedule = { time, state: "armed" | "firing" | "paused" | "done", message, ok, progress }
// progress = { registered, failed, attempts, queue, toTry, inFlight }

async function getSchedule() {
  return (await chrome.storage.local.get("schedule")).schedule;
}

async function saveProgress(progress, state = "firing", message = "") {
  const s = await getSchedule();
  if (!s) return false; // cancelled from the popup
  await chrome.storage.local.set({ schedule: { ...s, state, message, progress } });
  return true;
}

function finish(ok, message) {
  stopLock();
  return chrome.storage.local.set({ schedule: { state: "done", ok, message, finishedAt: Date.now() } });
}

// Only one Banner tab runs at a time.
let lockTimer = null;
async function takeLock() {
  // A lock from before a page reload goes stale within ~6 s, so wait that long
  // rather than give up. A lock that stays fresh belongs to another open tab.
  const start = Date.now();
  while (true) {
    const { runLock } = await chrome.storage.local.get("runLock");
    if (!runLock || runLock.id === TAB_ID || Date.now() - runLock.at >= 6000) break;
    if (Date.now() - start > 9000) return false;
    await sleep(500);
  }
  const beat = () => chrome.storage.local.set({ runLock: { id: TAB_ID, at: Date.now() } });
  await beat();
  lockTimer = setInterval(beat, 2000);
  return true;
}
addEventListener("pagehide", () => { if (lockTimer) chrome.storage.local.remove("runLock"); });

function stopLock() {
  clearInterval(lockTimer);
  chrome.storage.local.remove("runLock");
}

function summary(p) {
  const parts = [];
  if (p.registered.length) parts.push(`Registered: ${p.registered.join(", ")}.`);
  if (p.failed.length) parts.push(`Didn’t work: ${p.failed.join(", ")}.`);
  return parts.join(" ");
}

// After Banner reports on a submitted CRN: registered, retry, or give up on it.
function classify(p, crn, status, keep) {
  if (status === "ok") p.registered.push(crn);
  else if ((p.attempts[crn] || 0) < MAX_ATTEMPTS) keep.push(crn);
  else p.failed.push(crn);
}

async function pause(p, reason) {
  await saveProgress(p, "paused", `${reason} Reload the registration page and it will pick up where it left off.`);
  stopLock();
  alertUser(`${reason} Reload this page to resume. ${summary(p)}`);
}

// ---------------- Main loop ----------------
// Each round:
//   1. need = how many courses are still missing (target is your number of main CRNs).
//   2. Candidates, in order: CRNs still being tried, then unused backups.
//   3. Scan the search results. A CRN that isn't there (or has no Add button)
//      is dropped right away and the next backup moves up.
//   4. Add exactly `need` CRNs. Submit ONLY if all `need` were added.
//   5. Read results. Registered ones count toward the target; failed ones are
//      retried (up to MAX_ATTEMPTS submits), then dropped for a backup.
//   6. Stop as soon as the target is reached.
let running = false;

async function runEngine(p, readyTimeout) {
  while (true) {
    if (!(await getSchedule())) { stopLock(); showBanner("Cancelled."); return; }
    const need = p.target - p.registered.length;
    if (need <= 0) break;
    const cands = [...p.toTry, ...p.queue];
    if (!cands.length) break;

    const r = await prepareRound(cands, need, readyTimeout);
    readyTimeout = 15000;
    if (r.error) return pause(p, r.error);

    for (const c of r.missing) {
      p.toTry = p.toTry.filter((x) => x !== c);
      p.queue = p.queue.filter((x) => x !== c);
      if (!p.failed.includes(c)) p.failed.push(c);
    }
    if (r.notFound.length) p.notes.push(`Not in search results: ${r.notFound.join(", ")}.`);
    if (r.noButton.length) p.notes.push(`No Add button: ${r.noButton.join(", ")}.`);
    if (r.full.length) p.notes.push(`Full: ${r.full.join(", ")}.`);

    // The chosen CRNs are now the ones being tried; unchosen backups stay in reserve.
    p.toTry = r.chosen.slice();
    p.queue = p.queue.filter((c) => !r.chosen.includes(c));
    await saveProgress(p);

    if (!r.chosen.length) break;
    if (r.added.length < need) {
      // Not enough courses available: don't submit a partial set.
      const msg = `${summary(p)} Only ${r.added.length} of the ${need} course(s) still needed could be found (${r.added.join(", ")}). ` +
        `They are in your summary but NOT submitted. Review and click Submit yourself if you want them. ${p.notes.join(" ")}`;
      await finish(false, msg);
      alertUser(msg);
      return;
    }

    p.toTry.forEach((c) => (p.attempts[c] = (p.attempts[c] || 0) + 1));
    p.inFlight = [...p.toTry];
    await saveProgress(p);
    showBanner(`Submitting ${p.toTry.join(", ")}…`);

    const sub = await submitAdded(p.toTry);
    if (sub.error) {
      if (sub.beforeSubmit) { p.toTry.forEach((c) => p.attempts[c]--); p.inFlight = []; }
      return pause(p, sub.error);
    }

    const keep = [], unclear = [];
    for (const crn of p.toTry) {
      const s = sub.results[crn];
      if (s === "unknown") unclear.push(crn);
      else if (s === "failed" && rejectedAsFull(crn)) {
        // Full or closed: retrying won't help, so move to the next backup now.
        p.failed.push(crn);
        p.notes.push(`Full after submit: ${crn}.`);
      }
      else classify(p, crn, s, keep);
    }
    if (unclear.length) {
      p.inFlight = unclear;
      p.toTry = keep;
      return pause(p, `Banner didn’t confirm ${unclear.join(", ")} within ${RESULT_TIMEOUT_MS / 1000} seconds.`);
    }
    p.inFlight = [];
    p.toTry = keep;
    await saveProgress(p);
    if (p.target - p.registered.length > 0 && (p.toTry.length || p.queue.length)) {
      showBanner(`Retrying in ${RETRY_DELAY_MS / 1000} seconds… ${summary(p)}`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  const allDone = p.registered.length >= p.target;
  const msg = summary(p) + (allDone ? "" : ` Ran out of tries and backups. ${p.notes.join(" ")} Check Banner for the reasons.`);
  await finish(allDone, msg);
  alertUser(msg, { urgent: !allDone, kind: allDone ? "ok" : "error" });
}

async function startFresh() {
  if (running) return;
  const s = await getSchedule();
  const { crns = [], backups = [] } = await chrome.storage.local.get(["crns", "backups"]);
  if (s?.state !== "armed" || !crns.length) return;
  if (!(await takeLock())) return;
  running = true;
  const p = { target: crns.length, registered: [], failed: [], attempts: {}, queue: [...backups],
              toTry: [...crns], inFlight: [], notes: [] };
  await saveProgress(p);
  await runEngine(p, Math.max(0, s.time + GRACE_MS - Date.now()));
  running = false;
}

async function resume() {
  if (running) return;
  const s = await getSchedule();
  if (!s?.progress || !["firing", "paused"].includes(s.state)) return;
  if (Date.now() - s.time > STALE_MS) {
    return finish(false, `Stopped: the run was interrupted over an hour ago. ${summary(s.progress)} Check Banner.`);
  }
  const err = pageError();
  if (err) return alertUser(`Banner is showing an error (“${err}”). Reload again in a moment to resume.`);
  if (!(await takeLock())) return;
  running = true;
  const p = s.progress;
  if (!p.notes) p.notes = [];
  if (!p.target) p.target = ((await chrome.storage.local.get("crns")).crns || []).length;
  showBanner("Resuming. Pick your term if Banner asks.");

  // First, find out what happened to anything that was mid-submit when things broke.
  if (p.inFlight.length) {
    const ready = await waitFor(`${SEL.searchGo}, ${SEL.searchAgain}, ${SEL.findClassesTab}`, GRACE_MS);
    if (!ready) { running = false; return pause(p, "The registration page didn’t load."); }
    let statuses = {};
    const start = Date.now();
    while (Date.now() - start < 20000) {
      statuses = Object.fromEntries(p.inFlight.map((c) => [c, statusOf(c)]));
      if (Object.values(statuses).every((v) => v !== "unknown")) break;
      await sleep(300);
    }
    const unknown = p.inFlight.filter((c) => statuses[c] === "unknown");
    if (unknown.length) {
      // Can't tell if these went through. Stop rather than risk going over your course limit.
      const msg = `${summary(p)} Couldn’t confirm whether ${unknown.join(", ")} registered. Check Banner and finish by hand.`;
      await finish(false, msg);
      alertUser(msg);
      running = false;
      return;
    }
    const keep = [];
    for (const crn of p.inFlight) classify(p, crn, statuses[crn], keep);
    p.toTry = [...keep, ...p.toTry.filter((c) => !keep.includes(c) && !p.registered.includes(c) && !p.failed.includes(c))];
    p.inFlight = [];
    await saveProgress(p);
  }

  await runEngine(p, GRACE_MS);
  running = false;
}

// ---------------- Startup ----------------
// ---------------- Auto-Continue on the term page ----------------
// On "Select a Term", pick your term ahead of time but don't click Continue.
// At your scheduled time the extension clicks Continue. If Banner says your
// time ticket isn't open yet (your clock is a little early), it closes that
// message and tries again, up to CONTINUE_TRIES times.
const CONTINUE_TRIES = 3;
const CONTINUE_RETRY_MS = 2000;
const NOT_OPEN_YET = /no registration time ticket|you can register from/i;

function isTermPage() {
  return /\/term\//i.test(location.pathname) || !!document.querySelector("#term-go");
}

function termChosen() {
  const v = document.querySelector("#txt_term")?.value;
  if (v) return true;
  const chosen = document.querySelector("#s2id_txt_term .select2-chosen, #s2id_txt_term .select2-selection__rendered");
  return !!(chosen && chosen.textContent.trim() && !/select|choose/i.test(chosen.textContent));
}

function notOpenMessage() {
  return [...document.querySelectorAll(".notification-item, [role=alert], .notification-center-message, .error")]
    .find((n) => isVisible(n) && NOT_OPEN_YET.test(n.innerText)) || null;
}

function dismissMessages() {
  [...document.querySelectorAll("button, a")].filter((b) => isVisible(b) && /^ok$/i.test(b.innerText.trim()))
    .forEach((b) => b.click());
  document.querySelectorAll(".notification-flyout-item-close, .notification-close").forEach((b) => b.click());
}

async function autoContinue() {
  if (!termChosen()) {
    return alertUser("It’s your registration time, but no term is selected. Pick your term and click Continue now.");
  }
  for (let attempt = 1; attempt <= CONTINUE_TRIES; attempt++) {
    const btn = findButton("#term-go", /^continue$/i);
    if (!btn) return alertUser("Couldn’t find the Continue button. Click it yourself now.");
    showBanner(`Clicking Continue${attempt > 1 ? ` (try ${attempt} of ${CONTINUE_TRIES})` : ""}…`);
    const startPath = location.href;
    btn.click();
    // Success = the page moves on to registration (this script then reloads there).
    const outcome = await waitUntil(() =>
      location.href !== startPath ? "moved" : notOpenMessage() ? "notOpen" : null, 8000);
    if (outcome === "moved" || outcome === null && !isTermPage()) return;
    if (outcome === "notOpen") {
      dismissMessages();
      if (attempt < CONTINUE_TRIES) { await sleep(CONTINUE_RETRY_MS); continue; }
      return alertUser("Banner still says your registration time hasn’t started. Check the time and click Continue yourself.");
    }
    if (outcome === null) {
      // No message and no navigation within 8 s: Banner may just be slow.
      if (!isTermPage()) return;
      if (attempt < CONTINUE_TRIES) continue;
      return alertUser("Clicked Continue but the page didn’t move on. Click it yourself now.");
    }
  }
}

let timer = null;
function onSchedule(s) {
  clearTimeout(timer);
  if (!s) { if (bannerEl) showBanner("Cancelled."); return; }
  if (s.state === "armed") {
    const wait = s.time - Date.now();
    if (wait < -GRACE_MS) return finish(false, "The scheduled time passed while the page wasn’t open.");
    if (isTermPage()) {
      // On the term page we only click Continue; registration starts on the next page.
      showBanner(`At ${new Date(s.time).toLocaleTimeString()} the extension will click Continue. Pick your term now, but don’t click Continue.`);
      if (wait > -GRACE_MS) timer = setTimeout(autoContinue, Math.max(0, wait));
      return;
    }
    showBanner(`Scheduled for ${new Date(s.time).toLocaleTimeString()}. Keep this tab open.`);
    timer = setTimeout(startFresh, Math.max(0, wait));
  }
}

// Never run on Browse Classes or Plan Ahead: only on real registration pages.
const NOT_REGISTRATION = /\/ssb\/classSearch\//i.test(location.pathname) ||
  /\/ssb\/plan\//i.test(location.pathname) ||
  (/\/ssb\/term\//i.test(location.pathname) && /mode=(search|plan)/i.test(location.search));

if (!NOT_REGISTRATION) {
  chrome.storage.local.get("schedule", ({ schedule: s }) => {
    if (s && ["firing", "paused"].includes(s.state)) resume();
    else onSchedule(s);
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.schedule && c.schedule.newValue?.state !== c.schedule.oldValue?.state) {
      if (c.schedule.newValue?.state === "armed" || !c.schedule.newValue) onSchedule(c.schedule.newValue);
    }
  });
}

// ---------------- Manual fill from the popup ----------------
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== "SEARCH_ADD") return;
  if (NOT_REGISTRATION) { sendResponse({ ok: false, message: "This is Browse Classes or Plan Ahead. Open Register for Classes." }); return; }
  prepareRound(msg.crns, msg.crns.length, 4000).then((r) => {
    if (r.error) return sendResponse({ ok: false, message: r.error });
    const parts = [];
    if (r.added.length) parts.push(`Added ${r.added.join(", ")} to the summary (not submitted).`);
    if (r.notFound.length) parts.push(`Not found: ${r.notFound.join(", ")}.`);
    if (r.noButton.length) parts.push(`No Add button: ${r.noButton.join(", ")}.`);
    sendResponse({ ok: !r.missing.length, message: parts.join(" ") || "Nothing added." });
  });
  return true;
});

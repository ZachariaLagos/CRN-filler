const $ = (id) => document.getElementById(id);
const crnsEl = $("crns"), backupsEl = $("backups"), timeEl = $("openTime");
const subjectEl = $("subject"), collegeEl = $("college"), campusEl = $("campus");

function setStatus(el, msg, cls = "") { el.textContent = msg; el.className = cls; }

function parseCrns(text) {
  const found = text.match(/\d+/g) || [];
  return {
    crns: [...new Set(found.filter((c) => /^\d{5}$/.test(c)))],
    invalid: found.filter((c) => !/^\d{5}$/.test(c)),
  };
}

function toLocalInput(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function showSchedule(s) {
  const el = $("schedStatus");
  if (s?.state === "armed") {
    setStatus(el, `Scheduled for ${new Date(s.time).toLocaleString()}. Keep the registration page open.`, "armed");
  } else if (s?.state === "firing") {
    setStatus(el, "Running now. Watch the Banner tab.", "armed");
  } else if (s?.state === "paused") {
    setStatus(el, s.message || "Paused. Reload the Banner page to resume.", "error");
  } else if (s?.state === "done") {
    setStatus(el, s.message || "Finished. Check Banner to confirm your schedule.", s.ok ? "armed" : "error");
  } else {
    setStatus(el, "Nothing scheduled.");
  }
}

chrome.storage.local.get(["crns", "backups", "search", "schedule"], (d) => {
  if (d.crns) crnsEl.value = d.crns.join("\n");
  if (d.backups) backupsEl.value = d.backups.join("\n");
  if (d.search?.subject) subjectEl.value = d.search.subject;
  if (d.search?.college !== undefined) collegeEl.value = d.search.college;
  if (d.search?.campus !== undefined) campusEl.value = d.search.campus;
  if (d.schedule?.time) timeEl.value = toLocalInput(d.schedule.time);
  showSchedule(d.schedule);
});

chrome.storage.onChanged.addListener((c) => { if (c.schedule) showSchedule(c.schedule.newValue); });

function save() {
  const main = parseCrns(crnsEl.value);
  const backup = parseCrns(backupsEl.value);
  const backups = backup.crns.filter((c) => !main.crns.includes(c));
  chrome.storage.local.set({
    crns: main.crns, backups,
    search: { subject: subjectEl.value.trim(), college: collegeEl.value.trim(), campus: campusEl.value.trim() },
  });
  crnsEl.value = main.crns.join("\n");
  backupsEl.value = backups.join("\n");
  const invalid = [...main.invalid, ...backup.invalid];
  setStatus($("status"),
    invalid.length
      ? `Saved. Skipped (not 5 digits): ${invalid.join(", ")}`
      : `Saved ${main.crns.length} main and ${backups.length} backup CRN${backups.length === 1 ? "" : "s"}.`,
    invalid.length ? "error" : "");
  return main.crns;
}

$("save").addEventListener("click", save);

$("fill").addEventListener("click", async () => {
  const crns = save();
  if (!crns.length) return setStatus($("status"), "Add at least one 5-digit CRN first.", "error");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://nubanner.neu.edu/")) {
    return setStatus($("status"), "Open the Banner registration page first.", "error");
  }
  if (!subjectEl.value.trim()) return setStatus($("status"), "Enter a Subject first.", "error");
  setStatus($("status"), "Searching and adding… keep the Banner tab open.");
  chrome.tabs.sendMessage(tab.id, { type: "SEARCH_ADD", crns }, (res) => {
    if (chrome.runtime.lastError) return setStatus($("status"), "Couldn’t reach the page. Reload it and try again.", "error");
    setStatus($("status"), res?.message || "Done.", res?.ok ? "" : "error");
  });
});

$("arm").addEventListener("click", () => {
  const crns = save();
  if (!crns.length) return setStatus($("schedStatus"), "Add at least one 5-digit main CRN first.", "error");
  if (!subjectEl.value.trim()) return setStatus($("schedStatus"), "Enter a Subject first.", "error");
  if (!timeEl.value) return setStatus($("schedStatus"), "Pick the time your registration window opens.", "error");
  const time = new Date(timeEl.value).getTime();
  if (time < Date.now() - 60_000) return setStatus($("schedStatus"), "That time has already passed.", "error");
  chrome.storage.local.set({ schedule: { time, state: "armed" } });
});

$("disarm").addEventListener("click", () => chrome.storage.local.remove(["schedule", "runLock"]));

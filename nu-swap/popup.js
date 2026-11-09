const $ = (id) => document.getElementById(id);
const fields = ["addCrn", "dropCrn", "subject", "college", "campus"];
const status = (msg, err = false) => { $("status").textContent = msg; $("status").className = err ? "error" : ""; };

chrome.storage.local.get(["swap", "search", "lastReport"], (d) => {
  if (d.swap?.addCrn) $("addCrn").value = d.swap.addCrn;
  if (d.swap?.dropCrn) $("dropCrn").value = d.swap.dropCrn;
  for (const k of ["subject", "college", "campus"]) if (d.search?.[k] !== undefined) $(k).value = d.search[k];
  if (d.lastReport) $("report").textContent = d.lastReport;
});
chrome.storage.onChanged.addListener((c) => { if (c.lastReport) $("report").textContent = c.lastReport.newValue || ""; });

$("go").addEventListener("click", async () => {
  const v = Object.fromEntries(fields.map((k) => [k, $(k).value.trim()]));
  if (!/^\d{5}$/.test(v.addCrn) || !/^\d{5}$/.test(v.dropCrn)) return status("Enter both 5-digit CRNs.", true);
  if (v.addCrn === v.dropCrn) return status("The two CRNs must be different.", true);
  if (!v.subject) return status("Enter a Subject.", true);
  await chrome.storage.local.set({
    swap: { addCrn: v.addCrn, dropCrn: v.dropCrn },
    search: { subject: v.subject, college: v.college, campus: v.campus },
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const u = tab?.url || "";
  // Registration page, not the term page, Plan Ahead or Browse Classes (the page itself double-checks).
  if (!u.includes("nubanner.neu.edu/StudentRegistrationSsb/") || /\/ssb\/(term|plan|classSearch)\//i.test(u)) {
    return status("Open Register for Classes (the page with Find Classes / Enter CRNs tabs) first.", true);
  }
  chrome.tabs.sendMessage(tab.id, { type: "SWAP_IN_10" }, (res) => {
    if (chrome.runtime.lastError) return status("Couldn’t reach the page. Reload it and try again.", true);
    status(res?.message || "", !res?.ok);
  });
});

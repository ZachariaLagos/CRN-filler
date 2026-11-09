const out = document.getElementById("out");

async function send(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://nubanner.neu.edu/StudentRegistrationSsb/")) {
    out.textContent = "请先打开 Banner 页面（nubanner.neu.edu/StudentRegistrationSsb/...），再点这个按钮。";
    return null;
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, msg, (res) => {
      if (chrome.runtime.lastError) {
        out.textContent = "连接不上页面。请刷新 Banner 页面后再试。";
        return resolve(null);
      }
      resolve(res);
    });
  });
}

document.getElementById("scan").addEventListener("click", async () => {
  const terms = document.getElementById("crns").value.split(/[\n,，]+/).map((t) => t.trim()).filter(Boolean);
  const res = await send({ type: "SCAN", terms });
  if (res) out.textContent = res.report;
});

document.getElementById("alert").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "TEST_NOTIFY" });
  const res = await send({ type: "TEST_ALERT" });
  if (res) out.textContent = res.report;
});



document.getElementById("multiAdd").addEventListener("click", async () => {
  const v = (id) => document.getElementById(id).value.trim();
  const names = document.getElementById("names").value.split("\n").map((x) => x.trim()).filter(Boolean);
  const need = parseInt(v("need"), 10) || 2;
  if (!names.length) { out.textContent = "请先填课程名，每行一个。"; return; }
  out.textContent = "正在搜索、查找并添加，可能需要半分钟，请不要动页面…";
  const res = await send({ type: "MULTI_ADD", cfg: { subject: v("subject"), college: v("college"), campus: v("campus"), names, need } });
  if (res) out.textContent = res.report;
});

document.getElementById("copy").addEventListener("click", async () => {
  if (!out.textContent) return;
  await navigator.clipboard.writeText(out.textContent);
  document.getElementById("copy").textContent = "已复制 ✓";
  setTimeout(() => (document.getElementById("copy").textContent = "复制报告"), 1500);
});

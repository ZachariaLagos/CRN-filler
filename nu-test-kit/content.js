// NU CRN Filler 测试工具。
// 扫描和提醒测试只读取页面。「添加到计划」只在 Plan Ahead（/ssb/plan/）页面运行，
// 只点击搜索结果里的 Add 按钮，不会点 Save Plan，也不会在注册页面上做任何操作。

// 与正式插件相同的选择器和状态词，用来检查它们在这个页面上是否有效。
const SEL = {
  enterCrnsTab: "#enterCRNs-tab, a[href='#enterCRNs']",
  crnInput1: "#txt_crn1",
  addAnotherBtn: "#addAnotherCRN",
  addToSummaryBtn: "#addCRNbutton",
  submitBtn: "#saveButton",
  summaryRows: "#summaryBody tr, #summary tr, [id*='summary' i] tr, [id*='summary' i] [role='row']",
};
const STATUS = {
  failed: [/error/i, /deleted/i, /closed/i, /not registered/i, /full/i],
  ok: [/registered/i, /waitlisted/i],
};
const PAGE_ERRORS = [
  /service unavailable/i, /bad gateway/i, /gateway time-?out/i, /internal server error/i,
  /an unexpected error/i, /session (has )?(expired|timed out)/i,
];

const clip = (s, n = 120) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

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

function statusOf(text) {
  if (STATUS.failed.some((re) => re.test(text))) return "失败";
  if (STATUS.ok.some((re) => re.test(text))) return "成功";
  return "无法判断";
}

function scan(terms) {
  const L = [];
  L.push("=== NU 测试报告 ===");
  L.push("页面: " + location.pathname);
  L.push("标题: " + clip(document.title, 80));
  L.push("时间: " + new Date().toLocaleString());

  const err = PAGE_ERRORS.find((re) => re.test(document.body.innerText));
  L.push("页面错误: " + (err ? "检测到 " + err : "无"));

  L.push("", "--- 正式插件用到的元素 ---");
  for (const [name, sel] of Object.entries(SEL)) {
    if (name === "summaryRows") continue;
    const el = document.querySelector(sel);
    L.push(`${name}: ${el ? "找到" + (visible(el) ? "" : "（隐藏）") : "未找到"}`);
  }

  L.push("", "--- 和 CRN 相关的输入框 ---");
  const crnInputs = [...document.querySelectorAll("input")].filter((i) =>
    /crn/i.test(i.id + " " + i.name + " " + (i.placeholder || "") + " " + (i.getAttribute("aria-label") || "")));
  if (!crnInputs.length) L.push("（没有）");
  crnInputs.slice(0, 10).forEach((i) =>
    L.push(`id="${i.id}" name="${i.name}" placeholder="${clip(i.placeholder, 30)}"${visible(i) ? "" : " （隐藏）"}`));

  L.push("", "--- 页面上的按钮（有 id 的，前 30 个）---");
  const btns = [...document.querySelectorAll("button[id], a[id], input[type=button][id], input[type=submit][id]")]
    .filter(visible).slice(0, 30);
  if (!btns.length) L.push("（没有）");
  btns.forEach((b) => L.push(`#${b.id}  「${clip(b.innerText || b.value, 40)}」`));

  L.push("", "--- 标签页 ---");
  const tabs = [...document.querySelectorAll("[role=tab], .ui-tabs-anchor, a[href^='#']")].filter(visible).slice(0, 15);
  if (!tabs.length) L.push("（没有）");
  tabs.forEach((t) => L.push(`${t.id ? "#" + t.id : "(无 id)"} href="${t.getAttribute("href") || ""}"  「${clip(t.innerText, 30)}」`));

  L.push("", "--- 汇总面板（Summary）---");
  const rows = [...document.querySelectorAll(SEL.summaryRows)].filter((r) => clip(r.innerText));
  L.push(`用正式插件的选择器找到 ${rows.length} 行`);
  rows.slice(0, 10).forEach((r, i) => L.push(`[${i + 1}] ${clip(r.innerText)}`));
  const summaryIds = [...document.querySelectorAll("[id*='summary' i]")].map((e) => e.id).slice(0, 10);
  L.push("含 summary 的元素 id: " + (summaryIds.join(", ") || "（没有）"));

  if (terms.length) {
    L.push("", "--- 查找你填的课程 ---");
    const norm = (t) => t.replace(/\s+/g, " ").toLowerCase();
    const allRows = rows.length ? rows : [...document.querySelectorAll("tr")];
    for (const term of terms) {
      const q = norm(term);
      const matches = allRows.filter((r) => norm(r.innerText).includes(q));
      if (matches.length) {
        L.push(`「${term}」: 在汇总行找到 ${matches.length} 个`);
        matches.slice(0, 5).forEach((row) => {
          const crnsInRow = [...new Set(row.innerText.match(/\b\d{5}\b/g) || [])];
          const st = statusCellText(row);
          L.push(`   CRN: ${crnsInRow.join(", ") || "（这一行没有 5 位数）"}`);
          L.push(`   状态列: 「${st.text}」（读取方式: ${st.how}） → 正式插件会判断为「${statusOf(st.text)}」`);
          L.push(`   内容: ${clip(row.innerText)}`);
        });
        if (matches.length > 1) L.push("   注意：匹配到多行，可能是同一门课的不同 section，正式插件需要用 CRN 区分。");
      } else {
        const anywhere = norm(document.body.innerText).includes(q);
        L.push(`「${term}」: 汇总行中未找到${anywhere ? "（但页面其他地方有）" : "，页面上也没有"}`);
      }
    }
  }

  L.push("", "=== 报告结束 ===");
  return L.join("\n");
}

let bar = null;
function testAlert() {
  if (!bar) {
    bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "fixed", top: "0", left: "0", right: "0", zIndex: 2147483647, padding: "10px 16px",
      font: "600 14px/1.4 system-ui, sans-serif", color: "#fff", background: "#C8102E", textAlign: "center",
    });
    document.documentElement.appendChild(bar);
  }
  bar.textContent = "NU 测试工具：这是提醒测试。看到这条红色提示栏说明页面提示正常。（5 秒后消失）";
  setTimeout(() => { bar.remove(); bar = null; }, 5000);

  let audio = "未知";
  try {
    const ctx = new AudioContext();
    audio = ctx.state === "running" ? "正常（应该听到 3 声哔）" : `被浏览器暂停（${ctx.state}）：先在 Banner 页面上随便点一下，再测试`;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35); o.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
  } catch (e) { audio = "出错: " + e.message; }

  return [
    "=== 提醒测试 ===",
    "页面提示栏: 已显示（看页面顶部）",
    "声音: " + audio,
    "桌面通知: 已发送。如果没看到，请在系统设置里允许 Chrome 发送通知。",
  ].join("\n");
}

// ---------- 添加到计划 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();

function isAddButton(el) {
  return visible(el) && /^add( course| section| to plan)?$/i.test((el.innerText || el.value || el.getAttribute("aria-label") || "").trim());
}

// 找搜索结果里的翻页按钮（Banner 9 用 paging-control first / next）。
function pagingButton(kind) {
  const re = kind === "next" ? /next|下一页/i : /first|第一页/i;
  return [...document.querySelectorAll("button, a, [role=button]")].find((b) => {
    if (!visible(b) || b.disabled || b.getAttribute("aria-disabled") === "true" || /disabled/i.test(b.className)) return false;
    const label = [b.className, b.title, b.getAttribute("aria-label"), b.innerText].join(" ");
    return /paging|page/i.test(label) && re.test(label);
  }) || null;
}

function resultsSnapshot(summaryRows) {
  return [...document.querySelectorAll("tr, [role=row]")]
    .filter((r) => !summaryRows.has(r) && visible(r)).slice(0, 5).map((r) => r.innerText).join("|");
}

async function clickAndWaitForNewPage(btn, summaryRows) {
  const before = resultsSnapshot(summaryRows);
  btn.click();
  const start = Date.now();
  while (Date.now() - start < 8000) {
    await sleep(250);
    const now = resultsSnapshot(summaryRows);
    if (now && now !== before) { await sleep(300); return true; }
  }
  return false;
}

// 结果行的课程名：这一行第一个链接/按钮的文字（Plan Ahead 里课程名本身是个链接）。
function rowTitle(r) {
  const first = [...r.querySelectorAll("a, button")].find((b) => visible(b) && (b.innerText || "").trim());
  return norm(first ? first.innerText : "");
}

// 优先选课程名完全一样的行；没有的话才用「包含」的行。
function findCandidates(q, summaryRows) {
  const rows = [...document.querySelectorAll("tr, [role=row]")].filter((r) =>
    !summaryRows.has(r) && visible(r) && norm(r.innerText).includes(q) &&
    [...r.querySelectorAll("button, a, input[type=button]")].some(isAddButton));
  const exact = rows.filter((r) => rowTitle(r) === q);
  exact.exactMatch = true;
  return exact.length ? exact : rows;
}

const MAX_PAGES = 30;

async function addToPlan(term) {
  const L = ["=== 添加到计划测试 ===", "要找的: 「" + term + "」"];
  if (!location.pathname.includes("/ssb/plan/")) {
    L.push("已停止：这个功能只在 Plan Ahead 页面使用（地址里要有 /ssb/plan/）。");
    return L.join("\n");
  }
  const q = norm(term);
  const summaryRows = new Set(document.querySelectorAll(SEL.summaryRows));

  // 诊断：记录每一页看到了什么。
  const words = q.split(" ").filter((w) => w.length >= 5);
  const near = new Map(); // 含部分关键词的行 -> 页码
  let textSeenOn = [];
  function inspectPage(page) {
    const rows = [...document.querySelectorAll("tr, [role=row]")].filter((r) => !summaryRows.has(r) && visible(r));
    if (norm(document.body.innerText).includes(q)) textSeenOn.push(page);
    rows.forEach((r) => {
      const t = norm(r.innerText);
      if (words.some((w) => t.includes(w)) && !near.has(r.innerText)) {
        const btns = [...r.querySelectorAll("button, a, input[type=button]")].filter(visible)
          .map((b) => clip(b.innerText || b.value || b.getAttribute("aria-label"), 20)).filter(Boolean);
        near.set(r.innerText, { page, btns });
      }
    });
    const titles = rows.map((r) => clip(r.innerText, 50)).filter(Boolean);
    return { count: rows.length, first: titles[1] || titles[0] || "", last: titles[titles.length - 1] || "" };
  }

  let candidates = findCandidates(q, summaryRows);
  let pages = 1;
  let stopReason = "";
  const pageLog = [];

  if (!candidates.length) {
    const first = pagingButton("first");
    if (first) {
      L.push("当前页没有，回到第一页开始找…");
      await clickAndWaitForNewPage(first, summaryRows);
      candidates = findCandidates(q, summaryRows);
    }
    pageLog.push(inspectPage(1));
    while (!candidates.length && pages < MAX_PAGES) {
      const next = pagingButton("next");
      if (!next) { stopReason = "没有可点的下一页按钮（应该是最后一页）"; break; }
      const changed = await clickAndWaitForNewPage(next, summaryRows);
      if (!changed) { stopReason = `点下一页后页面没变化（第 ${pages + 1} 页）`; break; }
      pages++;
      pageLog.push(inspectPage(pages));
      candidates = findCandidates(q, summaryRows);
    }
    if (!stopReason && !candidates.length) stopReason = `达到最多 ${MAX_PAGES} 页`;
    L.push(`共查看了 ${pages} 页结果`);
  }

  if (!candidates.length) {
    L.push("没有找到「带 Add 按钮且包含完整课程名」的结果行。");
    L.push("停止翻页原因: " + (stopReason || "无"));
    L.push("", "--- 每页情况 ---");
    pageLog.forEach((p, i) => L.push(`第 ${i + 1} 页: ${p.count} 行 | 开头 ${p.first} | 结尾 ${p.last}`));
    L.push("完整课程名出现在: " + (textSeenOn.length ? "第 " + textSeenOn.join("、") + " 页（但所在行没有 Add 按钮）" : "任何一页都没有"));
    L.push("", `--- 含部分关键词（${words.join("、") || "无"}）的行 ---`);
    if (!near.size) L.push("（没有）");
    [...near.entries()].slice(0, 8).forEach(([text, info]) =>
      L.push(`第 ${info.page} 页: ${clip(text, 100)}\n   按钮: ${info.btns.join(" / ") || "（无）"}`));
    return L.join("\n");
  }
  if (pages > 1) L.push(`在第 ${pages} 页找到`);

  L.push(`找到 ${candidates.length} 个匹配的结果行（${candidates.exactMatch ? "课程名完全一致" : "课程名包含关键词"}）${candidates.length > 1 ? "，点击第一个" : ""}`);
  const row = candidates[0];
  L.push("结果行: " + clip(row.innerText));
  const btn = [...row.querySelectorAll("button, a, input[type=button]")].find(isAddButton);
  L.push("Add 按钮: " + (btn.id ? "#" + btn.id : "(无 id)") + (btn.className ? ` class="${clip(btn.className, 60)}"` : ""));
  btn.click();
  L.push("已点击 Add，等待汇总面板更新…");

  const start = Date.now();
  let found = null;
  while (Date.now() - start < 10000) {
    found = [...document.querySelectorAll(SEL.summaryRows)].filter((r) => norm(r.innerText).includes(q)).pop();
    if (found) break;
    await sleep(250);
  }
  if (!found) {
    L.push("10 秒内汇总面板里没出现这门课。可能 Banner 弹出了提示框，请看一下页面。");
    const alerts = [...document.querySelectorAll(".notification-item, [role=alert], .error")].filter(visible);
    alerts.slice(0, 3).forEach((a) => L.push("页面提示: " + clip(a.innerText)));
    return L.join("\n");
  }
  const st = statusCellText(found);
  L.push(`成功：汇总面板出现了这门课（用时 ${((Date.now() - start) / 1000).toFixed(1)} 秒）`);
  L.push("汇总行: " + clip(found.innerText));
  L.push(`状态列: 「${st.text}」（读取方式: ${st.how}） → 正式插件会判断为「${statusOf(st.text)}」`);
  L.push("", "提示：计划还没保存。不想保留的话，在汇总面板里删掉它，或者直接不点 Save Plan。");
  return L.join("\n");
}

// ---------- 自动搜索：填 Subject 和课程名，然后点 Search ----------
function setValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  ["input", "change", "keyup"].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
}

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

// 根据 id、name、placeholder 或旁边的 label 文字找输入框。
function findField(words) {
  const re = new RegExp(words.join("|"), "i");
  const inputs = [...document.querySelectorAll("input[type=text], input:not([type])")].filter(visible);
  const direct = inputs.find((i) => re.test([i.id, i.name, i.placeholder, i.getAttribute("aria-label")].join(" ")));
  if (direct) return direct;
  for (const label of document.querySelectorAll("label")) {
    if (!re.test(label.textContent)) continue;
    const target = label.htmlFor && document.getElementById(label.htmlFor);
    if (target && visible(target) && target.tagName === "INPUT") return target;
  }
  return null;
}

function searchFormVisible() {
  const go = document.querySelector("#search-go");
  return go && visible(go);
}

async function chooseSubject(subject, L) {
  // Banner 的 Subject 是 select2 自动补全框。
  const box = document.querySelector("#s2id_txt_subject, [id*='subject' i].select2-container, .select2-container[id*='subject' i]");
  if (!box) { L.push("Subject: 找不到 Subject 输入框"); return false; }

  // 清掉已经选过的科目。
  box.querySelectorAll(".select2-search-choice-close, .select2-selection__choice__remove").forEach((x) => fire(x, ["mousedown", "mouseup", "click"]));

  const area = box.querySelector(".select2-choices, .select2-selection, .select2-choice") || box;
  fire(area, ["mousedown", "mouseup", "click"]);
  const input = box.querySelector("input.select2-input, input.select2-search__field") ||
                document.querySelector(".select2-drop-active input.select2-input, .select2-search__field");
  if (!input) { L.push("Subject: 打不开下拉搜索框"); return false; }
  input.focus();
  setValue(input, subject);
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "e" }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "e" }));

  const want = norm(subject);
  const option = await waitUntil(() =>
    [...document.querySelectorAll(".select2-result-label, .select2-results__option, .select2-results li")]
      .find((o) => visible(o) && norm(o.innerText).includes(want)), 8000);
  if (!option) { L.push(`Subject: 下拉列表里没出现「${subject}」`); return false; }
  const label = clip(option.innerText, 60);
  fire(option, ["mouseover", "mousedown", "mouseup", "click"]);
  await sleep(400);
  const chosen = norm(box.innerText).includes(want) ||
    norm(document.querySelector("#txt_subject")?.value || "").length > 0;
  L.push(`Subject: 选择了「${label}」${chosen ? "" : "（未确认是否选上）"}`);
  return true;
}

async function searchFor(subject, title, L) {
  if (!searchFormVisible()) {
    const again = document.querySelector("#search-again-button");
    if (again && visible(again)) {
      again.click();
      L.push("点了 Search Again，回到搜索界面");
      await waitUntil(searchFormVisible, 6000);
    }
  }
  if (!searchFormVisible()) { L.push("找不到搜索界面（#search-go）。请先打开 Find Classes 标签。"); return false; }

  if (subject && !(await chooseSubject(subject, L))) return false;

  // 不填 Keyword：只按 Subject 搜索，然后在结果里按课程名找。
  const kw = findField(["keyword"]);
  if (kw && kw.value) { setValue(kw, ""); L.push("清空了 Keyword 栏"); }

  const summaryRows = new Set(document.querySelectorAll(SEL.summaryRows));
  const before = resultsSnapshot(summaryRows);
  document.querySelector("#search-go").click();
  L.push("点了 Search，等待结果…");
  const loaded = await waitUntil(() => {
    const again = document.querySelector("#search-again-button");
    const now = resultsSnapshot(summaryRows);
    return (again && visible(again) && now && now !== before) ? true : null;
  }, 15000);
  if (!loaded) { L.push("15 秒内没看到搜索结果。"); return false; }
  await sleep(500);
  L.push("搜索结果已加载");
  await maxPageSize(summaryRows, L);
  return true;
}

// 把每页显示数量调到最大（通常是 50），减少翻页次数。
async function maxPageSize(summaryRows, L) {
  const sel = [...document.querySelectorAll("select")].find((el) =>
    visible(el) && /page/i.test(el.id + " " + el.className + " " + el.name) &&
    [...el.options].length && [...el.options].every((o) => /^\d+$/.test(o.value)));
  if (!sel) { L.push("每页数量: 没找到设置，按默认翻页"); return; }
  const max = Math.max(...[...sel.options].map((o) => +o.value));
  if (+sel.value === max) { L.push(`每页数量: 已经是 ${max}`); return; }
  const before = resultsSnapshot(summaryRows);
  sel.value = String(max);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await waitUntil(() => resultsSnapshot(summaryRows) !== before, 8000);
  await sleep(400);
  L.push(`每页数量: 调成 ${max}`);
}

async function searchAndAdd(subject, title) {
  const L = ["=== 搜索并添加测试 ==="];
  if (!location.pathname.includes("/ssb/plan/")) {
    L.push("已停止：这个功能只在 Plan Ahead 页面使用（地址里要有 /ssb/plan/）。");
    return L.join("\n");
  }
  const ok = await searchFor(subject, title, L);
  if (!ok) return L.join("\n");
  L.push("");
  const addReport = await addToPlan(title);
  return L.join("\n") + "\n" + addReport;
}

// ---------- 多门课：高级搜索 + 按顺序添加 + 保存 ----------
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

async function chooseOption(field, value, L) {
  const box = select2Box(field);
  if (!box || !visible(box)) { L.push(`${field}: 找不到这个输入框`); return false; }
  const want = norm(value);
  for (const x of box.querySelectorAll(".select2-search-choice-close, .select2-selection__choice__remove")) {
    fire(x, ["mousedown", "mouseup", "click"]);
    await sleep(100);
  }
  fire(box.querySelector(".select2-choices, .select2-selection, .select2-choice") || box, ["mousedown", "mouseup", "click"]);
  const input = box.querySelector("input.select2-input, input.select2-search__field") ||
                document.querySelector(".select2-drop-active input.select2-input, .select2-search__field");
  if (!input) { L.push(`${field}: 打不开下拉框`); return false; }
  input.focus();
  setValue(input, value);
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  const option = await waitUntil(() => {
    const opts = [...document.querySelectorAll(".select2-result-label, .select2-results__option")].filter(visible);
    return opts.find((o) => norm(o.innerText) === want) ||
           opts.find((o) => norm(o.innerText).startsWith(want)) ||
           opts.find((o) => norm(o.innerText).includes(want)) || null;
  }, 10000);
  if (!option) { L.push(`${field}: 下拉列表里没出现「${value}」`); return false; }
  const label = clip(option.innerText, 60);
  fire(option, ["mouseover", "mousedown", "mouseup", "click"]);
  await sleep(400);
  const ok = norm(box.innerText).includes(want.split(" ")[0]);
  L.push(`${field}: 选择了「${label}」${ok ? "" : "（未确认是否选上）"}`);
  return ok;
}

async function advancedSearch(cfg, L) {
  const summaryRows = new Set(document.querySelectorAll(SEL.summaryRows));
  const tab = document.querySelector("#classSearch-tab");
  if (tab && visible(tab)) { tab.click(); await sleep(300); }
  if (!searchFormVisible()) {
    const again = document.querySelector("#search-again-button");
    if (again && visible(again)) {
      again.click();
      L.push("点了 Search Again，回到搜索界面");
      await waitUntil(searchFormVisible, 8000);
    }
  }
  if (!searchFormVisible()) { L.push("找不到搜索界面（#search-go）"); return false; }

  // 先展开 Advanced Search。
  const advField = cfg.college ? "college" : "campus";
  if (!visible(select2Box(advField))) {
    const adv = [...document.querySelectorAll("a, button")].find((a) => visible(a) && /advanced search/i.test(a.innerText));
    if (adv) {
      adv.click();
      await waitUntil(() => visible(select2Box(advField)), 5000);
      L.push("展开了 Advanced Search");
    } else {
      L.push("没找到 Advanced Search 链接（可能已经展开）");
    }
  } else {
    L.push("Advanced Search 已经展开");
  }

  if (!(await chooseOption("subject", cfg.subject, L))) return false;
  if (cfg.college && !(await chooseOption("college", cfg.college, L))) return false;
  if (cfg.campus && !(await chooseOption("campus", cfg.campus, L))) return false;

  const kw = findField(["keyword"]);
  if (kw && kw.value) setValue(kw, "");

  const before = resultsSnapshot(summaryRows);
  document.querySelector("#search-go").click();
  L.push("点了 Search，等待结果…");
  const loaded = await waitUntil(() => {
    const again = document.querySelector("#search-again-button");
    const now = resultsSnapshot(summaryRows);
    return again && visible(again) && now && now !== before;
  }, 30000);
  if (!loaded) { L.push("30 秒内没看到搜索结果"); return false; }
  await sleep(500);
  L.push("搜索结果已加载");
  await maxPageSize(summaryRows, L);
  return true;
}

// 在当前页找一门课：优先课程名完全一致，其次包含。
function resultRowForTitle(q, summaryRows) {
  const rows = [...document.querySelectorAll("tr, [role=row]")].filter((r) =>
    !summaryRows.has(r) && !r.closest("[id*='summary' i]") && visible(r) && norm(r.innerText).includes(q) &&
    [...r.querySelectorAll("button, a, input[type=button]")].some(isAddButton));
  return { exact: rows.find((r) => rowTitle(r) === q) || null, loose: rows[0] || null };
}

async function multiAddAndSave(cfg) {
  const L = ["=== 按顺序添加并保存 ==="];
  if (!location.pathname.includes("/ssb/plan/")) {
    L.push("已停止：这个功能只在 Plan Ahead 页面使用（地址里要有 /ssb/plan/）。");
    return L.join("\n");
  }
  const names = cfg.names.map((n) => n.trim()).filter(Boolean);
  const need = cfg.need;
  L.push(`候选（按顺序）: ${names.join(" → ")}`);
  L.push(`需要添加: ${need} 门`, "");

  if (!(await advancedSearch(cfg, L))) return L.join("\n");
  const summaryRows = new Set(document.querySelectorAll(SEL.summaryRows));

  // 第 1 遍：翻完所有页，记录每门课在哪一页（只翻页，不点 Add）。
  L.push("", "--- 第 1 遍：查找 ---");
  const exactPage = new Map(), loosePage = new Map();
  const first = pagingButton("first");
  if (first) await clickAndWaitForNewPage(first, summaryRows);
  let pages = 1;
  for (; pages <= MAX_PAGES; pages++) {
    for (const n of names) {
      const q = norm(n);
      if (exactPage.has(q)) continue;
      const { exact, loose } = resultRowForTitle(q, summaryRows);
      if (exact) exactPage.set(q, pages);
      else if (loose && !loosePage.has(q)) loosePage.set(q, pages);
    }
    if (names.every((n) => exactPage.has(norm(n)))) break;
    const next = pagingButton("next");
    if (!next || !(await clickAndWaitForNewPage(next, summaryRows))) break;
  }
  L.push(`查看了 ${Math.min(pages, MAX_PAGES)} 页`);

  // 按顺序挑：找到就选，找不到就看下一个，选够 need 门就停。
  const chosen = [];
  for (const n of names) {
    const q = norm(n);
    const page = exactPage.get(q) ?? loosePage.get(q);
    if (page === undefined) { L.push(`✗ 「${n}」: 没找到 → 看下一个`); continue; }
    if (chosen.length >= need) { L.push(`- 「${n}」: 找到了（第 ${page} 页），但已经选够 ${need} 门，不添加`); continue; }
    chosen.push({ n, q, page, exact: exactPage.has(q) });
    L.push(`✓ 「${n}」: 第 ${page} 页找到（${exactPage.has(q) ? "课程名完全一致" : "课程名包含关键词"}）→ 选中`);
  }

  if (chosen.length < need) {
    L.push("", `只找到 ${chosen.length} 门，少于需要的 ${need} 门。按正式插件的规则：不添加、不保存。`);
    return L.join("\n");
  }

  // 第 2 遍：回到第一页，按页点 Add / Add Course。
  L.push("", "--- 第 2 遍：添加 ---");
  const first2 = pagingButton("first");
  if (first2) await clickAndWaitForNewPage(first2, summaryRows);
  const lastPage = Math.max(...chosen.map((c) => c.page));
  for (let page = 1; page <= lastPage; page++) {
    for (const c of chosen.filter((x) => x.page === page)) {
      const { exact, loose } = resultRowForTitle(c.q, summaryRows);
      const row = c.exact ? exact : loose;
      const btn = row && [...row.querySelectorAll("button, a, input[type=button]")].find(isAddButton);
      if (!btn) { L.push(`「${c.n}」: 第 ${page} 页上找不到它的 Add 按钮了，停止`); return L.join("\n"); }
      const label = clip(btn.innerText || btn.value, 20);
      btn.click();
      const inSum = await waitUntil(() =>
        [...document.querySelectorAll(SEL.summaryRows)].find((r) => norm(r.innerText).includes(c.q)), 10000);
      if (!inSum) { L.push(`「${c.n}」: 点了「${label}」，但 10 秒内没出现在汇总面板，停止`); return L.join("\n"); }
      const st = statusCellText(inSum);
      L.push(`「${c.n}」: 点了「${label}」→ 已进入汇总面板，状态「${st.text}」（读取方式: ${st.how}）`);
      await sleep(150);
    }
    if (page < lastPage) {
      const next = pagingButton("next");
      if (!next || !(await clickAndWaitForNewPage(next, summaryRows))) { L.push("翻页失败，停止"); return L.join("\n"); }
    }
  }

  // 选够了：点 Save Plan（相当于正式插件里的 Submit）。
  L.push("", "--- 保存 ---");
  const save = document.querySelector("#saveButton");
  if (!save || !visible(save)) { L.push("找不到 Save 按钮（#saveButton）"); return L.join("\n"); }
  const saveText = clip(save.innerText || save.value, 20);
  if (!/save/i.test(saveText)) { L.push(`#saveButton 写的是「${saveText}」，不是 Save，为安全起见不点击`); return L.join("\n"); }
  save.click();
  L.push(`点了「${saveText}」`);

  // Banner 保存计划时通常会弹出一个框让你填计划名称。
  const nameBox = await waitUntil(() =>
    [...document.querySelectorAll("input[type=text]")].find((i) => visible(i) && /plan|name/i.test(i.id + " " + i.name + " " + (i.placeholder || ""))), 4000);
  if (nameBox) {
    L.push(`弹出了计划名称框（${nameBox.id ? "#" + nameBox.id : "输入框"}）。为了不覆盖你的计划，测试工具不会自动填写，请你手动填写并保存。`);
  }
  await sleep(1500);
  const notes = [...document.querySelectorAll(".notification-item, [role=alert], .notification-center-message, .ui-dialog")]
    .filter(visible).map((n) => clip(n.innerText, 100)).filter(Boolean);
  if (notes.length) notes.slice(0, 3).forEach((n) => L.push("页面提示: " + n));
  else if (!nameBox) L.push("页面上没看到提示。请看一下计划是否已保存。");
  return L.join("\n");
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "MULTI_ADD") { multiAddAndSave(msg.cfg).then((report) => sendResponse({ report })); return true; }
  if (msg?.type === "SEARCH_AND_ADD") { searchAndAdd(msg.subject, msg.term).then((report) => sendResponse({ report })); return true; }
  if (msg?.type === "ADD_TO_PLAN") { addToPlan(msg.term).then((report) => sendResponse({ report })); return true; }
  if (msg?.type === "SCAN") sendResponse({ report: scan(msg.terms || []) });
  if (msg?.type === "TEST_ALERT") sendResponse({ report: testAlert() });
});

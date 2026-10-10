import { CONFIG, price } from "./config.js";
import {
  $,
  escapeHTML as esc,
  money,
  formatNumber,
  kstToday,
  status,
  confirmAction,
  table,
  downloadCSV,
} from "./utils.js";
import { aggregate, actualOrders, filterOrders } from "./aggregate.js";
import * as storage from "./storage.js";
let unlocked = false,
  rows = [],
  detailRows = [],
  query = null,
  queryVersion = 0;
const groupLabel = (value) => CONFIG.groups[value] ?? value;
const mealLabel = (value) => CONFIG.meals[value] ?? value;
const label = (field, value) =>
  field === "group"
    ? groupLabel(value)
    : field === "meal"
      ? mealLabel(value)
      : value;
function fail(error) {
  console.error(error);
  status(
    "adminStatus",
    `데이터를 읽거나 변경하지 못했습니다. ${storage.storageErrorMessage(error)}`,
    true,
  );
}
function renderDetails() {
  const term = $("detailSearch").value.trim().toLocaleLowerCase();
  detailRows = rows
    .filter((row) =>
      [row.empId, row.name, row.company, row.location].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase()
          .includes(term),
      ),
    )
    .sort((a, b) =>
      `${a.date}|${a.name}|${a.meal}`.localeCompare(
        `${b.date}|${b.name}|${b.meal}`,
        "ko",
      ),
    );
  const headers = [
    "날짜",
    "구분",
    "회사명/소속",
    "사번",
    "이름",
    "식사",
    "장소",
    "메뉴",
    "수량",
    "단가",
    "금액",
    "삭제",
  ];
  if (!detailRows.length) {
    $("detailTable").innerHTML =
      '<p class="empty">조회된 신청 내역이 없습니다.</p>';
    return;
  }
  $("detailTable").innerHTML =
    `<table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${detailRows.map((row, i) => `<tr>${[row.date, groupLabel(row.group), row.company || "—", row.empId || "—", row.name, mealLabel(row.meal), row.location || "—", row.menu, row.menu === CONFIG.noOrder ? 0 : 1, money(price(row.menu)), money(price(row.menu))].map((value) => `<td>${esc(value)}</td>`).join("")}<td><button class="danger" data-delete="${i}">삭제</button></td></tr>`).join("")}</tbody></table>`;
}
function render() {
  const actual = actualOrders(rows);
  const amount = actual.reduce((sum, row) => sum + price(row.menu), 0);
  const period = query.mode === "day" ? query.date : query.month;
  $("totalCards").innerHTML =
    `<div class="panel"><p>${esc(period)} ${query.mode === "day" ? "일별" : "월별"} · ${esc(query.group === "all" ? "전체" : groupLabel(query.group))}</p><strong>총 ${actual.length.toLocaleString("ko-KR")}개</strong></div><div class="panel"><p>총 금액 <small>부가세 포함</small></p><strong>${money(amount)}</strong></div>`;
  $("groupedTable").innerHTML = table(
    ["신청자 구분", "식사", "장소", "메뉴", "수량", "단가", "금액"],
    aggregate(rows, ["group", "meal", "location", "menu"]).map((bucket) => [
      groupLabel(bucket.values[0]),
      mealLabel(bucket.values[1]),
      bucket.values[2],
      bucket.values[3],
      bucket.quantity,
      money(price(bucket.values[3])),
      money(bucket.amount),
    ]),
  );
  const subtotals = [];
  for (const [field, title] of [
    ["group", "구분별"],
    ["meal", "식사별"],
    ["location", "장소별"],
    ["menu", "메뉴별"],
  ])
    for (const bucket of aggregate(rows, [field]))
      subtotals.push([
        title,
        label(field, bucket.values[0]),
        bucket.quantity,
        money(bucket.amount),
      ]);
  subtotals.push(["전체 합계", "전체", actual.length, money(amount)]);
  $("subtotalTable").innerHTML = table(
    ["집계 기준", "항목", "수량", "금액"],
    subtotals,
  );
  $("dailyPanel").hidden = query.mode !== "month";
  $("dailyTable").innerHTML = table(
    ["날짜", "수량", "금액"],
    aggregate(rows, ["date"]).map((bucket) => [
      bucket.values[0],
      bucket.quantity,
      money(bucket.amount),
    ]),
  );
  renderDetails();
}
async function refresh() {
  if (!unlocked) return;
  const version = ++queryVersion;
  try {
    const next = {
      mode: $("viewMode").value,
      date: $("queryDate").value,
      month: $("queryMonth").value,
      group: $("queryGroup").value,
    };
    if (!(next.mode === "day" ? next.date : next.month)) {
      status("adminStatus", "조회 날짜 또는 연월을 선택해주세요.", true);
      return;
    }
    const all = await storage.getAllOrders();
    if (version !== queryVersion || !unlocked) return;
    rows = filterOrders(all, next);
    query = next;
    render();
    status(
      "adminStatus",
      "조회가 완료되었습니다. 신청 안 함은 주문 집계에서 제외됩니다.",
    );
  } catch (error) {
    if (version === queryVersion && unlocked) fail(error);
  }
}
$("queryDate").value = kstToday();
$("queryMonth").value = kstToday().slice(0, 7);
$("queryGroup").insertAdjacentHTML(
  "beforeend",
  Object.entries(CONFIG.groups)
    .map(([value, text]) => `<option value="${value}">${esc(text)}</option>`)
    .join(""),
);
function openLogin() {
  $("password").value = "";
  status("passwordError", "");
  $("passwordDialog").showModal();
}
$("loginButton").addEventListener("click", openLogin);
$("closePassword").addEventListener("click", () => $("passwordDialog").close());
$("passwordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("password").value !== CONFIG.adminPassword) {
    status("passwordError", "비밀번호를 확인해주세요.", true);
    return;
  }
  unlocked = true;
  $("password").value = "";
  $("passwordDialog").close();
  $("adminContent").hidden = false;
  $("loginButton").hidden = true;
  refresh();
});
$("logoutButton").addEventListener("click", () => {
  unlocked = false;
  queryVersion++;
  rows = [];
  detailRows = [];
  query = null;
  $("adminContent").hidden = true;
  $("loginButton").hidden = false;
  [
    "detailTable",
    "groupedTable",
    "subtotalTable",
    "dailyTable",
    "totalCards",
  ].forEach((id) => $(id).replaceChildren());
});
$("viewMode").addEventListener("change", () => {
  $("dayField").hidden = $("viewMode").value !== "day";
  $("monthField").hidden = $("viewMode").value !== "month";
  refresh();
});
["queryDate", "queryMonth", "queryGroup"].forEach((id) =>
  $(id).addEventListener("change", refresh),
);
$("queryButton").addEventListener("click", refresh);
$("detailSearch").addEventListener("input", renderDetails);
$("detailTable").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!unlocked || !button) return;
  const row = detailRows[Number(button.dataset.delete)];
  if (
    !(await confirmAction(
      "신청 삭제",
      `이 신청 내역을 삭제할까요?\n\n${row.date} · ${row.name} · ${mealLabel(row.meal)} · ${row.menu}`,
    ))
  )
    return;
  try {
    await storage.deleteOrder(row.id);
    await refresh();
    status("adminStatus", "신청 내역을 삭제했습니다.");
  } catch (error) {
    fail(error);
  }
});
$("resetAll").addEventListener("click", async () => {
  if (
    !unlocked ||
    !(await confirmAction(
      "전체 신청 초기화",
      "모든 신청 내역을 삭제합니다.\n삭제된 데이터는 복구할 수 없습니다.\n\n계속할까요?",
    ))
  )
    return;
  try {
    await storage.resetOrders();
    await refresh();
    status("adminStatus", "모든 신청 내역을 삭제했습니다.");
  } catch (error) {
    fail(error);
  }
});
$("csvButton").addEventListener("click", () => {
  if (!unlocked || !query) return;
  const actual = actualOrders(rows);
  if (!actual.length) {
    status("adminStatus", "다운로드할 실제 신청 내역이 없습니다.", true);
    return;
  }
  downloadCSV(
    `aurora-${query.mode === "day" ? query.date : query.month}-${query.group}.csv`,
    [
      "날짜",
      "구분",
      "회사명/소속",
      "사번",
      "이름",
      "식사",
      "장소",
      "메뉴",
      "단가",
      "금액",
    ],
    actual.map((row) => [
      row.date,
      groupLabel(row.group),
      row.company,
      row.empId,
      row.name,
      mealLabel(row.meal),
      row.location,
      row.menu,
      formatNumber(price(row.menu)),
      formatNumber(price(row.menu)),
    ]),
  );
});
openLogin();

import { CONFIG } from "./config.js";
import {
  $,
  escapeHTML as esc,
  kstToday,
  monday,
  addDays,
  status,
  confirmAction,
} from "./utils.js";
import {
  menusFor,
  isClosed,
  isUnavailable,
  deadlineLabel,
  normalizeProfile,
  requesterKey,
  orderId,
  validateChange,
} from "./meal-rules.js";
import * as storage from "./storage.js";
let group = "gs",
  week = monday(kstToday()),
  profiles = {},
  busy = false;
const states = Object.fromEntries(
  Object.keys(CONFIG.groups).map((key) => [
    key,
    { profile: {}, baseline: new Map(), drafts: new Map(), loadedKey: null },
  ]),
);
const state = () => states[group];
const slotKey = (date, meal) => `${date}|${meal}`;
const equal = (a, b) =>
  (a?.menu ?? CONFIG.noOrder) === b.menu && (a?.location ?? "") === b.location;
function changes() {
  return [...state().drafts.values()].filter(
    (row) => !equal(state().baseline.get(slotKey(row.date, row.meal)), row),
  );
}
function readProfile() {
  return normalizeProfile(group, state().profile);
}
function storageError(error) {
  console.error(error);
  status("employeeStatus", storage.storageErrorMessage(error), true);
}
function renderIdentity() {
  document.querySelectorAll("[data-group]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.group === group),
    );
    button.tabIndex = button.dataset.group === group ? 0 : -1;
  });
  $("identityPanel").setAttribute("aria-labelledby", `tab-${group}`);
  const fields =
    group === "gs"
      ? [
          ["empId", "사번", "text", 30],
          ["name", "이름", "text", 40],
        ]
      : [
          ["company", group === "vip" ? "소속" : "회사명", "text", 80],
          ["name", "이름", "text", 40],
          ["phone", "연락처", "tel", 25],
        ];
  $("identityFields").innerHTML = fields
    .map(
      ([key, label, type, max]) =>
        `<label>${label}<input data-field="${key}" type="${type}" maxlength="${max}" value="${esc(state().profile[key] || "")}" autocomplete="${key === "name" ? "name" : key === "phone" ? "tel" : "off"}"></label>`,
    )
    .join("");
  $("remember").checked = Boolean(profiles[group]);
}
function renderDays() {
  $("weekLabel").textContent =
    `${week.replaceAll("-", ".")} ~ ${addDays(week, 5).replaceAll("-", ".")}`;
  $("days").innerHTML = Array.from({ length: 6 }, (_, i) => {
    const date = addDays(week, i);
    return `<article class="day"><div class="day-head"><h2>${["월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][i]}</h2><span>${date.slice(5).replace("-", ".")}</span></div>${Object.entries(
      CONFIG.meals,
    )
      .map(([meal, label]) => {
        const key = slotKey(date, meal);
        const saved = state().baseline.get(key);
        const row = state().drafts.get(key) ??
          saved ?? { menu: CONFIG.noOrder, location: "" };
        const unavailable = isUnavailable(date, meal);
        const closed = isClosed(date, meal);
        const options = menusFor(meal, date);
        const legacy = !options.includes(row.menu);
        const badge = unavailable
          ? "미운영"
          : closed
            ? "마감"
            : saved && saved.menu !== CONFIG.noOrder
              ? "신청 완료"
              : "선택 가능";
        return `<div class="slot"><div class="slot-title"><label for="menu-${date}-${meal}">${label}</label><span class="badge ${closed ? "closed" : ""}">${badge}</span></div><select id="menu-${date}-${meal}" data-date="${date}" data-meal="${meal}" ${closed || busy || unavailable ? "disabled" : ""}>${legacy ? `<option value="${esc(row.menu)}" selected disabled>${esc(row.menu)} (이전 메뉴)</option>` : ""}${options.map((menu) => `<option ${menu === row.menu ? "selected" : ""}>${esc(menu)}</option>`).join("")}</select>${meal === "lunch" && row.menu !== CONFIG.noOrder ? `<label class="location-label">중식 장소<select data-location="true" data-date="${date}" data-meal="${meal}" ${closed || busy || unavailable ? "disabled" : ""}>${!CONFIG.locations.includes(row.location) ? `<option selected disabled>${esc(row.location || "장소 선택")}</option>` : ""}${CONFIG.locations.map((location) => `<option ${location === row.location ? "selected" : ""}>${esc(location)}</option>`).join("")}</select></label>` : ""}<small>${esc(unavailable ? "월요일 조식은 신청 안 함" : deadlineLabel(meal))}</small></div>`;
      })
      .join("")}</article>`;
  }).join("");
  updateCount();
}
function updateCount() {
  $("changeCount").textContent = `변경한 내역 ${changes().length}건`;
}
async function rememberProfile(profile) {
  const next = { ...profiles };
  if ($("remember").checked) next[group] = profile;
  else delete next[group];
  await storage.saveProfiles(next);
  profiles = next;
}
function resetForIdentity() {
  if (state().loadedKey !== null) {
    state().baseline.clear();
    state().drafts.clear();
    state().loadedKey = null;
    renderDays();
    status(
      "employeeStatus",
      "신청자 정보가 바뀌었습니다. 기존 신청을 다시 불러와주세요.",
    );
  }
}
$("identityFields").addEventListener("input", (event) => {
  state().profile[event.target.dataset.field] = event.target.value;
  resetForIdentity();
});
$("remember").addEventListener("change", async () => {
  try {
    if (!$("remember").checked) {
      const next = { ...profiles };
      delete next[group];
      await storage.saveProfiles(next);
      profiles = next;
    } else await rememberProfile(readProfile());
  } catch (error) {
    $("remember").checked = Boolean(profiles[group]);
    status(
      "employeeStatus",
      error.message.startsWith("이름") ||
        error.message.includes("입력") ||
        error.message.includes("연락처")
        ? error.message
        : "정보를 기억하지 못했습니다. 입력 정보와 저장 공간을 확인해주세요.",
      true,
    );
  }
});
document.querySelectorAll("[data-group]").forEach((button) =>
  button.addEventListener("click", () => {
    group = button.dataset.group;
    renderIdentity();
    renderDays();
    status("employeeStatus", "신청자 정보를 확인해주세요.");
    status("saveStatus", "");
  }),
);
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const keys = Object.keys(CONFIG.groups);
  const i = keys.indexOf(group);
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? keys.length - 1
        : (i + (event.key === "ArrowRight" ? 1 : -1) + keys.length) %
          keys.length;
  $(`tab-${keys[target]}`).click();
  $(`tab-${keys[target]}`).focus();
});
$("days").addEventListener("change", (event) => {
  const { date, meal, location } = event.target.dataset;
  if (!date || isClosed(date, meal) || isUnavailable(date, meal)) {
    renderDays();
    return;
  }
  const key = slotKey(date, meal);
  const current = state().drafts.get(key) ??
    state().baseline.get(key) ?? { menu: CONFIG.noOrder, location: "" };
  const row = {
    date,
    meal,
    menu: location ? current.menu : event.target.value,
    location: location
      ? event.target.value
      : meal === "lunch" && event.target.value !== CONFIG.noOrder
        ? current.location || CONFIG.locations[0]
        : "",
  };
  if (equal(state().baseline.get(key), row)) state().drafts.delete(key);
  else state().drafts.set(key, row);
  const focusId = event.target.id;
  renderDays();
  if (focusId) $(focusId)?.focus();
  status("saveStatus", "");
});
async function loadOrders() {
  let profile;
  try {
    profile = readProfile();
  } catch (error) {
    status("employeeStatus", error.message, true);
    return;
  }
  if (
    changes().length &&
    !(await confirmAction(
      "기존 신청 불러오기",
      "저장하지 않은 변경사항을 버리고 기존 신청을 불러올까요?",
    ))
  )
    return;
  try {
    const rows = await storage.getOrdersByRequester(requesterKey(profile));
    await rememberProfile(profile);
    state().baseline = new Map(
      rows.map((row) => [slotKey(row.date, row.meal), row]),
    );
    state().drafts.clear();
    state().loadedKey = requesterKey(profile);
    renderDays();
    status(
      "employeeStatus",
      rows.length
        ? "기존 신청을 불러왔습니다."
        : "기존 신청이 없습니다. 새 식사를 선택해주세요.",
    );
    status("saveStatus", "");
  } catch (error) {
    storageError(error);
  }
}
$("loadButton").addEventListener("click", loadOrders);
for (const [id, offset] of [
  ["prevWeek", -7],
  ["nextWeek", 7],
])
  $(id).addEventListener("click", () => {
    week = addDays(week, offset);
    renderDays();
  });
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll("main button, main input, main select")
    .forEach((el) => {
      el.disabled = value;
    });
  renderDays();
}
$("submitButton").addEventListener("click", async () => {
  let profile, pending;
  try {
    profile = readProfile();
    pending = changes();
    if (!pending.length) throw new Error("저장할 변경 내역이 없습니다.");
    pending.forEach((row) => validateChange(row));
  } catch (error) {
    status("saveStatus", error.message, true);
    renderDays();
    return;
  }
  setBusy(true);
  try {
    const accepted = await confirmAction(
      "신청 내역 확인",
      `${CONFIG.groups[group]} · ${profile.name}\n\n${pending.map((row) => `${row.date} ${CONFIG.meals[row.meal]}\n${row.menu}${row.location ? ` (${row.location})` : ""}`).join("\n\n")}\n\n위 내역을 저장할까요?`,
    );
    if (!accepted) return;
    // 확인창이 열린 동안에도 마감될 수 있으므로 저장 직전 재검증합니다.
    try {
      pending.forEach((row) => validateChange(row));
    } catch (error) {
      status("saveStatus", error.message, true);
      return;
    }
    const key = requesterKey(profile);
    const updatedAt = new Date().toISOString();
    const rows = pending.map((row) => ({
      ...profile,
      ...row,
      requesterKey: key,
      id: orderId(key, row.date, row.meal),
      updatedAt,
    }));
    await storage.upsertOrders(rows);
    const all = await storage.getOrdersByRequester(key);
    state().baseline = new Map(
      all.map((row) => [slotKey(row.date, row.meal), row]),
    );
    state().drafts.clear();
    state().loadedKey = key;
    status("saveStatus", `✓ ${rows.length}건 저장 완료`);
    try {
      await rememberProfile(profile);
    } catch (error) {
      console.error(error);
      status(
        "employeeStatus",
        "신청은 저장됐지만 기본정보를 기억하지 못했습니다.",
        true,
      );
    }
    $("successText").textContent =
      `${profile.name}님,\n${rows.length}건의 식사 신청 변경 내역이\n정상적으로 저장되었습니다.`;
    $("successDialog").showModal();
  } catch (error) {
    console.error(error);
    status(
      "saveStatus",
      `신청을 저장하지 못했습니다. ${storage.storageErrorMessage(error)}`,
      true,
    );
  } finally {
    setBusy(false);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (Object.values(states).some((s) => s.drafts.size)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
setInterval(() => {
  if (!busy) renderDays();
}, 30000);
async function init() {
  try {
    profiles = await storage.getProfiles();
    for (const key of Object.keys(states))
      states[key].profile = profiles[key] ?? {};
  } catch (error) {
    storageError(error);
  }
  renderIdentity();
  renderDays();
}
init();

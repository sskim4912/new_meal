import { CONFIG } from "./config.js";
import { addDays } from "./utils.js";
export function isUnavailable(date, meal) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return CONFIG.unavailableWeekdays?.[meal]?.includes(weekday) ?? false;
}
export function menusFor(meal, date) {
  if (date && isUnavailable(date, meal)) return [CONFIG.noOrder];
  const rule = CONFIG.menuRules[meal];
  return [
    CONFIG.noOrder,
    ...CONFIG.menus.filter((menu) =>
      rule.only ? rule.only.includes(menu) : !rule.exclude.includes(menu),
    ),
  ];
}
export function deadline(date, meal) {
  const rule = CONFIG.deadlines[meal];
  return Date.parse(`${addDays(date, rule.offsetDays)}T${rule.time}:00+09:00`);
}
export const isClosed = (date, meal, now = Date.now()) =>
  now >= deadline(date, meal);
export function deadlineLabel(meal) {
  const rule = CONFIG.deadlines[meal];
  return `${rule.offsetDays === -1 ? "전일" : rule.offsetDays === 0 ? "당일" : `${rule.offsetDays}일`} ${rule.time} 마감 (KST)`;
}
export function normalizeProfile(group, input) {
  const profile = {
    group,
    empId: "",
    company: "",
    name: String(input.name ?? "").trim(),
    phone: "",
  };
  if (!CONFIG.groups[group] || !profile.name || profile.name.length > 40)
    throw new Error("이름을 1~40자로 입력해주세요.");
  if (group === "gs") {
    profile.empId = String(input.empId ?? "").trim();
    if (!/^[A-Za-z0-9-]{1,30}$/.test(profile.empId))
      throw new Error("사번은 영문, 숫자, 하이픈으로 1~30자 입력해주세요.");
  } else {
    profile.company = String(input.company ?? "").trim();
    profile.phone = String(input.phone ?? "").replace(/\D/g, "");
    if (!profile.company || profile.company.length > 80)
      throw new Error("회사명 또는 소속을 1~80자로 입력해주세요.");
    if (!/^\d{8,15}$/.test(profile.phone))
      throw new Error("연락처를 확인해주세요. 숫자 8~15자리가 필요합니다.");
  }
  return profile;
}
export const requesterKey = (profile) =>
  JSON.stringify(
    profile.group === "gs"
      ? ["gs", profile.empId]
      : [profile.group, profile.company, profile.name, profile.phone],
  );
export const orderId = (key, date, meal) => JSON.stringify([key, date, meal]);
export function validateChange(row, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !CONFIG.meals[row.meal])
    throw new Error("신청 날짜와 식사를 확인해주세요.");
  if (isClosed(row.date, row.meal, now))
    throw new Error(
      "해당 식사의 마감 시간이 지났습니다. 기존 신청을 다시 불러와주세요.",
    );
  if (!menusFor(row.meal, row.date).includes(row.menu))
    throw new Error("선택 가능한 메뉴를 확인해주세요.");
  if (
    row.meal === "lunch" &&
    row.menu !== CONFIG.noOrder &&
    !CONFIG.locations.includes(row.location)
  )
    throw new Error("중식 장소를 선택해주세요.");
}

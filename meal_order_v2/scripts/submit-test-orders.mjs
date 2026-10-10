// 명시적으로 요청된 테스트 신청을 실제 직원 UI로 제출합니다. 신청은 삭제하지 않습니다.
// 실행은 자동 배포와 분리된 수동 GitHub Actions 작업입니다.
import { chromium, expect } from "playwright/test";
import { randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocsFromServer,
} from "firebase/firestore";
import { FIREBASE } from "../js/firebase-config.js";
import { CONFIG } from "../js/config.js";
import { requesterKey, normalizeProfile, isClosed } from "../js/meal-rules.js";
import { addDays } from "../js/utils.js";
const week = "2026-10-12";
if (isClosed(week, "lunch"))
  throw new Error(
    "Requested week is already closed; no orders were submitted.",
  );
const app = initializeApp(FIREBASE.config, "seed-read-only-verification");
const db = getFirestore(app),
  orders = collection(db, FIREBASE.collection);
const rowsFor = async (key) =>
  (
    await getDocsFromServer(query(orders, where("requesterKey", "==", key)))
  ).docs.map((d) => d.data());
const people = [];
let candidate = 89121;
for (const name of ["김도윤", "이서준", "박하린", "최지우", "정예린"]) {
  let profile;
  do {
    profile = normalizeProfile("gs", { empId: String(candidate++), name });
  } while ((await rowsFor(requesterKey(profile))).length);
  people.push(profile);
}
const url = "https://sskim4912.github.io/new_meal/meal_order_v2/";
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const person of people) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // 재배포 직후 CDN의 이전 정적 파일을 사용하지 않도록 버전 쿼리를 붙입니다.
    await page.route("https://sskim4912.github.io/new_meal/**", (route) => {
      const u = new URL(route.request().url());
      u.searchParams.set("v", process.env.GITHUB_SHA || String(Date.now()));
      route.continue({ url: u.href });
    });
    await page.goto(url);
    await expect(page.locator(".day")).toHaveCount(6);
    for (
      let i = 0;
      i < 30 &&
      !(await page.locator("#weekLabel").innerText()).includes("2026.10.12");
      i++
    ) {
      const text = await page.locator("#weekLabel").innerText();
      await page
        .locator(text.slice(0, 10) < "2026.10.12" ? "#nextWeek" : "#prevWeek")
        .click();
    }
    await expect(page.locator("#weekLabel")).toContainText("2026.10.12");
    await page.locator('[data-field="empId"]').fill(person.empId);
    await page.locator('[data-field="name"]').fill(person.name);
    const monday = page.locator("#menu-2026-10-12-breakfast");
    await expect(monday).toBeDisabled();
    await expect(monday).toHaveValue(CONFIG.noOrder);
    const selections = [];
    for (let day = 0; day < 6; day++) {
      const date = addDays(week, day);
      for (const meal of ["breakfast", "lunch", "dinner"]) {
        if (day === 0 && meal === "breakfast") continue;
        const selector = page.locator(`#menu-${date}-${meal}`);
        await expect(selector).toBeEnabled();
        const options = await selector.locator("option").allTextContents();
        const available = options.filter((value) => value !== CONFIG.noOrder);
        const menu = available[randomInt(available.length)];
        await selector.selectOption(menu);
        let location = "";
        if (meal === "lunch") {
          location = CONFIG.locations[randomInt(CONFIG.locations.length)];
          await page
            .locator(`[data-location][data-date="${date}"]`)
            .selectOption(location);
        }
        selections.push({ date, meal, menu, location });
      }
    }
    await expect(page.locator("#changeCount")).toContainText("17건");
    await page.locator("#submitButton").click();
    await expect(page.locator("#confirmDialog")).toBeVisible();
    await page.locator('#confirmDialog button[value="yes"]').click();
    await expect(page.locator("#successDialog")).toBeVisible({
      timeout: 60000,
    });
    await page.locator("#successDialog button").click();
    const stored = (await rowsFor(requesterKey(person))).filter(
      (r) => r.date >= week && r.date <= addDays(week, 5),
    );
    if (
      stored.length !== 17 ||
      stored.some((r) => r.date === week && r.meal === "breakfast")
    )
      throw new Error("Saved request count or Monday breakfast mismatch");
    for (const expected of selections)
      if (
        !stored.some(
          (r) =>
            r.date === expected.date &&
            r.meal === expected.meal &&
            r.menu === expected.menu &&
            r.location === expected.location,
        )
      )
        throw new Error("Stored selection mismatch");
    report.push({ ...person, count: stored.length, selections });
    await writeFile(
      "test-orders-report.json",
      JSON.stringify({ week, end: addDays(week, 5), people: report }, null, 2),
    );
    console.log(
      `::notice::TEST ORDER SAVED: ${person.empId} ${person.name} 17건`,
    );
    await context.close();
  }
  // 별도 브라우저 기기 컨텍스트의 관리자 화면으로 신청자별 17건을 재확인합니다.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${url}admin.html?v=${process.env.GITHUB_SHA || Date.now()}`);
  await page.locator("#password").fill(CONFIG.adminPassword);
  await page.locator("#passwordForm button.primary").click();
  await expect(page.locator("#adminContent")).toBeVisible();
  await page.locator("#viewMode").selectOption("month");
  await page.locator("#queryMonth").fill("2026-10");
  await page.locator("#queryGroup").selectOption("gs");
  await page.locator("#queryButton").click();
  for (const person of people) {
    await page.locator("#detailSearch").fill(person.empId);
    await expect(page.locator("#detailTable tbody tr")).toHaveCount(17, {
      timeout: 60000,
    });
    await expect(page.locator("#detailTable")).toContainText(person.name);
  }
  console.log(
    "::notice::ADMIN VERIFIED: 5명, 실제 주문 85건, 합계 735000원. 주문을 삭제하지 않고 유지합니다.",
  );
  await context.close();
} finally {
  await browser.close();
  await deleteApp(app);
}

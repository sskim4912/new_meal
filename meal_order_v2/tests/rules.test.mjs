import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, price } from "../js/config.js";
import {
  deadline,
  isClosed,
  menusFor,
  isUnavailable,
  normalizeProfile,
  requesterKey,
  validateChange,
} from "../js/meal-rules.js";
import { monday, addDays, kstToday, csvText, escapeHTML } from "../js/utils.js";
import { aggregate, filterOrders } from "../js/aggregate.js";
import * as storage from "../js/local-storage.js";
test("KST deadline boundaries, independent of host timezone", () => {
  for (const [meal, utc] of [
    ["breakfast", "2026-10-09T04:00:00Z"],
    ["lunch", "2026-10-10T00:00:00Z"],
    ["dinner", "2026-10-10T04:00:00Z"],
  ]) {
    const t = Date.parse(utc);
    assert.equal(deadline("2026-10-10", meal), t);
    assert.equal(isClosed("2026-10-10", meal, t - 1), false);
    assert.equal(isClosed("2026-10-10", meal, t), true);
    assert.throws(
      () =>
        validateChange({ date: "2026-10-10", meal, menu: CONFIG.noOrder }, t),
      /마감/,
    );
  }
});
test("date arithmetic and Sunday-to-Monday", () => {
  assert.equal(monday("2026-10-11"), "2026-10-05");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(kstToday(new Date("2026-10-09T15:00:00Z")), "2026-10-10");
});
test("menus, prices and centralized config changes", () => {
  assert.deepEqual(menusFor("lunch"), ["신청 안 함", "백반"]);
  for (const m of ["breakfast", "dinner"]) {
    assert.equal(menusFor(m).length, 8);
    assert(!menusFor(m).includes("백반"));
  }
  assert.equal(price("백반"), 8000);
  assert.equal(price(CONFIG.noOrder), 0);
  assert.equal(price(CONFIG.menus[0]), 9000);
  const old = CONFIG.prices.default;
  CONFIG.prices.default = 9500;
  assert.equal(price(CONFIG.menus[0]), 9500);
  CONFIG.prices.default = old;
});
test("identity validation and collision-free requester keys", () => {
  const gs = normalizeProfile("gs", { empId: "A-123", name: "홍길동" });
  assert.equal(requesterKey(gs), requesterKey({ ...gs, name: "변경" }));
  const p = normalizeProfile("partner", {
    company: "회사",
    name: "김",
    phone: "010-1234-5678",
  });
  assert.equal(p.phone, "01012345678");
  assert.notEqual(requesterKey(p), requesterKey({ ...p, group: "vip" }));
  assert.throws(() => normalizeProfile("gs", { empId: "<x>", name: "김" }));
  assert.throws(() =>
    normalizeProfile("vip", { company: "회사", name: "김", phone: "123" }),
  );
});
test("aggregation excludes no-order and uses current prices", () => {
  const rows = [
    {
      group: "gs",
      meal: "lunch",
      menu: "백반",
      location: "OSBL",
      date: "2026-10-12",
    },
    {
      group: "gs",
      meal: "lunch",
      menu: "백반",
      location: "OSBL",
      date: "2026-10-12",
    },
    { group: "vip", meal: "dinner", menu: CONFIG.menus[0], date: "2026-10-13" },
    { group: "gs", menu: CONFIG.noOrder, date: "2026-10-12" },
  ];
  assert.deepEqual(
    aggregate(rows, ["location"]).find((b) => b.values[0] === "OSBL"),
    { values: ["OSBL"], quantity: 2, amount: 16000 },
  );
  assert.equal(aggregate(rows, [])[0].amount, 25000);
  assert.equal(
    filterOrders(rows, { mode: "month", month: "2026-10", group: "vip" })
      .length,
    1,
  );
});
test("CSV BOM, quoting, formula protection and escaping", () => {
  const csv = csvText(["이름"], [["=SUM(A1)"], ['김"한,글']]);
  assert(csv.startsWith("\uFEFF"));
  assert(csv.includes("'="));
  assert(csv.includes('김""한,글'));
  assert.equal(escapeHTML("<img>"), "&lt;img&gt;");
});
test("storage upserts, cancellation, profile separation, corruption and write failure", async () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  await storage.upsertOrders([{ id: "1", requesterKey: "a", menu: "백반" }]);
  await storage.upsertOrders([
    { id: "1", requesterKey: "a", menu: CONFIG.noOrder },
    { id: "2", requesterKey: "b", menu: "백반" },
  ]);
  assert.equal((await storage.getAllOrders()).length, 2);
  assert.equal(
    (await storage.getOrdersByRequester("a"))[0].menu,
    CONFIG.noOrder,
  );
  await storage.saveProfiles({ gs: { name: "김" } });
  await storage.deleteOrder("2");
  assert.equal((await storage.getAllOrders()).length, 1);
  await storage.resetOrders();
  assert.equal((await storage.getProfiles()).gs.name, "김");
  map.set("aurora.v2.orders", "broken");
  await assert.rejects(storage.getAllOrders);
  await storage.resetOrders();
  localStorage.setItem = () => {
    throw new Error("quota");
  };
  await assert.rejects(storage.upsertOrders([{ id: "3" }]));
  assert.deepEqual(await storage.getAllOrders(), []);
  await storage.clearProfiles();
  assert.deepEqual(await storage.getProfiles(), {});
});

test("Monday breakfast is not offered; Tuesday breakfast remains available", () => {
  assert.equal(isUnavailable("2026-10-12", "breakfast"), true);
  assert.deepEqual(menusFor("breakfast", "2026-10-12"), [CONFIG.noOrder]);
  assert.equal(isUnavailable("2026-10-13", "breakfast"), false);
  assert.equal(menusFor("breakfast", "2026-10-13").length, 8);
  assert.throws(
    () =>
      validateChange(
        { date: "2026-10-12", meal: "breakfast", menu: CONFIG.menus[0] },
        Date.parse("2026-10-10T00:00:00Z"),
      ),
    /메뉴/,
  );
});

test("2027 holiday calendar includes lunar and substitute holidays", () => {
  assert.equal(Object.keys(CONFIG.holidays).length, 24);
  assert.equal(CONFIG.holidays["2027-02-09"], "설날 대체공휴일");
  assert.equal(CONFIG.holidays["2027-05-03"], "노동절 대체공휴일");
  assert.equal(CONFIG.holidays["2027-07-19"], "제헌절 대체공휴일");
  assert.equal(CONFIG.holidays["2027-09-15"], "추석");
  assert.equal(CONFIG.holidays["2027-12-27"], "성탄절 대체공휴일");
  assert.equal(CONFIG.holidays["2027-06-07"], undefined);
});

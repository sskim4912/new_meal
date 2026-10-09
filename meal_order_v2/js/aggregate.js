import { CONFIG, price } from "./config.js";
export const actualOrders = (rows) =>
  rows.filter((row) => row.menu !== CONFIG.noOrder);
export function aggregate(rows, fields) {
  const buckets = new Map();
  for (const row of actualOrders(rows)) {
    const values = fields.map((field) => row[field] || "—");
    const key = JSON.stringify(values);
    const bucket = buckets.get(key) ?? { values, quantity: 0, amount: 0 };
    bucket.quantity++;
    bucket.amount += price(row.menu);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) =>
    JSON.stringify(a.values).localeCompare(JSON.stringify(b.values), "ko"),
  );
}
export function filterOrders(rows, { mode, date, month, group }) {
  return rows.filter(
    (row) =>
      (mode === "day" ? row.date === date : row.date.startsWith(`${month}-`)) &&
      (group === "all" || row.group === group),
  );
}

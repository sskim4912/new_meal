// DB 교체 시 이 모듈의 비동기 인터페이스를 유지하세요.
const ORDERS = "aurora.v2.orders";
const PROFILES = "aurora.v2.profiles";
function read(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const data = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    (key === ORDERS && !Array.isArray(data)) ||
    (key === PROFILES && Array.isArray(data))
  )
    throw new Error("Invalid stored data");
  return data;
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
export async function getAllOrders() {
  return read(ORDERS, []);
}
export async function getOrdersByRequester(key) {
  return (await getAllOrders()).filter((row) => row.requesterKey === key);
}
export async function upsertOrders(changes) {
  const rows = await getAllOrders();
  const map = new Map(rows.map((row) => [row.id, row]));
  changes.forEach((row) => map.set(row.id, { ...row }));
  write(ORDERS, [...map.values()]);
}
export async function deleteOrder(id) {
  write(
    ORDERS,
    (await getAllOrders()).filter((row) => row.id !== id),
  );
}
export async function resetOrders() {
  localStorage.removeItem(ORDERS);
}
export async function deleteOrders(ids) {
  const selected = new Set(ids);
  write(ORDERS, (await getAllOrders()).filter((row) => !selected.has(row.id)));
}
export async function getProfiles() {
  return read(PROFILES, {});
}
export async function saveProfiles(profiles) {
  write(PROFILES, profiles);
}
export async function clearProfiles() {
  localStorage.removeItem(PROFILES);
}

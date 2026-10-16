// 모든 저장 코드는 이 모듈을 통해 호출합니다. 기본정보는 기기에만 기억합니다.
import { FIREBASE } from "./firebase-config.js";
import * as local from "./local-storage.js";
import { adminRequest } from './admin-session.js';
async function orderStore() {
  return FIREBASE.enabled ? import("./firestore-storage.js") : local;
}
export async function getAllOrders() {
  return (await orderStore()).getAllOrders();
}
export async function getOrdersByRequester(key) {
  return (await orderStore()).getOrdersByRequester(key);
}
export async function upsertOrders(changes) {
  return (await orderStore()).upsertOrders(changes);
}
export async function deleteOrder(id) {
  if (FIREBASE.emulator) return (await orderStore()).deleteOrder(id);
  return FIREBASE.enabled ? adminRequest('/orders/delete', { ids: [id] }) : local.deleteOrder(id);
}
async function deleteAdminOrders(ids) {
  let deleted = 0;
  try {
    for (let i = 0; i < ids.length; i += 450) {
      await adminRequest('/orders/delete', { ids: ids.slice(i, i + 450) });
      deleted += Math.min(450, ids.length - i);
    }
  } catch (error) { if (deleted) error.partialDeletion = true; throw error; }
}
export async function deleteOrders(ids) {
  if (FIREBASE.emulator) return (await orderStore()).deleteOrders(ids);
  return FIREBASE.enabled ? deleteAdminOrders(ids) : local.deleteOrders(ids);
}
export async function resetOrders() {
  if (FIREBASE.emulator) return (await orderStore()).resetOrders();
  if (!FIREBASE.enabled) return local.resetOrders();
  const rows = await getAllOrders();
  return deleteAdminOrders(rows.map(row => row.id));
}
export const getProfiles = local.getProfiles;
export const saveProfiles = local.saveProfiles;
export const clearProfiles = local.clearProfiles;
export const usingFirestore = () => FIREBASE.enabled;
export function storageErrorMessage(error) {
  if (error.partialDeletion)
    return "일부 내역만 삭제되었습니다. 다시 조회하여 남은 내역을 확인해주세요.";
  if (error.isAdminResponse) return error.message;
  if (!FIREBASE.enabled)
    return "브라우저 저장 공간을 확인하고 다시 시도해주세요.";
  if (String(error.code).includes("permission-denied"))
    return "Firestore 접근이 거부되었습니다. Firebase 콘솔의 테스트용 보안 규칙을 확인해주세요.";
  if (String(error.code).includes("resource-exhausted"))
    return "Firebase 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.";
  return "Firebase 연결을 확인하고 다시 시도해주세요. 저장 실패 시 입력한 변경사항은 유지됩니다.";
}

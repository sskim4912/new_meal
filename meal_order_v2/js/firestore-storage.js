import { FIREBASE } from "./firebase-config.js";
import { validateChange } from "./meal-rules.js";
let connection;
async function connect() {
  if (!connection) {
    connection = (async () => {
      if (!FIREBASE.config.apiKey || !FIREBASE.config.appId)
        throw new Error("Firebase configuration is incomplete");
      const sdk = await import("./vendor/firebase-sdk.js");
      const app = sdk.initializeApp(FIREBASE.config);
      const db = sdk.getFirestore(app);
      if (FIREBASE.emulator) {
        sdk.connectFirestoreEmulator(
          db,
          FIREBASE.emulator.host,
          FIREBASE.emulator.port,
        );
      }
      return { sdk, app, db, orders: sdk.collection(db, FIREBASE.collection) };
    })().catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}
// 한글·슬래시 등 사용자 입력을 문서 경로에 직접 사용하지 않습니다.
export async function documentId(id) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(id),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function rowsFrom(snapshot) {
  return snapshot.docs.map((document) => {
    const row = document.data();
    return {
      ...row,
      updatedAt: row.updatedAt?.toDate
        ? row.updatedAt.toDate().toISOString()
        : row.updatedAt,
    };
  });
}
export async function getAllOrders() {
  const { sdk, orders } = await connect();
  return rowsFrom(await sdk.getDocsFromServer(orders));
}
export async function getOrdersByRequester(requesterKey) {
  const { sdk, orders } = await connect();
  return rowsFrom(
    await sdk.getDocsFromServer(
      sdk.query(orders, sdk.where("requesterKey", "==", requesterKey)),
    ),
  );
}
export async function upsertOrders(changes) {
  if (!changes.length) return;
  if (changes.length > 450)
    throw new Error("Too many changes in one submission");
  changes.forEach((row) => validateChange(row));
  const { sdk, db, orders } = await connect();
  const batch = sdk.writeBatch(db);
  for (const row of changes) {
    batch.set(sdk.doc(orders, await documentId(row.id)), {
      ...row,
      updatedAt: sdk.serverTimestamp(),
    });
  }
  // 서버가 저장을 승인한 뒤에만 완료 처리합니다. 오프라인 성공으로 표시하지 않습니다.
  await batch.commit();
}
export async function deleteOrder(id) {
  const { sdk, orders } = await connect();
  await sdk.deleteDoc(sdk.doc(orders, await documentId(id)));
}
export async function resetOrders() {
  const { sdk, db, orders } = await connect();
  const snapshot = await sdk.getDocsFromServer(orders);
  let deleted = 0;
  try {
    for (let i = 0; i < snapshot.docs.length; i += 450) {
      const docs = snapshot.docs.slice(i, i + 450);
      const batch = sdk.writeBatch(db);
      docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += docs.length;
    }
  } catch (error) {
    if (deleted) error.partialDeletion = true;
    throw error;
  }
}

// 테스트 종료 시 SDK의 네트워크 연결을 정리합니다.
export async function closeFirestore() {
  if (!connection) return;
  const { sdk, app, db } = await connection;
  await sdk.terminate(db);
  await sdk.deleteApp(app);
  connection = undefined;
}

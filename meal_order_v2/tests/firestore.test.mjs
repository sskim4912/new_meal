import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { FIREBASE } from "../js/firebase-config.js";
import { CONFIG } from "../js/config.js";
import { normalizeProfile, requesterKey, orderId } from "../js/meal-rules.js";
import * as storage from "../js/storage.js";
import { closeFirestore } from "../js/firestore-storage.js";
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test(
    "Firestore integration requires emulator (run test:firestore)",
    { skip: true },
    () => {},
  );
} else {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  FIREBASE.config.projectId = "demo-aurora";
  FIREBASE.emulator = { host, port: Number(port) };
  const profile = normalizeProfile("gs", { empId: "TEST-001", name: "테스트" });
  const key = requesterKey(profile);
  const row = (meal, menu, location = "") => ({
    ...profile,
    requesterKey: key,
    id: orderId(key, "2099-10-12", meal),
    date: "2099-10-12",
    meal,
    menu,
    location,
    updatedAt: new Date().toISOString(),
  });
  const app = initializeApp({ ...FIREBASE.config }, "other-device");
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port));
  const orders = collection(db, FIREBASE.collection);
  test.after(async () => {
    await deleteApp(app);
    await closeFirestore();
  });
  test("Firestore: shared storage, updates, cancellation, profiles and deletion", async () => {
    await storage.resetOrders();
    await storage.upsertOrders([
      row("lunch", "백반", "OSBL"),
      row("dinner", CONFIG.menus[0]),
    ]);
    const remote = await getDocs(orders);
    assert.equal(
      remote.size,
      2,
      "another SDK client must see the saved orders",
    );
    assert.equal((await storage.getOrdersByRequester(key)).length, 2);
    assert.equal(
      (await storage.getOrdersByRequester("different-person")).length,
      0,
    );
    await storage.upsertOrders([row("lunch", "백반", "ISBL")]);
    assert.equal((await getDocs(orders)).size, 2);
    assert.equal(
      (await storage.getOrdersByRequester(key)).find((r) => r.meal === "lunch")
        .location,
      "ISBL",
    );
    await storage.upsertOrders([row("lunch", CONFIG.noOrder)]);
    assert.equal(
      (await storage.getAllOrders()).find((r) => r.meal === "lunch").menu,
      CONFIG.noOrder,
    );
    const all = await storage.getAllOrders();
    assert(
      all.every((r) => !Number.isNaN(Date.parse(r.updatedAt))),
      "server timestamps should decode",
    );
    await storage.deleteOrder(all.find((r) => r.meal === "dinner").id);
    assert.equal((await getDocs(orders)).size, 1);
    await storage.resetOrders();
    assert.equal((await getDocs(orders)).size, 0);
  });
  test("Firestore rules reject invalid input, expired orders, and unrelated collections", async () => {
    const good = row("lunch", "백반", "사무실");
    const payload = { ...good, updatedAt: serverTimestamp() };
    await assert.rejects(
      setDoc(doc(orders, "bad-menu"), { ...payload, menu: CONFIG.menus[0] }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(orders, "bad-location"), {
        ...payload,
        location: "없는 장소",
      }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(orders, "bad-phone"), {
        ...payload,
        group: "vip",
        empId: "",
        company: "VIP",
        phone: "123",
      }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(orders, "expired"), { ...payload, date: "2020-01-01" }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      setDoc(doc(orders, "extra-field"), { ...payload, extra: "bad" }),
      (e) => e.code === "permission-denied",
    );
    await assert.rejects(
      getDocs(collection(db, "unrelated")),
      (e) => e.code === "permission-denied",
    );

  });
}

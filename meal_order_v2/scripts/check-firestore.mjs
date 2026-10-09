// 읽기 전용 점검. 신청 개인정보는 로그에 표시하지 않습니다.
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  limit,
  getDocsFromServer,
} from "firebase/firestore";
import { FIREBASE } from "../js/firebase-config.js";
const app = initializeApp(FIREBASE.config);
try {
  await getDocsFromServer(
    query(collection(getFirestore(app), FIREBASE.collection), limit(1)),
  );
  console.log(
    "PASS: configured Firestore collection is reachable and readable.",
  );
} catch (error) {
  console.error(`::error::Firestore readiness: ${error.code || "unknown"}`);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}

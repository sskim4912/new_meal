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
  try {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE.config.projectId}/databases/(default)/documents/${FIREBASE.collection}?pageSize=1`, {
      headers: {'X-Goog-Api-Key': FIREBASE.config.apiKey}, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const body = await response.json();
      const message = String(body.error?.message || response.statusText).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
      console.error(`::error::Firestore REST ${response.status}: ${message}`);
    }
  } catch { console.error('::error::Firestore REST endpoint could not be reached.'); }
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}

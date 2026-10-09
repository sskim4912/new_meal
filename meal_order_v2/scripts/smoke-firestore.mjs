// 두 독립 SDK 클라이언트로 실제 프로젝트를 점검합니다. 가짜 신청을 만들고 종료 시 삭제합니다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocFromServer, deleteDoc } from 'firebase/firestore';
import { FIREBASE } from '../js/firebase-config.js';
import { CONFIG } from '../js/config.js';
import { kstToday, monday, addDays } from '../js/utils.js';
import { normalizeProfile, requesterKey, orderId } from '../js/meal-rules.js';
import { documentId, closeFirestore } from '../js/firestore-storage.js';
import * as storage from '../js/storage.js';
const profile=normalizeProfile('gs',{empId:`TEST-${randomUUID().slice(0,20)}`,name:'연결 점검 테스트'});
const key=requesterKey(profile), date=addDays(monday(kstToday()),7);
const id=orderId(key,date,'lunch');
const row={...profile,requesterKey:key,id,date,meal:'lunch',menu:'백반',location:CONFIG.locations[0],updatedAt:new Date().toISOString()};
const app=initializeApp(FIREBASE.config,'cloud-second-device');
const db=getFirestore(app), ref=doc(collection(db,FIREBASE.collection),await documentId(id));
let attempted=false;
try {
  attempted=true; await storage.upsertOrders([row]);
  assert.equal((await getDocFromServer(ref)).data()?.menu,'백반');
  assert.equal((await storage.getOrdersByRequester(key)).length,1);
  await storage.upsertOrders([{...row,menu:CONFIG.noOrder,location:''}]);
  assert.equal((await getDocFromServer(ref)).data()?.menu,CONFIG.noOrder);
  await storage.deleteOrder(id);
  assert.equal((await getDocFromServer(ref)).exists(),false);
  console.log('PASS: actual Firestore save, read from a second client, update, cancellation and deletion.');
} catch(error) {
  console.error(`::error::Firestore shared-storage smoke test: ${error.code || 'assertion-failed'}`);
  process.exitCode=1;
} finally {
  if(attempted) {
    try { await deleteDoc(ref); } catch { console.error('::warning::Synthetic smoke-test record cleanup could not be confirmed.'); }
  }
  await closeFirestore(); await deleteApp(app);
}

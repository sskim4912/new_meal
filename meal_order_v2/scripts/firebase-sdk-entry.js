export { initializeApp, deleteApp } from "firebase/app";
export {
  getFirestore,
  collection,
  doc,
  query,
  where,
  getDocsFromServer,
  writeBatch,
  deleteDoc,
  serverTimestamp,
  connectFirestoreEmulator,
  terminate,
} from "firebase/firestore";

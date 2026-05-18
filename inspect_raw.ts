import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query, where } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectRawG01() {
  const q = query(collection(db, 'records'), where('palletTypeId', '==', 'g01'), where('destination', '==', 'DMM'), where('status', '==', 'received'), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty) {
      console.log(JSON.stringify(snap.docs[0].data(), null, 2));
  } else {
      console.log('No record found');
  }
  process.exit(0);
}

inspectRawG01().catch(console.error);

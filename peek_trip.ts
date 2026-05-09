import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function peek() {
  const q = query(collection(db, 'distributionTrips'), limit(1));
  const snap = await getDocs(q);
  console.log(JSON.stringify(snap.docs[0].data(), null, 2));
  process.exit(0);
}

peek().catch(console.error);

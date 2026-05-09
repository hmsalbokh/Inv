import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkCross() {
  const q = query(collection(db, 'distributionTrips'), where('tripNumber', '==', 'ZASR-T07'));
  const snap = await getDocs(q);
  snap.forEach(doc => {
      const d = doc.data();
      console.log(`Trip: ${d.tripNumber} | originCenter: ${d.originCenter} | Status: ${d.status}`);
  });
  process.exit(0);
}

checkCross().catch(console.error);

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkTripCenter() {
  const q = query(collection(db, 'distributionTrips'), where('tripNumber', '==', 'ZAHS-T05'));
  const snap = await getDocs(q);
  snap.forEach(doc => {
      const d = doc.data();
      console.log(`Trip: ${d.tripNumber} | originCenter: ${d.originCenter} | destinationCity: ${d.destinationCity}`);
  });
  process.exit(0);
}

checkTripCenter().catch(console.error);

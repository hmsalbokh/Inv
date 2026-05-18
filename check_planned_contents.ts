import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkSpecificPlannedTrips() {
const discrepancies = {
    'g01': 166,
    'g02': 214,
    'g03': 188,
    'g04': 202,
    'g05': 185,
    'g06': 182,
    'g07': 239
  };

  const q = query(collection(db, 'distributionTrips'), where('originCenter', '==', 'DMM'), where('status', '==', 'planned'));
  const snap = await getDocs(q);
  const plannedTrips = snap.docs.map(d => d.data());
  
  console.log(`Checking combinations of ${plannedTrips.length} planned trips...`);
  
  // This could be heavy, let's just log each planned trip's quantities to see if one matches
  for (const t of plannedTrips) {
      const qts = t.quantities || [];
      const g01 = qts.find(q => q.palletTypeId === 'g01')?.cartonCount || 0;
      const g02 = qts.find(q => q.palletTypeId === 'g02')?.cartonCount || 0;
      if (Math.abs(g01 - 166) < 20 || Math.abs(g02 - 214) < 20) {
          console.log(`Trip ${t.tripNumber} (Date: ${t.date}) has G01: ${g01}, G02: ${g02}`);
      }
  }

  process.exit(0);
}

checkSpecificPlannedTrips().catch(console.error);

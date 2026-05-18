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
  
  const trips = plannedTrips.map(t => {
      const qts = t.quantities || [];
      return {
          id: t.tripNumber,
          date: t.date,
          counts: {
              g01: qts.find(q => q.palletTypeId === 'g01')?.cartonCount || 0,
              g02: qts.find(q => q.palletTypeId === 'g02')?.cartonCount || 0,
              g03: qts.find(q => q.palletTypeId === 'g03')?.cartonCount || 0,
              g04: qts.find(q => q.palletTypeId === 'g04')?.cartonCount || 0,
              g05: qts.find(q => q.palletTypeId === 'g05')?.cartonCount || 0,
              g06: qts.find(q => q.palletTypeId === 'g06')?.cartonCount || 0,
              g07: qts.find(q => q.palletTypeId === 'g07')?.cartonCount || 0,
          }
      };
  });
  
  let matchFound = false;

  for (let i = 0; i < trips.length; i++) {
      for (let j = i + 1; j < trips.length; j++) {
          const t1 = trips[i];
          const t2 = trips[j];
          if (Math.abs(t1.counts.g01 + t2.counts.g01 - discrepancies.g01) < 5) {
              let matches = 0;
              for (const g of ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07']) {
                  if (Math.abs(t1.counts[g] + t2.counts[g] - discrepancies[g]) < 10) matches++;
              }
              if (matches > 3) {
                  console.log(`MATCH pairs: ${t1.id} + ${t2.id}`);
                  matchFound = true;
              }
          }
      }
  }

  if (!matchFound) {
      console.log('No combination match found.');
  }
  process.exit(0);
}
checkSpecificPlannedTrips().catch(console.error);

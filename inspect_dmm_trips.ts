import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectDmmTrips() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`إجمالي رحلات الدمام: ${trips.length}`);
  
  const tripNumCounts = new Map<string, number>();
  trips.forEach(t => {
      const n = t.tripNumber;
      tripNumCounts.set(n, (tripNumCounts.get(n) || 0) + 1);
  });

  console.log('--- تكرار أرقام الرحلات في الدمام ---');
  tripNumCounts.forEach((count, num) => {
      if (count > 1) {
          console.log(`الرقم "${num}" متكرر ${count} مرات`);
          const items = trips.filter(t => t.tripNumber === num);
          items.forEach(i => {
              console.log(`  - الحالة: ${i.status} | التاريخ: ${i.date} | ID: ${i.id}`);
          });
      }
  });

  process.exit(0);
}

inspectDmmTrips().catch(console.error);

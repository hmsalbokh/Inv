import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkExecuted() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmShipped = trips.filter(t => (t.status === 'dispatched' || t.status === 'executed') && t.originCenter === 'DMM');
  
  console.log('Trips with Discrepancy between Planned and Executed (G01):');
  dmmShipped.forEach(t => {
      const p = (t.quantities || []).find((q: any) => q.palletTypeId === 'g01')?.cartonCount || 0;
      const e = (t.executedQuantities || []).find((q: any) => q.palletTypeId === 'g01')?.cartonCount || 0;
      if (t.executedQuantities && p !== e) {
          console.log(`Trip: ${t.tripNumber} | Planned: ${p} | Executed: ${e} | Diff: ${e - p}`);
      }
  });

  process.exit(0);
}

checkExecuted().catch(console.error);

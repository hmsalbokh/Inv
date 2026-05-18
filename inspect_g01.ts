import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectG01() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const g01Type = 'g01'; // ID for G01
  const dmmReceived = records.filter(r => r.palletTypeId === g01Type && r.destination === 'DMM' && r.status === 'received');
  
  console.log(`G01 Received at DMM: ${dmmReceived.length} pallets`);
  let totalRec = 0;
  dmmReceived.forEach(r => {
      let count = 56;
      if (r.extraCartons) count += r.extraCartons;
      if (r.missingCartons) count -= r.missingCartons;
      totalRec += count;
  });
  console.log(`Total Rec G01: ${totalRec}`);

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmShipped = trips.filter(t => (t.status === 'dispatched' || t.status === 'executed') && t.originCenter === 'DMM');
  let totalShipped = 0;
  dmmShipped.forEach(t => {
      const qts = t.executedQuantities || t.quantities || [];
      const g01 = qts.find((q: any) => q.palletTypeId === g01Type);
      if (g01) totalShipped += g01.cartonCount;
  });
  console.log(`Total Shipped G01 (Raw Trips): ${totalShipped}`);

  process.exit(0);
}

inspectG01().catch(console.error);

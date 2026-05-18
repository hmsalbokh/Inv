import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkG01Origin() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmG01Rec = records.filter(r => r.palletTypeId === 'g01' && r.destination === 'DMM' && r.status === 'received');
  
  const tripMap: Record<string, number> = {};
  dmmG01Rec.forEach(r => {
      const trip = r.tripNumber || 'NO_TRIP';
      tripMap[trip] = (tripMap[trip] || 0) + 1;
  });
  
  console.log('G01 Origin Trips (Pallets received from each primary trip):');
  console.log(tripMap);

  process.exit(0);
}

checkG01Origin().catch(console.error);

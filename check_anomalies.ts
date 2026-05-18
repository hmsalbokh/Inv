import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkG01Anomalies() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmG01 = records.filter(r => r.palletTypeId === 'g01' && r.destination === 'DMM' && r.status === 'received');
  
  console.log(`G01 Received Pallets: ${dmmG01.length}`);
  
  let withMods = 0;
  dmmG01.forEach(r => {
      if (r.extraCartons || r.missingCartons || r.hasDiscrepancy) {
          withMods++;
          console.log(`Pallet ID: ${r.id} | Extra: ${r.extraCartons || 0} | Missing: ${r.missingCartons || 0} | Discrepancy: ${r.hasDiscrepancy ? (r.discrepancyType + ' ' + r.discrepancyCartonsQty) : 'No'}`);
      }
  });
  console.log(`Pallets with modifications: ${withMods}`);

  process.exit(0);
}

checkG01Anomalies().catch(console.error);

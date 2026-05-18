import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkDuplicatePallets() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const palletMap = new Map<string, any[]>();
  records.forEach(r => {
    if (r.palletNumber) {
      if (!palletMap.has(r.palletNumber)) palletMap.set(r.palletNumber, []);
      palletMap.get(r.palletNumber)!.push(r);
    }
  });

  console.log('Duplicate Pallet Numbers:');
  for (const [num, list] of palletMap.entries()) {
    if (list.length > 1) {
      console.log(`Pallet: ${num} | Count: ${list.length}`);
      list.forEach(item => {
          console.log(`  - ID: ${item.id} | Status: ${item.status} | Dest: ${item.destination}`);
      });
    }
  }

  process.exit(0);
}

checkDuplicatePallets().catch(console.error);

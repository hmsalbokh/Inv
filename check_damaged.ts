import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkDamaged() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const damaged = records.filter(r => r.destination === 'DMM' && r.status === 'received' && r.condition && r.condition !== 'intact');
  
  console.log(`Damaged pallets at DMM: ${damaged.length}`);
  damaged.forEach(r => {
      console.log(`Pallet: ${r.palletNumber} | Stage: ${r.palletTypeId} | Condition: ${r.condition}`);
  });

  process.exit(0);
}

checkDamaged().catch(console.error);

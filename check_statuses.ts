import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkG01Statuses() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmG01 = records.filter(r => r.palletTypeId === 'g01' && r.destination === 'DMM');
  
  const stats: Record<string, number> = {};
  dmmG01.forEach(r => {
      stats[r.status] = (stats[r.status] || 0) + 1;
  });
  
  console.log('G01 Statuses at DMM:');
  console.log(stats);

  process.exit(0);
}

checkG01Statuses().catch(console.error);

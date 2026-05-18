import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkG01Manifests() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmG01Rec = records.filter(r => r.palletTypeId === 'g01' && r.destination === 'DMM' && r.status === 'received');
  
  const manifestStats: Record<string, number> = {};
  dmmG01Rec.forEach(r => {
      const manifest = r.manifestNumber || 'NO_MANIFEST';
      manifestStats[manifest] = (manifestStats[manifest] || 0) + 1;
  });
  
  console.log('G01 Manifests (Pallets per manifest):');
  console.log(manifestStats);

  process.exit(0);
}

checkG01Manifests().catch(console.error);

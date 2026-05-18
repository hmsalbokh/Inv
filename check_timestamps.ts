import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkG01Timestamps() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmG01Rec = records.filter(r => r.palletTypeId === 'g01' && r.destination === 'DMM' && r.status === 'received');
  
  const timeMap: Record<string, number> = {};
  dmmG01Rec.forEach(r => {
      // Use seconds to group close together entries
      const time = r.timestamp || r.centerTimestamp || r.factoryTimestamp;
      if (!time) {
          timeMap['MISSING'] = (timeMap['MISSING'] || 0) + 1;
          return;
      }
      const date = new Date(time);
      const key = date.toISOString().substring(0, 10); // Group by Day
      timeMap[key] = (timeMap[key] || 0) + 1;
  });
  
  console.log('G01 Reception Time Clusters (By Minute):');
  console.log(timeMap);

  process.exit(0);
}

checkG01Timestamps().catch(console.error);

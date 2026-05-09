import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkExcess() {
  const recordsSnap = await getDocs(collection(db, 'inventoryRecords'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(r => r.destination === 'DMM' && r.discrepancyType === 'excess');

  console.log(`عدد الطبليات الزائدة المستلمة في الدمام: ${records.length}`);
  
  let totalExtra = 0;
  records.forEach(r => {
      totalExtra += (r.extraCartons || 0);
  });
  
  console.log(`إجمالي الكراتين الزائدة (Excess): ${totalExtra}`);

  process.exit(0);
}

checkExcess().catch(console.error);

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectRecords() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const type = palletTypes.find(t => t.stageName === 'الصف الثاني الابتدائي');
  
  if (!type) {
    console.log(`Stage not found`);
    return;
  }

  const recordsSnap = await getDocs(collection(db, 'palletRecords'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  
  console.log(`Type ID: ${type.id}, Cartons/Pallet: ${type.cartonsPerPallet}`);
  const relevant = records.filter(r => r.palletTypeId === type.id);
  console.log(`Total records for this type: ${relevant.length}`);
  
  const statusCounts: any = {};
  relevant.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (r.status === 'received') {
        console.log(`Pallet: ${r.palletBarcode}, Destination: ${r.destination}, Center: ${r.centerCode}`);
    }
  });
  console.log('Status counts:', statusCounts);

  process.exit(0);
}
inspectRecords().catch(console.error);

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkEmptyNumbers() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  const empty = trips.filter(t => !t.tripNumber || t.tripNumber.trim() === '');
  console.log(`رحلات بدون رقم في الدمام: ${empty.length}`);
  
  empty.forEach(t => {
      console.log(`  - ID: ${t.id} | التاريخ: ${t.date} | المقصد: ${t.destinationCity} | حالة: ${t.status}`);
  });

  process.exit(0);
}

checkEmptyNumbers().catch(console.error);

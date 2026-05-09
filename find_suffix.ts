import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findSuffix() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const patterns = ['-A', '-B', 'NEW', ' ', '_'];
  
  const found = trips.filter(t => {
      const num = t.tripNumber || '';
      return patterns.some(p => num.toUpperCase().includes(p));
  });

  console.log(`وجدت ${found.length} رحلة بلاحقة أو نمط خاص:`);
  found.forEach(t => {
      console.log(`- ${t.tripNumber} | المركز: ${t.originCenter}`);
  });

  process.exit(0);
}

findSuffix().catch(console.error);

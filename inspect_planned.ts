import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectPlanned() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM' && t.status === 'planned');

  console.log(`وجد ${trips.length} رحلة "مخططة" في الدمام.`);
  
  const destMap = new Map<string, number>();
  trips.forEach(t => {
      destMap.set(t.destinationCity, (destMap.get(t.destinationCity) || 0) + 1);
  });

  console.log('--- توزيع المقاصد للرحلات المخططة ---');
  destMap.forEach((count, city) => {
      console.log(`${city}: ${count} رحلات`);
  });

  process.exit(0);
}

inspectPlanned().catch(console.error);

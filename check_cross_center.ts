import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkCrossCenterDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const normalize = (s: string) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  
  const numGroups = new Map<string, any[]>();
  trips.forEach(t => {
    const n = normalize(t.tripNumber);
    if (!numGroups.has(n)) numGroups.set(n, []);
    numGroups.get(n)!.push(t);
  });

  console.log('--- رحلات لها نفس الرقم ولكن مراكز منشأ مختلفة ---');
  numGroups.forEach((items, num) => {
    const centers = new Set(items.map(i => i.originCenter));
    if (centers.size > 1) {
      console.log(`\nرقم الرحلة: ${num.toUpperCase()}`);
      items.forEach(i => {
        console.log(`  - المركز: ${i.originCenter} | الحالة: ${i.status} | التاريخ: ${i.date} | المعرف: ${i.id}`);
      });
    }
  });

  process.exit(0);
}

checkCrossCenterDuplicates().catch(console.error);

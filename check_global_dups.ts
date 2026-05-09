import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkGlobalDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const counts = new Map<string, any[]>();
  trips.forEach(t => {
      const clean = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
      if (!counts.has(clean)) counts.set(clean, []);
      counts.get(clean)!.push(t);
  });

  console.log('--- تكرار أرقام الرحلات عبر المراكز ---');
  counts.forEach((items, num) => {
      if (items.length > 1) {
          const centers = new Set(items.map(i => i.originCenter));
          if (centers.size > 1) {
              console.log(`\n🚨 الرقم "${num}" متكرر في مراكز مختلفة:`);
              items.forEach(i => {
                  console.log(`  - المركز: ${i.originCenter} | الحالة: ${i.status} | المقصد: ${i.destinationCity}`);
              });
          }
      }
  });

  process.exit(0);
}

checkGlobalDuplicates().catch(console.error);

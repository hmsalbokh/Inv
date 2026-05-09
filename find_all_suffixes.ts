import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findAllSuffixes() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const groups = new Map<string, any[]>();
  trips.forEach(t => {
      const clean = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
      if (!groups.has(clean)) groups.set(clean, []);
      groups.get(clean)!.push(t);
  });

  console.log('--- البحث عن تداخلات بلاحقة في كامل النظام ---');
  const allNums = Array.from(groups.keys()).sort();
  
  for (let i = 0; i < allNums.length; i++) {
      for (let j = 1; j <= 2; j++) { // check 1 or 2 char suffix
          const candidateSuffix = allNums.find(n => n.startsWith(allNums[i]) && n.length === allNums[i].length + j);
          if (candidateSuffix) {
              console.log(`\n🚩 وجد تداخل بلاحقة: "${allNums[i]}" و "${candidateSuffix}"`);
              const t1 = groups.get(allNums[i])![0];
              const t2 = groups.get(candidateSuffix)![0];
              console.log(`  - ${t1.tripNumber} (${t1.originCenter}) -> ${t1.destinationCity}`);
              console.log(`  - ${t2.tripNumber} (${t2.originCenter}) -> ${t2.destinationCity}`);
          }
      }
  }

  process.exit(0);
}

findAllSuffixes().catch(console.error);

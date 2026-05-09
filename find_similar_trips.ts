import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findSimilarTrips() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched'));

  console.log(`فحص ${trips.length} رحلة منفذة في الدمام...`);
  
  const groups = new Map<string, any[]>();
  trips.forEach(t => {
      const key = `${t.date}_${t.destinationCity}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
  });

  groups.forEach((items, key) => {
      if (items.length > 1) {
          console.log(`\n📅 تاريخ ومقصد متكرر: ${key}`);
          items.forEach(i => {
              console.log(`  - الرقم: "${i.tripNumber}" | الكميات: ${JSON.stringify(i.quantities.slice(0,2))}...`);
          });
          
          // Check if any pair has similar numbers
          for (let i = 0; i < items.length; i++) {
              for (let j = i + 1; j < items.length; j++) {
                  const n1 = items[i].tripNumber.toLowerCase();
                  const n2 = items[j].tripNumber.toLowerCase();
                  if (n1.startsWith(n2) || n2.startsWith(n1) || n1.includes(n2) || n2.includes(n1)) {
                      console.log(`  >> !!! تنبيه: تشابه في أرقام الرحلات: "${items[i].tripNumber}" و "${items[j].tripNumber}"`);
                  }
              }
          }
      }
  });

  process.exit(0);
}

findSimilarTrips().catch(console.error);

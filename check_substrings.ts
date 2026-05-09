import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkSubstrings() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  const numbers = trips.map(t => t.tripNumber).filter(Boolean);
  
  console.log(`فحص ${numbers.length} رقم رحلة في الدمام بحثاً عن تداخلات جزئية...`);
  
  for (let i = 0; i < numbers.length; i++) {
      for (let j = 0; j < numbers.length; j++) {
          if (i === j) continue;
          const a = numbers[i].toLowerCase();
          const b = numbers[j].toLowerCase();
          if (a.includes(b) && a.length > b.length) {
              console.log(`  - الرقم "${b}" موجود داخل الرقم "${a}"`);
          }
      }
  }

  process.exit(0);
}

checkSubstrings().catch(console.error);

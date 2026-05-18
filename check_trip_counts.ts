import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkTripCounts() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const dmmShipped = trips.filter(t => (t.status === 'dispatched' || t.status === 'executed') && t.originCenter === 'DMM');
  
  console.log('G01 Trip Counts (Non-multiples of 56):');
  dmmShipped.forEach(t => {
      const qts = t.executedQuantities || t.quantities || [];
      const g01 = qts.find((q: any) => q.palletTypeId === 'g01');
      if (g01 && g01.cartonCount % 56 !== 0) {
          console.log(`Trip: ${t.tripNumber} | Count: ${g01.cartonCount} | Reminder: ${g01.cartonCount % 56}`);
      }
  });

  process.exit(0);
}

checkTripCounts().catch(console.error);

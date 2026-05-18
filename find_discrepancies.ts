import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findDiscrepancies() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const allTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  console.log('Planned Trips for DMM (Stage Counts):');
  allTrips.filter(t => t.status === 'planned' && t.originCenter === 'DMM').forEach(t => {
      const qts = t.quantities || [];
      const totalCartons = qts.reduce((acc: number, q: any) => acc + q.cartonCount, 0);
      console.log(`Trip: ${t.tripNumber} | Date: ${t.date} | Total: ${totalCartons}`);
  });

  process.exit(0);
}

findDiscrepancies().catch(console.error);

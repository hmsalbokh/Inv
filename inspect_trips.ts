import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectTripsCollection() {
  const tripsSnap = await getDocs(collection(db, 'trips'));
  const allTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const dmmIncoming = allTrips.filter(t => t.centerCode === 'DMM');
  console.log(`DMM Incoming Trips (from factory): ${dmmIncoming.length}`);
  
  const numberMap: Record<string, number> = {};
  dmmIncoming.forEach(t => {
      numberMap[t.tripNumber] = (numberMap[t.tripNumber] || 0) + 1;
  });
  
  console.log('Duplicates in tripNumber:');
  for (const [num, count] of Object.entries(numberMap)) {
      if (count > 1) console.log(`Trip: ${num} | Count: ${count}`);
  }

  process.exit(0);
}

inspectTripsCollection().catch(console.error);

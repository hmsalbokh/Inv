import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkTripDetails() {
  const tripId = '7ae36dac-60d9-4fac-b11c-d0e73496cc7b';
  const tripSnap = await getDoc(doc(db, 'distributionTrips', tripId));
  if (tripSnap.exists()) {
      console.log(JSON.stringify(tripSnap.data(), null, 2));
  } else {
      // Check 'trips' collection (old collection name?)
      const tripSnap2 = await getDoc(doc(db, 'trips', tripId));
      if (tripSnap2.exists()) {
          console.log('Found in "trips" collection:');
          console.log(JSON.stringify(tripSnap2.data(), null, 2));
      } else {
          console.log('Trip not found in either collection');
      }
  }
  process.exit(0);
}

checkTripDetails().catch(console.error);

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkTypes() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  typesSnap.docs.forEach(doc => {
      const data = doc.data();
      console.log(`${data.stageName} | Code: ${data.stageCode} | ID: ${doc.id} | Cartons/Pallet: ${data.cartonsPerPallet}`);
  });
  process.exit(0);
}
checkTypes().catch(console.error);

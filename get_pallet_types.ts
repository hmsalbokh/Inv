import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function getAll() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  typesSnap.docs.forEach(doc => {
      const data = doc.data();
      console.log(`${data.stageName} | ID: ${doc.id}`);
  });
  process.exit(0);
}
getAll();

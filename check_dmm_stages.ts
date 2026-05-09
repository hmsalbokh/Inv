import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkQuantitiesPerStage() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched'));

  const stageTotals = new Map<string, number>();

  trips.forEach(t => {
    (t.executedQuantities || t.quantities).forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (!type) return;
      const name = type.stageName;
      stageTotals.set(name, (stageTotals.get(name) || 0) + q.cartonCount);
    });
  });

  console.log('| المرحلة | إجمالي الكراتين المنفذة في النظام |');
  console.log('| :--- | :--- |');
  stageTotals.forEach((total, name) => {
    console.log(`| ${name} | ${total} |`);
  });

  process.exit(0);
}

checkQuantitiesPerStage().catch(console.error);

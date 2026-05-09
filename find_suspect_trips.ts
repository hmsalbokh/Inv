import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findSuspectTrips() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const targetType = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
                    .find(t => t.stageName === 'الصف السادس الابتدائي');
  if (!targetType) return;

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched'));

  console.log('--- رحلات الدمام التي تحتوي على "الصف السادس الابتدائي" ---');
  trips.forEach(t => {
      const q = t.quantities?.find((qty:any) => qty.palletTypeId === targetType.id);
      if (q && q.cartonCount > 0) {
          console.log(`- الرقم: ${t.tripNumber} | الكمية: ${q.cartonCount} | التاريخ: ${t.date} | المقصد: ${t.destinationCity}`);
      }
  });

  process.exit(0);
}

findSuspectTrips().catch(console.error);

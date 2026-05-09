import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findSmallDiscrepancy() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const targetType = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
                    .find(t => t.stageName === 'الصف الأول الابتدائي');
  if (!targetType) return;

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched'));

  console.log('--- البحث عن رحلات بكمية تقارب الـ 97.5 كرتون (الصف الأول الابتدائي) ---');
  trips.forEach(t => {
      const q = t.quantities?.find((qty:any) => qty.palletTypeId === targetType.id);
      if (q && q.cartonCount > 0) {
          // Check if cartonCount is near 97 or 98
          if (Math.abs(q.cartonCount - 97) < 10) {
              console.log(`- الرقم: ${t.tripNumber} | الكمية: ${q.cartonCount} | التاريخ: ${t.date} | المقصد: ${t.destinationCity}`);
          }
      }
  });

  process.exit(0);
}

findSmallDiscrepancy().catch(console.error);

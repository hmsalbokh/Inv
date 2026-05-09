import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findFuzzyDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`فحص ${trips.length} رحلة في الدمام بحثاً عن تكرار مقصد وكميات متقاربة...`);
  
  const groups = new Map<string, any[]>();
  trips.forEach(t => {
      if (!groups.has(t.destinationCity)) groups.set(t.destinationCity, []);
      groups.get(t.destinationCity)!.push(t);
  });

  groups.forEach((items, city) => {
      if (items.length > 1) {
          for (let i = 0; i < items.length; i++) {
              for (let j = i + 1; j < items.length; j++) {
                  const t1 = items[i];
                  const t2 = items[j];
                  
                  // حساب إجمالي الكراتين لكل رحلة
                  const sum1 = t1.quantities.reduce((acc: number, q: any) => acc + q.cartonCount, 0);
                  const sum2 = t2.quantities.reduce((acc: number, q: any) => acc + q.cartonCount, 0);
                  
                  if (sum1 === 0 || sum2 === 0) continue;
                  
                  const diff = Math.abs(sum1 - sum2);
                  const percent = diff / Math.max(sum1, sum2);
                  
                  // إذا كانت الكمية متقاربة جداً (أقل من 2%) والمقصد نفسه
                  if (percent < 0.02) {
                      console.log(`\n🚨 احتمالية تكرار "شبه متطابق":`);
                      console.log(`  - مدينة: ${city}`);
                      console.log(`  - رحلة 1: ${t1.tripNumber} | التاريخ: ${t1.date} | الكمية: ${sum1} | الحالة: ${t1.status}`);
                      console.log(`  - رحلة 2: ${t2.tripNumber} | التاريخ: ${t2.date} | الكمية: ${sum2} | الحالة: ${t2.status}`);
                  }
              }
          }
      }
  });

  process.exit(0);
}

findFuzzyDuplicates().catch(console.error);

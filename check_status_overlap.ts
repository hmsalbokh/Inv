import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkStatusOverlap() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`فحص تداخل الحالات لنفس المدينة والكمية في الدمام...`);
  
  const tripMap = new Map<string, any[]>();
  
  trips.forEach(t => {
    const fingerprint = (t.quantities || [])
      .sort((a:any, b:any) => a.palletTypeId.localeCompare(b.palletTypeId))
      .map((q:any) => `${q.palletTypeId}:${q.cartonCount}`)
      .join('|');
    
    // المفتاح: مقصد + كميات
    const key = `${t.destinationCity}_${fingerprint}`;
    
    if (!tripMap.has(key)) tripMap.set(key, []);
    tripMap.get(key)!.push(t);
  });

  tripMap.forEach((items, key) => {
    if (items.length > 1) {
      const hasExecuted = items.some(i => i.status === 'executed');
      const hasDispatched = items.some(i => i.status === 'dispatched');
      const hasPlanned = items.some(i => i.status === 'planned');
      
      if ((hasExecuted || hasDispatched) && hasPlanned) {
          console.log(`\n🚨 وجد رحلة "مخططة" ورحلة "منفذة" بنفس المحتوى والمقصد (أرقام مختلفة!):`);
          items.forEach(i => {
              console.log(`  - الرقم: "${i.tripNumber}" | الحالة: ${i.status} | التاريخ: ${i.date}`);
          });
      }
    }
  });

  process.exit(0);
}

checkStatusOverlap().catch(console.error);

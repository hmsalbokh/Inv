import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findLooseDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`فحص ${trips.length} رحلة في الدمام بحثاً عن تكرار المحتوى والمقصد (بدون اعتبار التاريخ)...`);
  
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
      console.log(`\n🚨 رحلات متطابقة تماماً (مقصد/كميات) ببيانات مختلفة:`);
      items.forEach(i => {
        console.log(`  - الرقم: "${i.tripNumber}" | التاريخ: ${i.date} | الحالة: ${i.status} | ID: ${i.id}`);
      });
    }
  });

  process.exit(0);
}

findLooseDuplicates().catch(console.error);

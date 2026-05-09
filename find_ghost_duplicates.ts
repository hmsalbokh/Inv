import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findGhostDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`فحص ${trips.length} رحلة في الدمام بحثاً عن تكرار المحتوى والمقصد...`);
  
  const tripMap = new Map<string, any[]>();
  
  trips.forEach(t => {
    const fingerprint = (t.quantities || [])
      .sort((a:any, b:any) => a.palletTypeId.localeCompare(b.palletTypeId))
      .map((q:any) => `${q.palletTypeId}:${q.cartonCount}`)
      .join('|');
    
    // المفتاح: تاريخ + مقصد + كميات
    const key = `${t.date}_${t.destinationCity}_${fingerprint}`;
    
    if (!tripMap.has(key)) tripMap.set(key, []);
    tripMap.get(key)!.push(t);
  });

  let duplicatesCount = 0;
  tripMap.forEach((items, key) => {
    if (items.length > 1) {
      duplicatesCount++;
      console.log(`\n🚨 رحلات متطابقة تماماً (تاريخ/مقصد/كميات) ولكن بأرقام مختلفة:`);
      items.forEach(i => {
        console.log(`  - الرقم: "${i.tripNumber}" | الحالة: ${i.status} | ID: ${i.id}`);
      });
    }
  });

  if (duplicatesCount === 0) {
      console.log('لم يتم العثور على رحلات "شبح" متكررة بنفس المحتوى والمقصد.');
  }

  process.exit(0);
}

findGhostDuplicates().catch(console.error);

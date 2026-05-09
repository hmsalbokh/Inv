import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findDuplicateQuantities() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  console.log(`فحص ${trips.length} رحلة في الدمام بحثاً عن تطابق الكميات...`);
  
  const contentMap = new Map<string, any[]>();
  
  trips.forEach(t => {
    // إنشاء بصمة للكميات
    const fingerprint = (t.quantities || [])
      .sort((a:any, b:any) => a.palletTypeId.localeCompare(b.palletTypeId))
      .map((q:any) => `${q.palletTypeId}:${q.cartonCount}:${q.bundleCount}`)
      .join('|');
    
    if (!contentMap.has(fingerprint)) contentMap.set(fingerprint, []);
    contentMap.get(fingerprint)!.push(t);
  });

  contentMap.forEach((items, fingerprint) => {
    if (items.length > 1) {
      console.log(`\n📦 بصمة كميات متكررة وجدت في ${items.length} رحلات:`);
      items.forEach(i => {
        console.log(`  - الرقم: "${i.tripNumber}" | الحالة: ${i.status} | التاريخ: ${i.date} | ID: ${i.id}`);
      });
    }
  });

  process.exit(0);
}

findDuplicateQuantities().catch(console.error);

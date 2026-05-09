import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function findLogicalDuplicates() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  const normalize = (s: string) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  console.log('--- تحليل احتمالية تكرار الرحلات (لواحق) في الدمام ---');
  
  const processed = new Set<string>();

  trips.forEach(t1 => {
    const n1 = normalize(t1.tripNumber);
    if (n1.length < 5) return;

    trips.forEach(t2 => {
      if (t1.id === t2.id) return;
      const n2 = normalize(t2.tripNumber);

      // إذا كانت n1 هي "جذر" n2 (مثلاً zdmmt01 هي جذر zdmmt01a)
      // أو إذا كان التفاوت بسيطاً جداً
      if (n2.startsWith(n1) && n1 !== n2) {
        console.log(`\n⚠️ احتمال تكرار (لاحقة):`);
        console.log(`  - الأساسي: "${t1.tripNumber}" | الحالة: ${t1.status} | التاريخ: ${t1.date}`);
        console.log(`  - اللاحق:   "${t2.tripNumber}" | الحالة: ${t2.status} | التاريخ: ${t2.date}`);
        
        // التحقق من تكرار المحتوى (الأصناف)
        const qt1 = (t1.quantities || []).map((q:any) => q.palletTypeId).sort().join(',');
        const qt2 = (t2.quantities || []).map((q:any) => q.palletTypeId).sort().join(',');
        if (qt1 === qt2) {
            console.log(`  >> تنبيه: الرحلتان تحتويان على نفس قائمة المراحل!`);
        }
      }
    });
  });

  process.exit(0);
}

findLogicalDuplicates().catch(console.error);

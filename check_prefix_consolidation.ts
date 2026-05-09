import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkPrefixConsolidation() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
    .filter(t => t.originCenter === 'DMM');

  const normalized = trips.map(t => ({
    ...t,
    clean: (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase()
  })).sort((a, b) => b.clean.length - a.clean.length); // الأطول أولاً لمحاولة العثور على جذوره

  const excludedIds = new Set<string>();
  
  for (let i = 0; i < normalized.length; i++) {
    const tLong = normalized[i];
    if (excludedIds.has(tLong.id)) continue;
    
    for (let j = i + 1; j < normalized.length; j++) {
       const tShort = normalized[j];
       if (excludedIds.has(tShort.id)) continue;
       
       // إذا كان الرقم الصغير هو "جذر" للرقم الطويل
       // مثلاً zdmmt01 هو جذر لـ zdmmt01a
       if (tLong.clean.startsWith(tShort.clean) && tLong.clean.length > tShort.clean.length) {
          // التحقق من أن تباين الطول بسيط (لاحقة) وليس رقماً مختلفاً تماماً (مثل T1 و T11)
          if (tLong.clean.length - tShort.clean.length <= 3) {
             console.log(`Found Prefix Match: [${tLong.tripNumber}] replaces [${tShort.tripNumber}]`);
             excludedIds.add(tShort.id);
          }
       }
    }
  }

  const consolidated = normalized.filter(t => !excludedIds.has(t.id));
  
  let totalExecuted = 0;
  consolidated.filter(t => t.status === 'executed' || t.status === 'dispatched').forEach(t => {
      (t.quantities || []).forEach((q:any) => {
          // Sum for the 7 stages (mocking the check_dmm_stages logic)
          // For simplicity, just check if it matches a known stage ID or just sum everything for DMM
          totalExecuted += q.cartonCount;
      });
  });

  console.log(`\nعدد الرحلات المستبعدة: ${excludedIds.size}`);
  console.log(`إجمالي الكراتين المنفذة (بعد دمج السوابق): ${totalExecuted}`);

  process.exit(0);
}

checkPrefixConsolidation().catch(console.error);

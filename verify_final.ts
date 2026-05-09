import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const USER_PLAN_DMM = {
  'الصف الأول الابتدائي': 3629,
  'الصف الثاني الابتدائي': 5120,
  'الصف الثالث الابتدائي': 5708,
  'الصف الرابع الابتدائي': 8323,
  'الصف الخامس الابتدائي': 8747,
  'الصف السادس الابتدائي': 8015,
  'الصف الأول المتوسط': 2716
};

async function verifyFinalStats() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Stage 1: Group by clean number
  const grouped = new Map<string, any>();
  trips.forEach(t => {
    const cleanNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
    const key = cleanNum;
    
    const existing = grouped.get(key);
    const statuses = ['planned', 'dispatched', 'executed'];
    const currentPrio = statuses.indexOf(t.status);
    
    if (!existing) {
      grouped.set(key, t);
    } else {
      const existingPrio = statuses.indexOf(existing.status);
      if (currentPrio > existingPrio) {
        grouped.set(key, t);
      } else if (currentPrio === existingPrio) {
         if (new Date(t.date || 0) > new Date(existing.date || 0)) {
           grouped.set(key, t);
         }
      }
    }
  });

  // Stage 2: Handle suffixes
  const finalGrouped = new Map<string, any>();
  const sorted = Array.from(grouped.values()).sort((a, b) => {
    const na = (a.tripNumber || '').replace(/[^a-zA-Z0-9]/g, '').length;
    const nb = (b.tripNumber || '').replace(/[^a-zA-Z0-9]/g, '').length;
    return na - nb;
  });

  sorted.forEach(t => {
    const clean = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
    
    let baseKey = clean;
    for (const existingKey of finalGrouped.keys()) {
        if (clean.startsWith(existingKey) && clean.length <= existingKey.length + 2) {
            baseKey = existingKey;
            break;
        }
    }

    const existing = finalGrouped.get(baseKey);
    if (!existing) {
      finalGrouped.set(baseKey, t);
    } else {
      const statuses = ['planned', 'dispatched', 'executed'];
      const currentPrio = statuses.indexOf(t.status);
      const existingPrio = statuses.indexOf(existing.status);
      if (currentPrio > existingPrio) {
        finalGrouped.set(baseKey, t);
      } else if (currentPrio === existingPrio) {
        if (new Date(t.date || 0) > new Date(existing.date || 0)) {
          finalGrouped.set(baseKey, t);
        }
      }
    }
  });

  const consolidatedTrips = Array.from(finalGrouped.values()).filter(t => t.originCenter === 'DMM');

  const systemStats = new Map<string, number>();
  consolidatedTrips.filter(t => t.status === 'executed' || t.status === 'dispatched').forEach(t => {
    const qtList = t.executedQuantities || t.quantities;
    qtList.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (!type) return;
      const name = type.stageName;
      systemStats.set(name, (systemStats.get(name) || 0) + (q.cartonCount || 0));
    });
  });

  console.log('--- مقارنة نهائية لمركز الدمام (بعد الدمج) ---');
  let totalPlan = 0;
  let totalSystem = 0;
  
  Object.entries(USER_PLAN_DMM).forEach(([stage, planned]) => {
    const executed = systemStats.get(stage) || 0;
    console.log(`${stage.padEnd(20)} | مخطط: ${planned.toString().padEnd(6)} | منفذ: ${executed.toString().padEnd(6)} | الفرق: ${executed - planned}`);
    totalPlan += planned;
    totalSystem += executed;
  });

  console.log('-----------------------------------------------------------');
  console.log(`الإجمالي            | مخطط: ${totalPlan.toString().padEnd(6)} | منفذ: ${totalSystem.toString().padEnd(6)} | الفرق: ${totalSystem - totalPlan}`);

  process.exit(0);
}

verifyFinalStats().catch(console.error);

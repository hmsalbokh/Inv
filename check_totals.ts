import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function calculateTotalShipped() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Consolidated trips logic (exactly as in Dashboard)
  const grouped = new Map<string, any>();
  distributionTrips.forEach(t => {
    const cleanNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
    const key = cleanNum;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, t);
    } else {
      const statusPriority: Record<string, number> = { 'executed': 3, 'dispatched': 2, 'planned': 1 };
      const currentPrio = statusPriority[t.status] || 0;
      const existingPrio = statusPriority[existing.status] || 0;
      if (currentPrio > existingPrio) {
        grouped.set(key, t);
      } else if (currentPrio === existingPrio) {
        const dateCurrent = new Date(t.date || 0).getTime();
        const dateExisting = new Date(existing.date || 0).getTime();
        if (dateCurrent > dateExisting) grouped.set(key, t);
      }
    }
  });

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
      const statusPriority: Record<string, number> = { 'executed': 3, 'dispatched': 2, 'planned': 1 };
      const currentPrio = statusPriority[t.status] || 0;
      const existingPrio = statusPriority[existing.status] || 0;
      if (currentPrio > existingPrio) {
        finalGrouped.set(baseKey, t);
      } else if (currentPrio === existingPrio) {
        const dateCurrent = new Date(t.date || 0).getTime();
        const dateExisting = new Date(existing.date || 0).getTime();
        if (dateCurrent > dateExisting) finalGrouped.set(baseKey, t);
      }
    }
  });

  const consolidatedTripsValue = Array.from(finalGrouped.values());
  const shippedTrips = consolidatedTripsValue.filter(t => (t.status === 'dispatched' || t.status === 'executed') && t.originCenter === 'DMM');

  let bookCartons = 0;
  let emptyCartons = 0;

  shippedTrips.forEach(t => {
    const qtList = t.executedQuantities || t.quantities;
    qtList.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (type) {
        if (type.stageCode.toUpperCase().startsWith('F')) {
          emptyCartons += q.cartonCount;
        } else {
          bookCartons += q.cartonCount;
        }
      }
    });
  });

  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const receivedDmm = records.filter(r => r.destination === 'DMM' && r.status === 'received');
  
  let receivedBookCartons = 0;
  receivedDmm.forEach(r => {
    const type = palletTypes.find(t => t.id === r.palletTypeId);
    if (type && !type.stageCode.toUpperCase().startsWith('F')) {
        let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
        if (r.extraCartons) c += r.extraCartons;
        if (r.missingCartons) c -= r.missingCartons;
        receivedBookCartons += c;
    }
  });

  console.log(`Summary DMM:`);
  console.log(`Received Books: ${receivedBookCartons}`);
  console.log(`Shipped Books: ${bookCartons}`);
  console.log(`Shipped Empty: ${emptyCartons}`);
  console.log(`Total Shipped: ${bookCartons + emptyCartons}`);
  console.log(`Remaining Books (Raw): ${receivedBookCartons - bookCartons}`);
  process.exit(0);
}

calculateTotalShipped().catch(console.error);

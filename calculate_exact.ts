import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function calculateExactBalance(stageName: string, centerCode: string) {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const type = palletTypes.find(t => t.stageName === stageName);
  if (!type) return;

  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const receivedRecords = records.filter(r => r.palletTypeId === type.id && r.destination === centerCode && r.status === 'received');

  let totalReceivedCartons = 0;
  receivedRecords.forEach(r => {
    let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
    if (r.extraCartons) c += r.extraCartons;
    if (r.missingCartons) c -= r.missingCartons;
    if (r.hasDiscrepancy) {
      const sign = r.discrepancyType === 'excess' ? 1 : -1;
      c += sign * (r.discrepancyCartonsQty || 0);
    }
    totalReceivedCartons += c;
  });

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Stage 1: Basic normalization and global grouping by trip number
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

  // Stage 2: Suffix handling
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

  const consolidatedTrips = Array.from(finalGrouped.values());
  const centerExecutedTrips = consolidatedTrips.filter(t => 
    t.originCenter?.trim().toUpperCase() === centerCode.trim().toUpperCase() && 
    t.status !== 'planned'
  );

  let totalShippedCartons = 0;
  centerExecutedTrips.forEach(et => {
    const q = (et.executedQuantities || et.quantities).find((qty: any) => qty.palletTypeId === type.id);
    if (q) totalShippedCartons += q.cartonCount;
  });

  console.log(`Summary for ${stageName}:`);
  console.log(`Total Received Cartons: ${totalReceivedCartons}`);
  console.log(`Total Shipped Cartons (Dispatched/Executed): ${totalShippedCartons}`);
  console.log(`Available Balance: ${totalReceivedCartons - totalShippedCartons}`);
  process.exit(0);
}

calculateExactBalance('الصف الثاني الابتدائي', 'DMM').catch(console.error);

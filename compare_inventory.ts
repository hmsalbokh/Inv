import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function compareInventory() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const recordsSnap = await getDocs(collection(db, 'records'));
  const allRecords = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // 1. Physical Inventory mapping
  const physicalInventory: Record<string, number> = {
    'G01': 640,
    'G02': 970,
    'G03': 912,
    'G04': 1204,
    'G05': 867,
    'G06': 794,
    'G07': 540,
  };

  // 2. System Received (DMM) - Excluding Damaged Pallets from "Available" balance
  const receivedTotals: Record<string, number> = {};
  allRecords.filter(r => r.destination === 'DMM' && r.status === 'received').forEach(r => {
    // If it is damaged, maybe it was excluded from physical inventory?
    const isDamaged = r.condition && r.condition !== 'intact';
    if (isDamaged) return; // Skip damaged for "Available" balance comparison

    const type = palletTypes.find(t => t.id === r.palletTypeId);
    if (type) {
      const code = type.stageCode;
      let count = r.isExtraOnly ? 0 : type.cartonsPerPallet;
      if (r.extraCartons) count += r.extraCartons;
      if (r.missingCartons) count -= r.missingCartons;
      
      receivedTotals[code] = (receivedTotals[code] || 0) + count;
    }
  });

  // 3. System Shipped (DMM) - use consolidation logic
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

  const consolidatedTrips = Array.from(finalGrouped.values());
  const shippedTotals: Record<string, number> = {};
  consolidatedTrips.filter(t => (t.status === 'dispatched' || t.status === 'executed') && t.originCenter === 'DMM').forEach(t => {
    const qtList = t.executedQuantities || t.quantities;
    qtList.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (type) {
        const code = type.stageCode;
        shippedTotals[code] = (shippedTotals[code] || 0) + q.cartonCount;
      }
    });
  });

  // 4. Print Comparison Table
  console.log('Stage Code | Stage Name | System Received | System Shipped | System Balance | Physical Inventory | Gap');
  console.log('-------------------------------------------------------------------------------------------------------');
  
  Object.keys(physicalInventory).forEach(code => {
    const type = palletTypes.find(pt => pt.stageCode === code);
    const name = type ? type.stageName : 'Unknown';
    const received = receivedTotals[code] || 0;
    const shipped = shippedTotals[code] || 0;
    const sysBalance = received - shipped;
    const physical = physicalInventory[code];
    const gap = physical - sysBalance;
    
    console.log(`${code.padEnd(10)} | ${name.padEnd(20)} | ${received.toString().padEnd(15)} | ${shipped.toString().padEnd(14)} | ${sysBalance.toString().padEnd(14)} | ${physical.toString().padEnd(18)} | ${gap}`);
  });

  process.exit(0);
}

compareInventory().catch(console.error);

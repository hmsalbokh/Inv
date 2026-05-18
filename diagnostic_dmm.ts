import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function detailedDiagnostic() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const recordsSnap = await getDocs(collection(db, 'records'));
  const allRecords = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Physical Inventory mapping
  const physicalInventory: Record<string, number> = {
    'G01': 640,
    'G02': 970,
    'G03': 912,
    'G04': 1204,
    'G05': 867,
    'G06': 794,
    'G07': 540,
  };

  // 1. Calculate Received (Total cartons arrived at DMM)
  const receivedByStage: Record<string, number> = {};
  const damageByStage: Record<string, number> = {};
  
  allRecords.filter(r => r.destination === 'DMM' && r.status === 'received').forEach(r => {
    const type = palletTypes.find(t => t.id === r.palletTypeId);
    if (type) {
      const code = type.stageCode;
      let count = r.isExtraOnly ? 0 : type.cartonsPerPallet;
      if (r.extraCartons) count += r.extraCartons;
      if (r.missingCartons) count -= r.missingCartons;
      
      receivedByStage[code] = (receivedByStage[code] || 0) + count;
      
      // Damage tracking
      const dmg = (r.externalDamageQty || 0) + (r.internalDamageQty || 0);
      damageByStage[code] = (damageByStage[code] || 0) + dmg;
    }
  });

  // 2. Consolidate Trips (Use your exact logic from Dashboard)
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

  const consolidatedTripsList = Array.from(finalGrouped.values());

  // 3. Shipped (Executed/Dispatched) and Planned
  const shippedByStage: Record<string, number> = {};
  const plannedByStage: Record<string, number> = {};

  consolidatedTripsList.forEach(t => {
    if (t.originCenter !== 'DMM') return;

    const isShipped = t.status === 'dispatched' || t.status === 'executed';
    const isPlanned = t.status === 'planned';
    
    const qtList = (isShipped && t.executedQuantities) ? t.executedQuantities : t.quantities;
    
    qtList.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (type) {
        const code = type.stageCode;
        if (isShipped) {
            shippedByStage[code] = (shippedByStage[code] || 0) + q.cartonCount;
        } else if (isPlanned) {
            plannedByStage[code] = (plannedByStage[code] || 0) + q.cartonCount;
        }
      }
    });
  });

  // 4. Analysis Output
  console.log('Stage | System Rec | System Ship | Sys Balance | Damage | Physical | Gap to Phys | Gap if Damage Deducted');
  console.log('---------------------------------------------------------------------------------------------------------');
  
  Object.keys(physicalInventory).forEach(code => {
    const physical = physicalInventory[code];
    const rec = receivedByStage[code] || 0;
    const ship = shippedByStage[code] || 0;
    const sysBal = rec - ship;
    const damage = damageByStage[code] || 0;
    const gap = physical - sysBal;
    const gapIfDmgDeducted = physical - (sysBal - damage);
    
    console.log(`${code.padEnd(5)} | ${rec.toString().padEnd(10)} | ${ship.toString().padEnd(11)} | ${sysBal.toString().padEnd(11)} | ${damage.toString().padEnd(6)} | ${physical.toString().padEnd(8)} | ${gap.toString().padEnd(11)} | ${gapIfDmgDeducted}`);
  });

  console.log('\n--- Planned Trips for DMM (Potential "Ghost" Shipments) ---');
  const dmmPlanned = consolidatedTripsList.filter(t => t.status === 'planned' && t.originCenter === 'DMM');
  dmmPlanned.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  dmmPlanned.forEach(t => {
      const qts = t.quantities || [];
      const total = qts.reduce((acc: number, q: any) => acc + q.cartonCount, 0);
      console.log(`Trip: ${t.tripNumber} | Date: ${t.date} | Total Cartons: ${total} | Dest: ${t.destinationCity}`);
  });
  
  process.exit(0);
}

detailedDiagnostic().catch(console.error);

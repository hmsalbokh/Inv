import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspectStage(stageName: string, centerCode: string) {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const type = palletTypes.find(t => t.stageName === stageName);
  
  if (!type) {
    console.log(`Stage ${stageName} not found`);
    return;
  }

  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  
  const received = records.filter(r => r.palletTypeId === type.id && r.destination === centerCode && r.status === 'received');
  
  console.log(`--- [${stageName}] in [${centerCode}] ---`);
  console.log(`Type ID: ${type.id}`);
  console.log(`Cartons Per Pallet: ${type.cartonsPerPallet}`);
  console.log(`Received Pallets Count: ${received.length}`);
  
  let totalReceivedCartons = 0;
  received.forEach(r => {
    let c = r.isExtraOnly ? 0 : (type.cartonsPerPallet || 0);
    if (r.extraCartons) c += r.extraCartons;
    if (r.missingCartons) c -= r.missingCartons;
    if (r.hasDiscrepancy && r.discrepancyType === 'excess') c += (r.discrepancyCartonsQty || 0);
    if (r.hasDiscrepancy && r.discrepancyType === 'shortage') c -= (r.discrepancyCartonsQty || 0);
    totalReceivedCartons += c;
    console.log(` Pallet ${r.palletBarcode}: ${c} cartons (Base: ${r.isExtraOnly ? 0 : type.cartonsPerPallet}, Extra: ${r.extraCartons || 0}, Missing: ${r.missingCartons || 0})`);
  });
  
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  
  const shippedTrips = trips.filter(t => t.originCenter === centerCode && t.status !== 'planned');
  let totalShippedCartons = 0;
  
  console.log(`\nShipped/Dispatched Trips:`);
  shippedTrips.forEach(t => {
    const q = (t.executedQuantities || t.quantities).find((qty: any) => qty.palletTypeId === type.id);
    if (q) {
      totalShippedCartons += q.cartonCount;
      console.log(` Trip ${t.tripNumber}: ${q.cartonCount} cartons (Status: ${t.status})`);
    }
  });

  console.log(`\nSummary:`);
  console.log(`Total Received: ${totalReceivedCartons}`);
  console.log(`Total Shipped: ${totalShippedCartons}`);
  console.log(`System Balance: ${totalReceivedCartons - totalShippedCartons}`);
  
  process.exit(0);
}

inspectStage('الصف الثاني الابتدائي', 'DMM').catch(console.error);

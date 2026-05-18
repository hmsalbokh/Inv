import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkBarcodeDuplicates() {
  const recordsSnap = await getDocs(collection(db, 'records'));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  
  const barcodeMap = new Map<string, any[]>();
  records.forEach(r => {
    if (r.palletBarcode) {
      if (!barcodeMap.has(r.palletBarcode)) barcodeMap.set(r.palletBarcode, []);
      barcodeMap.get(r.palletBarcode)!.push(r);
    }
  });

  console.log('Duplicate Barcodes:');
  let dupsFound = false;
  for (const [code, list] of barcodeMap.entries()) {
    if (list.length > 1) {
      const dmmRecs = list.filter(r => r.destination === 'DMM' && r.status === 'received');
      if (dmmRecs.length > 1) {
          dupsFound = true;
          console.log(`Barcode: ${code} | Count at DMM: ${dmmRecs.length}`);
          dmmRecs.forEach(r => console.log(`  - ID: ${r.id} | Time: ${new Date(r.timestamp).toISOString()}`));
      }
    }
  }
  if (!dupsFound) console.log('None found.');

  process.exit(0);
}

checkBarcodeDuplicates().catch(console.error);

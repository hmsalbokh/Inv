import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkPlanned(stageName: string, centerCode: string) {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  const type = palletTypes.find(t => t.stageName === stageName);
  
  if (!type) return;

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  
  const planned = trips.filter(t => t.originCenter === centerCode && t.status === 'planned');
  let totalPlanned = 0;
  
  console.log(`Planned Trips for ${stageName} in ${centerCode}:`);
  planned.forEach(t => {
    const q = t.quantities.find((qty: any) => qty.palletTypeId === type.id);
    if (q) {
      totalPlanned += q.cartonCount;
      console.log(` Trip ${t.tripNumber}: ${q.cartonCount} cartons`);
    }
  });
  
  console.log(`Total Planned: ${totalPlanned}`);
  process.exit(0);
}

checkPlanned('الصف الثاني الابتدائي', 'DMM').catch(console.error);

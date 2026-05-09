import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkDmm() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const trips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const centers = new Set(trips.map(t => t.originCenter));
  console.log('المراكز الموجودة في النظام:', Array.from(centers));

  const dmmLike = trips.filter(t => t.originCenter && t.originCenter.includes('DMM'));
  console.log('عدد رحلات الدمام وما شابهها:', dmmLike.length);
  
  const dmmGroups = new Map<string, any[]>();
  dmmLike.forEach(t => {
     if (!dmmGroups.has(t.originCenter)) dmmGroups.set(t.originCenter, []);
     dmmGroups.get(t.originCenter)!.push(t);
  });
  
  dmmGroups.forEach((items, center) => {
      console.log(`مركز ${center}: عدد الرحلات ${items.length}`);
  });

  process.exit(0);
}

checkDmm().catch(console.error);

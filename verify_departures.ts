import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const userTrips = [
    ...Array.from({length: 13}, (_, i) => `ZAHS-T${(i+1).toString().padStart(2, '0')}`),
    ...Array.from({length: 21}, (_, i) => `ZASR-T${(i+1).toString().padStart(2, '0')}`),
    ...Array.from({length: 21}, (_, i) => `ZDMM-T${(i+1).toString().padStart(2, '0')}`),
    ...Array.from({length: 7}, (_, i) => `ZHBT-T${(i+1).toString().padStart(2, '0')}`),
    ...Array.from({length: 11}, (_, i) => `ZJOF-T${(i+1).toString().padStart(2, '0')}`),
    ...Array.from({length: 6}, (_, i) => `ZNBR-T${(i+1).toString().padStart(2, '0')}`),
];

async function verifyDepartureList() {
  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const allTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const dmmTrips = allTrips.filter(t => t.originCenter === 'DMM');

  console.log('--- Analysis of User Provided Departed List ---');
  
  let totalBookShippedInSystem = 0;
  let totalBookPlannedInSystem = 0;
  
  const statusMap = new Map<string, string>();
  dmmTrips.forEach(t => {
      const cleanNum = t.tripNumber.toUpperCase().replace(/\s/g, '');
      statusMap.set(cleanNum, t.status);
  });

  const missingFromSystem: string[] = [];
  const stillPlannedInSystem: string[] = [];
  const foundShipped: string[] = [];

  userTrips.forEach(tripNum => {
      const status = statusMap.get(tripNum);
      if (!status) {
          missingFromSystem.push(tripNum);
      } else if (status === 'planned') {
          stillPlannedInSystem.push(tripNum);
      } else {
          foundShipped.push(tripNum);
      }
  });

  console.log(`\nFound in System as Dispatched/Executed: ${foundShipped.length}`);
  console.log(`Found in System but STILL 'Planned' (Should be counted?): ${stillPlannedInSystem.length}`);
  stillPlannedInSystem.forEach(t => {
      const trip = dmmTrips.find(x => x.tripNumber.toUpperCase().replace(/\s/g, '') === t);
      const cartons = (trip?.quantities || []).reduce((acc: number, q: any) => acc + q.cartonCount, 0);
      console.log(`  - ${t} | Cartons: ${cartons}`);
  });

  const dmmShippedInSystem = dmmTrips.filter(t => t.status === 'dispatched' || t.status === 'executed');
  const userTripsSet = new Set(userTrips);
  
  const inSystemButNotInUserList: string[] = [];
  dmmShippedInSystem.forEach(t => {
      const cleanNum = t.tripNumber.toUpperCase().replace(/\s/g, '');
      if (!userTripsSet.has(cleanNum)) {
          inSystemButNotInUserList.push(t.tripNumber);
      }
  });

  console.log(`\nTrips marked as Shipped in System but NOT in User's list: ${inSystemButNotInUserList.length}`);
  inSystemButNotInUserList.forEach(t => console.log(`  - ${t}`));

  process.exit(0);
}

verifyDepartureList().catch(console.error);

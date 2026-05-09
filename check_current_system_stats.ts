import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkStats() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Consolidation Logic
  const grouped = new Map<string, any>();
  distributionTrips.forEach(t => {
    const cleanNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
    const cleanOrigin = (t.originCenter || '').trim().toLowerCase();
    const key = `${cleanNum}_${cleanOrigin}`;
    
    const statuses = ['planned', 'dispatched', 'executed'];
    const currentPrio = statuses.indexOf(t.status);
    
    if (!grouped.has(key)) {
      grouped.set(key, t);
    } else {
      const existing = grouped.get(key)!;
      const existingPrio = statuses.indexOf(existing.status);
      if (currentPrio > existingPrio) {
        grouped.set(key, t);
      } else if (currentPrio === existingPrio) {
        const dateCurrent = new Date(t.date || 0).getTime();
        const dateExisting = new Date(existing.date || 0).getTime();
        if (dateCurrent > dateExisting) {
          grouped.set(key, t);
        }
      }
    }
  });

  const consolidatedTrips = Array.from(grouped.values());

  const stageStats = new Map<string, { planned: number, executed: number }>();

  consolidatedTrips.forEach(t => {
    if (t.originCenter !== 'DMM') return; // تصفية لمركز الدمام فقط كما هو متوقع من سياق الطلب السابق
    const isExecuted = t.status === 'dispatched' || t.status === 'executed';
    const isPlanned = t.status === 'planned';

    t.quantities.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (!type) return;

      const stageName = type.stageName;
      if (!stageStats.has(stageName)) {
        stageStats.set(stageName, { planned: 0, executed: 0 });
      }

      const totalCartons = (q.cartonCount || 0) + (q.bundleCount || 0) / (type.bundlesPerCarton || 1);
      
      if (isExecuted) {
        stageStats.get(stageName)!.executed += totalCartons;
      }
      if (isPlanned) {
        stageStats.get(stageName)!.planned += totalCartons;
      }
    });
  });

  console.log('| المرحلة | المنفذ/المشحن (النظام حالياً) |');
  console.log('| :--- | :--- |');
  let totalExecuted = 0;
  
  // Sort stages to match user order if possible or just alphabetic
  const sortedStages = Array.from(stageStats.keys()).sort();

  stageStats.forEach((val, name) => {
    console.log(`| ${name} | ${val.executed.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} |`);
    totalExecuted += val.executed;
  });

  console.log(`\nإجمالي المنفذ في النظام: ${totalExecuted.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);

  process.exit(0);
}

checkStats().catch(console.error);

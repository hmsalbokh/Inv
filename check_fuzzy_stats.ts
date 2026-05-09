import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkFuzzyStats() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Fuzzy Consolidation Logic
  // 1. Clean and normalize
  const normalized = distributionTrips.map(t => ({
    ...t,
    clean: (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase()
  })).sort((a, b) => a.clean.length - b.clean.length);

  const grouped = new Map<string, any>();
  
  // Logic: If Trip B "contains/starts with" Trip A and they have same center/destination/date, they might be the same.
  // Actually, let's stick to the user's hint: Same base number with a suffix.
  
  normalized.forEach(t => {
     const key = `${t.clean}_${t.originCenter?.toLowerCase()}`;
     
     // Find if we already have a "Base" trip that this one replaces, or if this one is a more complete version.
     // For now, let's just try to group by the FIRST 7 characters if they look like a standard code? ZDMM-T01
     // Or just group by cleaned number.
     
     // If we use the EXISTING logic but with a "Prefix" search:
     let matchedKey = Array.from(grouped.keys()).find(k => {
         const [existingClean, existingCenter] = k.split('_');
         if (existingCenter !== t.originCenter?.toLowerCase()) return false;
         
         // If one starts with the other
         return t.clean.startsWith(existingClean) || existingClean.startsWith(t.clean);
     });
     
     const currentKey = matchedKey || key;
     
     if (!grouped.has(currentKey)) {
       grouped.set(currentKey, t);
     } else {
       const existing = grouped.get(currentKey)!;
       const statuses = ['planned', 'dispatched', 'executed'];
       const currentPrio = statuses.indexOf(t.status);
       const existingPrio = statuses.indexOf(existing.status);
       
       if (currentPrio > existingPrio) {
         grouped.set(currentKey, t);
       } else if (currentPrio === existingPrio) {
         // Same status, take longest number or newest date?
         // Longest number often means "more detailed" (like -A)
         if (t.clean.length > existing.clean.length) {
            grouped.set(currentKey, t);
         } else {
            const dateCurrent = new Date(t.date || 0).getTime();
            const dateExisting = new Date(existing.date || 0).getTime();
            if (dateCurrent > dateExisting) {
              grouped.set(currentKey, t);
            }
         }
       }
     }
  });

  const consolidatedTrips = Array.from(grouped.values());

  const stageTotals = new Map<string, number>();
  consolidatedTrips.filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched')).forEach(t => {
    (t.executedQuantities || t.quantities).forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (!type) return;
      const name = type.stageName;
      stageTotals.set(name, (stageTotals.get(name) || 0) + (q.cartonCount || 0));
    });
  });

  const targetStages = [
    'الصف الأول الابتدائي', 'الصف الثاني الابتدائي', 'الصف الثالث الابتدائي',
    'الصف الرابع الابتدائي', 'الصف الخامس الابتدائي', 'الصف السادس الابتدائي',
    'الصف الأول المتوسط'
  ];

  console.log('| المرحلة | المنفذ ( fuzzy merged ) |');
  console.log('| :--- | :--- |');
  let total = 0;
  targetStages.forEach(name => {
      const val = stageTotals.get(name) || 0;
      console.log(`| ${name} | ${val} |`);
      total += val;
  });
  console.log(`\nإجمالي الـ 7 مراحل (Fuzzy): ${total}`);

  process.exit(0);
}

checkFuzzyStats().catch(console.error);

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';
import * as XLSX from 'xlsx';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const USER_PLAN = {
  'الصف الأول الابتدائي': 3629,
  'الصف الثاني الابتدائي': 5120,
  'الصف الثالث الابتدائي': 5708,
  'الصف الرابع الابتدائي': 8323,
  'الصف الخامس الابتدائي': 8747,
  'الصف السادس الابتدائي': 8015,
  'الصف الأول المتوسط': 2716
};

async function generateComparisonExcel() {
  const typesSnap = await getDocs(collection(db, 'palletTypes'));
  const palletTypes = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  const tripsSnap = await getDocs(collection(db, 'distributionTrips'));
  const distributionTrips = tripsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

  // Consolidation Logic (Same as Dashboard)
  const grouped = new Map<string, any>();
  distributionTrips.forEach(t => {
    const cleanNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
    const key = cleanNum; // Global dedupe for this report context
    
    const existing = grouped.get(key);
    const statuses = ['planned', 'dispatched', 'executed'];
    const currentPrio = statuses.indexOf(t.status);
    
    if (!existing) {
      grouped.set(key, t);
    } else {
      const existingPrio = statuses.indexOf(existing.status);
      if (currentPrio > existingPrio) {
        grouped.set(key, t);
      } else if (currentPrio === existingPrio) {
         if (new Date(t.date || 0) > new Date(existing.date || 0)) {
           grouped.set(key, t);
         }
      }
    }
  });

  const consolidatedTrips = Array.from(grouped.values()).filter(t => t.originCenter === 'DMM');

  const systemStats = new Map<string, number>();
  consolidatedTrips.filter(t => t.status === 'executed' || t.status === 'dispatched').forEach(t => {
    t.quantities.forEach((q: any) => {
      const type = palletTypes.find(pt => pt.id === q.palletTypeId);
      if (!type) return;
      const name = type.stageName;
      systemStats.set(name, (systemStats.get(name) || 0) + (q.cartonCount || 0));
    });
  });

  const reportData = Object.entries(USER_PLAN).map(([stage, planned]) => {
    const executed = systemStats.get(stage) || 0;
    return {
      'المرحلة': stage,
      'المخطط (تخطيطك)': planned,
      'المنفذ (النظام حالياً)': executed,
      'الزيادة (كرتون)': executed - planned
    };
  });

  // Calculate Totals row
  const totals = reportData.reduce((acc, row) => {
    acc.planned += row['المخطط (تخطيطك)'];
    acc.executed += row['المنفذ (النظام حالياً)'];
    acc.diff += row['الزيادة (كرتون)'];
    return acc;
  }, { planned: 0, executed: 0, diff: 0 });

  reportData.push({
    'المرحلة': 'الإجمالي',
    'المخطط (تخطيطك)': totals.planned,
    'المنفذ (النظام حالياً)': totals.executed,
    'الزيادة (كرتون)': totals.diff
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(reportData);
  XLSX.utils.book_append_sheet(wb, ws, 'مقارنة البيانات');
  
  const fileName = 'Comparison_Report_DMM.xlsx';
  XLSX.writeFile(wb, `./public/${fileName}`);
  
  console.log(`Generated: ${fileName}`);
  process.exit(0);
}

generateComparisonExcel().catch(console.error);

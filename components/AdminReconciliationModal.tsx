import React, { useState, useMemo } from 'react';
import { DistributionTrip, PalletType, InventoryRecord } from '../types';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../firebase';

interface AdminReconciliationModalProps {
  onClose: () => void;
  onNotify: (title: string, message: string) => void;
  palletTypes: PalletType[];
  trips: DistributionTrip[];
  records: InventoryRecord[];
  centerOps: { code: string; name: string }[];
}

export default function AdminReconciliationModal({
  onClose,
  onNotify,
  palletTypes,
  trips,
  records,
  centerOps
}: AdminReconciliationModalProps) {
  const [selectedCenter, setSelectedCenter] = useState<string>('DMM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, string>>({});

  // Calculations for current selected center
  const centerStats = useMemo(() => {
    const centerTrips = trips.filter(t => t.originCenter === selectedCenter);
    const centerRecords = records.filter(r => r.destination === selectedCenter && r.status === 'received');
    
    return palletTypes.map(pt => {
      // Received
      let receivedCartons = 0;
      let damageCartons = 0;
      
      const typeRecords = centerRecords.filter(r => r.palletTypeId === pt.id);
      typeRecords.forEach(r => {
        let cnt = r.isExtraOnly ? 0 : pt.cartonsPerPallet;
        if (r.extraCartons) cnt += r.extraCartons;
        if (r.missingCartons) cnt -= r.missingCartons;
        if (r.hasDiscrepancy) {
            const sign = r.discrepancyType === 'excess' ? 1 : -1;
            cnt += sign * (r.discrepancyCartonsQty || 0);
        }
        receivedCartons += cnt;
        
        if (r.condition && r.condition !== 'intact') {
            const damaged = ['torn', 'water', 'crushed'];
            const labels = [];
            for (const d of damaged) if ((r as any)[d + 'Damage']) labels.push((r as any)[d + 'Damage']);
            const damageStr = labels.join(', ').toLowerCase();
            const sum = (damageStr.match(/\d+/g) || []).reduce((a, b) => a + parseInt(b, 10), 0);
            if (sum > 0) damageCartons += sum;
        }
      });
      
      // Shipped
      let shippedCartons = 0;
      const shippedTrips = centerTrips.filter(t => t.status === 'dispatched' || t.status === 'executed');
      shippedTrips.forEach(t => {
          (t.executedQuantities || t.quantities || []).forEach(q => {
              if (q.palletTypeId === pt.id) shippedCartons += (q.cartonCount || 0);
          });
      });
      
      const systemAvail = receivedCartons - shippedCartons - damageCartons;
      const physValue = parseInt(physicalCounts[pt.id] || '0', 10);
      const gap = systemAvail - physValue; // Positive gap means system has more than physical = missing physical (needs negative adj)

      return {
        type: pt,
        receivedCartons,
        shippedCartons,
        damageCartons,
        systemAvail,
        gap
      };
    });
  }, [selectedCenter, physicalCounts, palletTypes, trips, records]);

  const handleReconcile = async () => {
    if (!confirm('سيتم إنشاء قيود تسوية لتعديل المخزون النظامي ليطابق الجرد الفعلي. هل أنت متأكد؟')) return;
    
    setIsSubmitting(true);
    try {
      let adjustmentsMade = 0;
      for (const stat of centerStats) {
        if (stat.gap !== 0) {
          // If systemAvail is 100, and phys is 90, gap is +10. We need to deduct 10 from system.
          // Adjustments are implemented via discrepancy records or standalone adjustments.
          // For now, let's create a specialized 'records' entry that acts as an adjustment.
          const isExcess = stat.gap < 0; // If gap is negative, physical is greater than system
          const diff = Math.abs(stat.gap);
          
          await addDoc(collection(db, 'records'), {
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            destination: selectedCenter,
            palletTypeId: stat.type.id,
            status: 'received',
            condition: 'intact',
            hasDiscrepancy: true,
            discrepancyType: isExcess ? 'excess' : 'shortage',
            discrepancyCartonsQty: diff,
            isExtraOnly: true, // Mark it so it doesn't add base pallet cartons
            timestamp: new Date().toISOString(),
            notes: 'تسوية الجرد الفعلي من قبل مسؤول النظام'
          });
          adjustmentsMade++;
        }
      }
      
      onNotify('نجاح', `تم عمل ${adjustmentsMade} قيود تسوية بنجاح.`);
      onClose();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'records');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-100 animate-slideUp">
        <div className="bg-slate-50 p-6 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center text-2xl shadow-inner">
              ⚖️
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800">أداة تسوية الجرد (للمسؤول فقط)</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">تعديل المخزون النظامي ليطابق الجرد الفعلي لمنع الفجوات</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors shadow-sm active:scale-90 border border-slate-100">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
           <div className="mb-6 flex items-center gap-4">
              <label className="text-sm font-black text-slate-700">اختر المركز:</label>
              <select 
                value={selectedCenter} 
                onChange={(e) => { setSelectedCenter(e.target.value); setPhysicalCounts({}); }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:border-indigo-500"
              >
                {centerOps.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
           </div>
           
           <div className="bg-white border text-center border-slate-200 rounded-2xl shadow-sm overflow-hidden">
               <table className="w-full text-right" dir="rtl">
                   <thead className="bg-slate-100 sticky top-0 shadow-sm border-b border-slate-200 z-10">
                       <tr>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">المرحلة</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">الوارد</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">الصادر</th>
                           <th className="px-4 py-3 text-xs font-black text-rose-600 text-center">التالف</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-800">الرصيد النظامي</th>
                           <th className="px-4 py-3 text-xs font-black text-indigo-700">الجرد الفعلي</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">الفجوة (التسوية)</th>
                       </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                       {centerStats.filter(s => !s.type.stageCode.toUpperCase().startsWith('F')).map(stat => (
                           <tr key={stat.type.id} className="hover:bg-slate-50 transition-colors">
                               <td className="px-4 py-3 font-bold text-slate-800 text-sm">{stat.type.stageDetails} ({stat.type.stageCode})</td>
                               <td className="px-4 py-3 font-medium text-emerald-600">{stat.receivedCartons.toLocaleString()}</td>
                               <td className="px-4 py-3 font-medium text-amber-600">{stat.shippedCartons.toLocaleString()}</td>
                               <td className="px-4 py-3 font-medium text-rose-600 text-center relative max-w-[80px]">
                                 {stat.damageCartons}
                               </td>
                               <td className="px-4 py-3 font-black text-slate-900 border-x border-slate-100 bg-slate-50">{stat.systemAvail.toLocaleString()}</td>
                               <td className="px-4 py-3">
                                   <input
                                      type="number"
                                      min="0"
                                      className="w-24 px-3 py-1.5 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 font-bold text-center bg-indigo-50 text-indigo-900"
                                      placeholder="0"
                                      value={physicalCounts[stat.type.id] !== undefined ? physicalCounts[stat.type.id] : ''}
                                      onChange={(e) => setPhysicalCounts({...physicalCounts, [stat.type.id]: e.target.value})}
                                   />
                               </td>
                               <td className="px-4 py-3 font-black text-left" dir="ltr">
                                  {stat.gap !== 0 ? (
                                    <span className={stat.gap > 0 ? "text-rose-600" : "text-emerald-600"}>
                                       {stat.gap > 0 ? "-" : "+"}{Math.abs(stat.gap)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">0</span>
                                  )}
                               </td>
                           </tr>
                       ))}
                   </tbody>
               </table>
           </div>
           <p className="text-[10px] text-slate-500 mt-4 leading-relaxed bg-amber-50 p-3 rounded-xl border border-amber-100">
              <strong className="text-amber-800 block mb-1">ملاحظة هامة للمسؤول:</strong>
              الفجوة = الرصيد النظامي المتاح (الذي تم حسابه بناءً على الوارد خصماً منه الصادر والتالف) مطروحاً منه ما تم جرده فعلياً. 
              إذا كان هناك قيمة إيجابية في الفجوة، فسيقوم النظام بإضافة تسوية "عجز" (Shortage) لتخفيض المخزون.
              إذا كانت هناك قيمة سلبية في الفجوة، فسيضيف النظام "زيادة" (Excess) لرفع المخزون.
           </p>
        </div>

        <div className="bg-slate-50 p-6 flex justify-end gap-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-black text-xs text-slate-600 hover:bg-slate-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleReconcile}
            disabled={isSubmitting || Object.keys(physicalCounts).length === 0}
            className="px-8 py-2.5 rounded-xl font-black text-xs bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'جاري التسوية...' : '✅ اعتماد التعديلات وحل الفجوات'}
          </button>
        </div>
      </div>
    </div>
  );
}

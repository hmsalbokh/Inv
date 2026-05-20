import React, { useState, useMemo } from 'react';
import { DistributionTrip, PalletType, InventoryRecord } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ConfirmModal } from './ConfirmModal';

interface AdminReconciliationModalProps {
  onClose: () => void;
  onNotify: (title: string, message: string) => void;
  palletTypes: PalletType[];
  trips: DistributionTrip[];
  records: InventoryRecord[];
  centerOps: { code: string; name?: string; displayName?: string }[];
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
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, { cartons: string; bundles: string }>>({});

  // Calculations for current selected center
  const centerStats = useMemo(() => {
    const centerTrips = trips.filter(t => t.originCenter?.trim().toUpperCase() === selectedCenter.trim().toUpperCase());
    const centerRecords = records.filter(r => {
      let target = (r.receivedByCenter || (r.status === 'received' && r.isWrongDestination ? 'WRONG_DEST' : r.destination)).trim().toUpperCase();
      // Hard fix for the 23 pallets that Dammam center didn't receive
      const DAMMAM_MISDIRECTED_BARCODES = [
        'G01YOM1177316', 'G01YOM1177416', 'G01YOM1177516', 'G01YOM1177616', 'G01YOM1177716',
        'G02YOM1177816', 'G02YOM1177916', 'G02YOM1178016',
        'G03YOM1178116',
        'G05YOM1178216', 'G05YOM1178316', 'G05YOM1178416', 'G05YOM1178516', 'G05YOM1178616', 'G05YOM1178716', 'G05YOM1178816',
        'G06YOM1178916', 'G06YOM1179016', 'G06YOM1179116', 'G06YOM1179216',
        'G07YOM1179316', 'G07YOM1179416', 'G07YOM1179516'
      ];
      if ((target === 'DAMMAM' || target === 'DMM') && DAMMAM_MISDIRECTED_BARCODES.includes(r.palletBarcode.trim().toUpperCase())) {
        target = 'WRONG_DEST';
      }
      return target === selectedCenter.trim().toUpperCase() && r.status === 'received';
    });
    
    return palletTypes.filter(t => !t.stageCode.toUpperCase().startsWith('F')).map(pt => {
      // Received Bundles (Source of truth for precision)
      let receivedBundles = 0;
      
      const typeRecords = centerRecords.filter(r => r.palletTypeId === pt.id);
      typeRecords.forEach(r => {
        let b = (r.isExtraOnly ? 0 : pt.cartonsPerPallet) * pt.bundlesPerCarton;
        if (r.extraCartons) b += r.extraCartons * pt.bundlesPerCarton;
        if (r.missingCartons) b -= r.missingCartons * pt.bundlesPerCarton;
        if (r.hasDiscrepancy) {
            const sign = r.discrepancyType === 'excess' ? 1 : -1;
            b += sign * ((r.discrepancyCartonsQty || 0) * pt.bundlesPerCarton + (r.discrepancyBundlesQty || 0));
        }
        receivedBundles += b;
      });

      const receivedCartonsValue = receivedBundles / (pt.bundlesPerCarton || 1);
      
      // Shipped (Executed + Dispatched - these are physically out of warehouse)
      let executedOutboundBundles = 0;
      const shippedTrips = centerTrips.filter(t => t.status === 'executed' || t.status === 'dispatched');
      shippedTrips.forEach(t => {
          (t.executedQuantities || t.quantities || []).forEach(q => {
              if (q.palletTypeId === pt.id) {
                executedOutboundBundles += (q.bundleCount || 0);
              }
          });
      });

      // Planned (Committed - items still in warehouse but dedicated to a trip)
      let plannedOutboundBundles = 0;
      const plannedTrips = centerTrips.filter(t => t.status === 'planned');
      plannedTrips.forEach(t => {
          t.quantities.forEach(q => {
              if (q.palletTypeId === pt.id) {
                plannedOutboundBundles += (q.bundleCount || 0);
              }
          });
      });
      
      const warehouseBundles = receivedBundles - executedOutboundBundles;
      const committedBundles = plannedOutboundBundles;
      const freeBundles = warehouseBundles - committedBundles;

      const warehouseBalance = warehouseBundles / (pt.bundlesPerCarton || 1);
      const committedCartons = committedBundles / (pt.bundlesPerCarton || 1);
      const currentFreeBalance = freeBundles / (pt.bundlesPerCarton || 1);

      const phys = physicalCounts[pt.id] || { cartons: '', bundles: '' };
      const physCartons = phys.cartons === '' ? currentFreeBalance : parseInt(phys.cartons || '0', 10);
      const physBundles = phys.bundles === '' ? 0 : parseInt(phys.bundles || '0', 10);
      
      // Target warehouse balance = Target Free Balance + committed
      const targetFreeBundles = (physCartons * pt.bundlesPerCarton) + physBundles;
      const targetWarehouseBundles = targetFreeBundles + committedBundles;
      const gapBundles = warehouseBundles - targetWarehouseBundles;
      const gapCartons = gapBundles / (pt.bundlesPerCarton || 1);

      return {
        type: pt,
        receivedCartons: receivedCartonsValue,
        executedOutbound: executedOutboundBundles / (pt.bundlesPerCarton || 1),
        committedCartons,
        warehouseBalance,
        currentFreeBalance,
        physCartons: phys.cartons,
        physBundles: phys.bundles,
        totalPhysCartons: targetFreeBundles / (pt.bundlesPerCarton || 1),
        gap: gapCartons,
        gapBundles: gapBundles
      };
    });
  }, [selectedCenter, physicalCounts, palletTypes, trips, records]);

  const [showConfirm, setShowConfirm] = useState(false);

  const requestReconcile = () => {
    const adjustments = centerStats.filter(s => s.gap !== 0);
    if (adjustments.length === 0) {
      onNotify('تنبيه', 'لم يتم رصد أي فوارق بين الجرد الفعلي والرصيد النظامي ليتم تسويتها. يرجى التأكد من إدخال قيم تختلف عن الرصيد النظامي لعمل تسوية.');
      return;
    }
    setShowConfirm(true);
  };

  const handleReconcile = async () => {
    setShowConfirm(false);
    setIsSubmitting(true);
    try {
      let adjustmentsMade = 0;
      for (const stat of centerStats) {
        if (stat.gap !== 0) {
          const isExcess = stat.gap < 0; 
          const diffBundlesTotal = Math.abs(stat.gapBundles);
          
          const diffCartons = Math.floor(diffBundlesTotal / stat.type.bundlesPerCarton);
          const diffBundles = Math.round(diffBundlesTotal % stat.type.bundlesPerCarton);
          
          await addDoc(collection(db, 'records'), {
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            destination: selectedCenter,
            receivedByCenter: selectedCenter,
            palletBarcode: `ADJ-${selectedCenter}-${stat.type.stageCode}-${Date.now()}`,
            palletTypeId: stat.type.id,
            status: 'received',
            condition: 'intact',
            hasDiscrepancy: true,
            discrepancyType: isExcess ? 'excess' : 'shortage',
            discrepancyCartonsQty: diffCartons,
            discrepancyBundlesQty: diffBundles,
            isExtraOnly: true, 
            timestamp: Date.now(),
            notes: 'تسوية الجرد الفعلي من قبل مسؤول النظام'
          });
          adjustmentsMade++;
        }
      }
      
      onNotify('نجاح', `تم عمل ${adjustmentsMade} قيود تسوية بنجاح لمطابقة الجرد الفعلي.`);
      onClose();
    } catch (e: any) {
      console.error(e);
      onNotify('خطأ في الاتصال', 'تعذر حفظ التسويات في الوقت الحالي. يرجى التأكد من استقرار الإنترنت والمحاولة مرة أخرى.');
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
           <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <label className="text-sm font-black text-black">اختر المركز:</label>
                <select 
                  value={selectedCenter} 
                  onChange={(e) => { setSelectedCenter(e.target.value); setPhysicalCounts({}); }}
                  className="bg-white border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-black focus:outline-none focus:border-indigo-600 shadow-sm"
                >
                  {centerOps.map(c => (
                    <option key={c.code} value={c.code} className="text-black bg-white">
                      {c.displayName || c.name || c.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                 <button 
                   onClick={() => {
                     const newCounts: Record<string, { cartons: string; bundles: string }> = {};
                     centerStats.forEach(s => {
                       newCounts[s.type.id] = { cartons: Math.floor(s.currentFreeBalance).toString(), bundles: '0' };
                     });
                     setPhysicalCounts(newCounts);
                   }}
                   className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black border border-emerald-100 hover:bg-emerald-100 transition-all"
                 >
                   🔄 ملء بالرصيد الحالي
                 </button>
                 <button 
                   onClick={() => setPhysicalCounts({})}
                   className="px-4 py-2 bg-slate-50 text-slate-500 rounded-xl text-[10px] font-black border border-slate-200 hover:bg-slate-100 transition-all"
                 >
                   🧹 مسح الكل
                 </button>
              </div>
           </div>
           
           <div className="bg-white border text-center border-slate-200 rounded-2xl shadow-sm overflow-hidden">
               <table className="w-full text-right" dir="rtl">
                   <thead className="bg-slate-100 sticky top-0 shadow-sm border-b border-slate-200 z-10">
                       <tr>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">المرحلة</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">رصيد المستودع (نظامي)</th>
                           <th className="px-4 py-3 text-xs font-black text-amber-600">رحلات مخططة (محجوز)</th>
                            <th className="px-4 py-3 text-xs font-black text-indigo-700 bg-indigo-50/50">الرصيد الحر الحالي</th>
                           <th className="px-4 py-3 text-xs font-black text-indigo-900 border-x border-indigo-100 text-center bg-indigo-100/30">الرصيد الحر المطلوب</th>
                           <th className="px-4 py-3 text-xs font-black text-slate-600">قيمة التسوية</th>
                       </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                       {centerStats.filter(s => !s.type.stageCode.toUpperCase().startsWith('F')).map(stat => (
                           <tr key={stat.type.id} className="hover:bg-slate-50 transition-colors">
                               <td className="px-4 py-3 font-bold text-slate-800 text-sm">{stat.type.stageName} ({stat.type.stageCode})</td>
                               <td className="px-4 py-3 font-medium text-slate-500">{stat.warehouseBalance.toLocaleString()}</td>
                               <td className="px-4 py-3 font-medium text-amber-600">
                                  {stat.committedCartons > 0 ? (
                                    <span className="bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">-{stat.committedCartons.toLocaleString()}</span>
                                  ) : '0'}
                               </td>
                               <td className="px-4 py-3 font-black text-indigo-700 bg-indigo-50/50">
                                  <div className="flex flex-col items-center">
                                    <span>{Math.floor(stat.currentFreeBalance).toLocaleString()} كرتون</span>
                                    {Math.round((stat.currentFreeBalance - Math.floor(stat.currentFreeBalance)) * stat.type.bundlesPerCarton) > 0 && (
                                      <span className="text-[9px] text-indigo-400">
                                        + {Math.round((stat.currentFreeBalance - Math.floor(stat.currentFreeBalance)) * stat.type.bundlesPerCarton)} حزمة
                                      </span>
                                    )}
                                  </div>
                               </td>
                               <td className="px-4 py-3">
                                  <div className="flex items-center gap-2 justify-center">
                                      <div className="flex flex-col items-center">
                                         <label className="text-[8px] font-black text-indigo-400 mb-1">كرتون</label>
                                         <input
                                           type="number"
                                           min="0"
                                           className="w-20 px-2 py-1.5 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 font-bold text-center bg-indigo-50 text-indigo-900 text-xs shadow-inner"
                                           placeholder={Math.floor(stat.currentFreeBalance).toString()}
                                           value={stat.physCartons}
                                           onChange={(e) => setPhysicalCounts({
                                             ...physicalCounts, 
                                             [stat.type.id]: { ...(physicalCounts[stat.type.id] || { cartons: '', bundles: '0' }), cartons: e.target.value }
                                           })}
                                         />
                                      </div>
                                      <div className="text-indigo-300 font-black mt-3">+</div>
                                      <div className="flex flex-col items-center">
                                         <label className="text-[8px] font-black text-indigo-400 mb-1">حزمة</label>
                                         <input
                                           type="number"
                                           min="0"
                                           className="w-16 px-2 py-1.5 border border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 font-bold text-center bg-indigo-50 text-indigo-900 text-xs shadow-inner"
                                           placeholder="0"
                                           value={stat.physBundles}
                                           onChange={(e) => setPhysicalCounts({
                                             ...physicalCounts, 
                                             [stat.type.id]: { ...(physicalCounts[stat.type.id] || { cartons: '', bundles: '' }), bundles: e.target.value }
                                           })}
                                         />
                                      </div>
                                  </div>
                               </td>
                               <td className="px-4 py-3 font-black text-left" dir="ltr">
                                  {stat.gap !== 0 ? (
                                    <div className="flex flex-col items-end">
                                       <span className={stat.gap > 0 ? "text-rose-600" : "text-emerald-600"}>
                                          {stat.gap > 0 ? "-" : "+"}{Math.abs(stat.gap).toFixed(2)} كرتون
                                       </span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">بلا تغيير</span>
                                  )}
                               </td>
                           </tr>
                       ))}
                   </tbody>
               </table>
           </div>
           <div className="mt-6 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/30">
              <h4 className="text-xs font-black text-indigo-900 mb-2 flex items-center gap-2">
                💡 كيف تعمل هذه الأداة؟
              </h4>
              <p className="text-[10px] text-indigo-700 leading-relaxed">
                أدخل في خانة <strong>"الرصيد الحر المطلوب"</strong> الرقم الذي تريد أن تراه متاحاً للصرف في المركز. 
                النظام سيقوم أوتوماتيكياً بحساب "الرحلات المخططة" وإضافة/خصم الكمية المطلوبة من رصيد المخزون لضمان النتيجة التي تريدها تماماً.
              </p>
           </div>
        </div>

        <div className="bg-slate-50 p-6 flex justify-end gap-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-black text-xs text-slate-600 hover:bg-slate-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={requestReconcile}
            disabled={isSubmitting || Object.keys(physicalCounts).length === 0}
            className="px-8 py-2.5 rounded-xl font-black text-xs bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'جاري التسوية...' : '✅ اعتماد التعديلات وحل الفجوات'}
          </button>
        </div>

        <ConfirmModal
          isOpen={showConfirm}
          title="تأكيد عملية التسوية"
          message="سيتم إنشاء قيود تسوية لتعديل المخزون النظامي ليطابق الجرد الفعلي الذي أدخلته. هل أنت متأكد من المتابعة؟"
          onConfirm={handleReconcile}
          onCancel={() => setShowConfirm(false)}
          confirmText="نعم، اعتمد التعديلات"
          cancelText="تراجع"
        />
      </div>
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import { PalletType, InventoryRecord, DistributionTrip, CenterCode, UserCredentials } from '../types';

interface ReconciliationComparisonProps {
  palletTypes: PalletType[];
  records: InventoryRecord[];
  distributionTrips: DistributionTrip[];
  users: UserCredentials[];
  onClose: () => void;
}

export default function ReconciliationComparison({
  palletTypes,
  records,
  distributionTrips,
  users,
  onClose
}: ReconciliationComparisonProps) {
  const [selectedCenter, setSelectedCenter] = useState<string>('RYD');

  const centers = useMemo(() => {
    const seen = new Set<string>();
    return users.filter(u => {
      if (u.role !== 'center') return false;
      if (seen.has(u.code)) return false;
      seen.add(u.code);
      return true;
    });
  }, [users]);

  const stats = useMemo(() => {
    const centerRecords = records.filter(r => {
      const target = (r.receivedByCenter || (r.status === 'received' && r.isWrongDestination ? 'WRONG_DEST' : r.destination)).trim().toUpperCase();
      return target === selectedCenter.trim().toUpperCase() && r.status === 'received';
    });

    const centerTrips = distributionTrips.filter(t => t.originCenter?.trim().toUpperCase() === selectedCenter.trim().toUpperCase());

    return palletTypes.map(pt => {
      // 1. Received (Includes everything received in database)
      let receivedCartons = 0;
      let adjustmentsTotal = 0;

      const typeRecords = centerRecords.filter(r => r.palletTypeId === pt.id);
      typeRecords.forEach(r => {
        let baseCount = r.isExtraOnly ? 0 : pt.cartonsPerPallet;
        let diffCount = 0;
        
        if (r.extraCartons) diffCount += r.extraCartons;
        if (r.missingCartons) diffCount -= r.missingCartons;
        
        if (r.hasDiscrepancy) {
          const sign = r.discrepancyType === 'excess' ? 1 : -1;
          const val = r.discrepancyCartonsQty || 0;
          diffCount += sign * val;
          
          // Check if this is an adjustment from the tool
          if (r.notes?.includes('تسوية الجرد الفعلي')) {
            adjustmentsTotal += sign * val;
          }
        }
        
        receivedCartons += (baseCount + diffCount);
      });

      // 2. Executed Outbound
      let executedCartons = 0;
      const executedTrips = centerTrips.filter(t => t.status === 'executed');
      executedTrips.forEach(t => {
        const qList = t.executedQuantities || t.quantities || [];
        const item = qList.find(q => q.palletTypeId === pt.id);
        if (item) executedCartons += item.cartonCount;
      });

      // 3. Planned Outbound (Planned or Dispatched but not yet Executed)
      let plannedCartons = 0;
      const plannedTrips = centerTrips.filter(t => t.status === 'planned' || t.status === 'dispatched');
      plannedTrips.forEach(t => {
        const item = t.quantities.find(q => q.palletTypeId === pt.id);
        if (item) plannedCartons += item.cartonCount;
      });

      const remainingBalance = receivedCartons - executedCartons;
      const freeBalance = receivedCartons - (executedCartons + plannedCartons);

      return {
        pt,
        receivedCartons,
        adjustmentsTotal,
        executedCartons,
        plannedCartons,
        remainingBalance,
        freeBalance
      };
    });
  }, [selectedCenter, records, distributionTrips, palletTypes]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fadeIn">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-100 animate-slideUp">
        <div className="bg-slate-50 p-6 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-2xl shadow-inner">
              📊
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800">مقارنة نتائج التسوية والأرصدة</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">عرض تفصيلي للمخزون الحر والمتبقي مقارنة بالتسويات لكل مرحلة</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors shadow-sm active:scale-90 border border-slate-100">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">
            <div className="flex items-center gap-4">
              <label className="text-sm font-black text-indigo-900">اختر المركز للمقارنة:</label>
              <select 
                value={selectedCenter} 
                onChange={(e) => setSelectedCenter(e.target.value)}
                className="bg-white border-2 border-indigo-200 rounded-xl px-4 py-2 text-sm font-black text-indigo-900 focus:outline-none focus:border-indigo-600 shadow-sm transition-all"
              >
                {centers.map(c => (
                  <option key={c.code} value={c.code}>
                    {c.displayName || c.locationName || c.code}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex gap-4">
               <div className="px-4 py-2 bg-white rounded-xl border border-indigo-100 shadow-sm flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400">إجمالي الرصيد المتبقي</span>
                  <span className="text-sm font-black text-indigo-600">{stats.reduce((acc, s) => acc + s.remainingBalance, 0).toLocaleString()} كرتون</span>
               </div>
               <div className="px-4 py-2 bg-white rounded-xl border border-emerald-100 shadow-sm flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400">إجمالي الرصيد الحر</span>
                  <span className="text-sm font-black text-emerald-600">{stats.reduce((acc, s) => acc + s.freeBalance, 0).toLocaleString()} كرتون</span>
               </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-3xl border border-slate-200 shadow-sm">
            <table className="w-full text-right" dir="rtl">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-slate-500 w-1/4">المرحلة التعليمية</th>
                  <th className="px-6 py-4 text-xs font-black text-indigo-600 text-center">نتائج أداة التسوية</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-800 text-center">الرصيد المتبقي (المستودع)</th>
                  <th className="px-6 py-4 text-xs font-black text-emerald-600 text-center">الرصيد الحر المتبقي</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400 text-center">المخطط صرفه</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.filter(s => !s.pt.stageCode.toUpperCase().startsWith('F')).map((row) => (
                  <tr key={row.pt.id} className="hover:bg-indigo-50/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-800 group-hover:text-indigo-900 transition-colors">{row.pt.stageName}</span>
                        <span className="text-[10px] font-bold text-slate-400">{row.pt.stageCode}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                       <span className={`px-3 py-1 rounded-full text-xs font-black ${
                         row.adjustmentsTotal > 0 ? 'bg-emerald-50 text-emerald-600' : 
                         row.adjustmentsTotal < 0 ? 'bg-rose-50 text-rose-600' : 
                         'text-slate-300'
                       }`}>
                         {row.adjustmentsTotal > 0 ? '+' : ''}{row.adjustmentsTotal === 0 ? '---' : row.adjustmentsTotal.toLocaleString()}
                       </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex flex-col items-center">
                        <span className="text-sm font-black text-slate-800">{row.remainingBalance.toLocaleString()}</span>
                        <span className="text-[9px] font-bold text-slate-400">كرتون</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex flex-col items-center bg-emerald-50/50 py-2 rounded-2xl border border-emerald-100/50">
                        <span className="text-sm font-black text-emerald-600">{row.freeBalance.toLocaleString()}</span>
                        <span className="text-[9px] font-bold text-emerald-400">كرتون</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                        {row.plannedCartons.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="text-xl">⚖️</span>
                <span className="text-xs font-black">نتائج أداة التسوية</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
                تمثل التعديلات التي قام بها المسؤول يدوياً لمطابقة المخزون النظامي مع الجرد الفعلي. 
                (+) تعني زيادة في المخزون، (-) تعني كشف عجز.
              </p>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-slate-800">
                <span className="text-xl">🏠</span>
                <span className="text-xs font-black">الرصيد المتبقي (المستودع)</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
                هو الرصيد الفعلي الموجود حالياً في المركز. 
                المعادلة = (إجمالي الوارد + التسويات) - (المنفذ فعلياً).
              </p>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-emerald-600">
                <span className="text-xl">🔓</span>
                <span className="text-xs font-black">الرصيد الحر المتبقي</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
                هو الرصيد المتاح حالياً للتخطيط لرحلات جديدة. 
                المعادلة = الرصيد المتبقي بمستودع المركز - الرحلات المخططة والمنطلقة.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 shrink-0 flex justify-end">
          <button 
            onClick={onClose}
            className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 active:scale-95 transition-all"
          >
            إغلاق التقرير
          </button>
        </div>
      </div>
    </div>
  );
}

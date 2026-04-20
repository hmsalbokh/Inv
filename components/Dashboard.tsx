
import React, { useState, useMemo, useEffect } from 'react';
import { PalletType, InventoryRecord, Trip, UserRole, PressCode, CenterCode, UserCredentials, DistributionTrip } from '../types';
import { analyzeInventory } from '../services/geminiService';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, setDoc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';

interface Props {
  palletTypes: PalletType[];
  records: InventoryRecord[];
  trips: Trip[];
  distributionTrips: DistributionTrip[];
  currentTripId: string;
  role: UserRole;
  userCode: string;
  userCenter: CenterCode | null;
  users: UserCredentials[];
  onSelectCenter: (center: CenterCode) => void;
  onNewTrip: (press: PressCode, center: CenterCode, selections: { typeId: string, count: number }[], semester: string, year: string) => void;
  onNotify: (title: string, msg: string) => void;
}

type LabelSize = '10x15' | '3x4';

export const SubulLogo: React.FC<{ size?: number; color?: string }> = ({ size = 48, color = "white" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 30C20 24.4772 24.4772 20 30 20H70C75.5228 20 80 24.4772 80 30V70C80 75.5228 75.5228 80 70 80H30C24.4772 80 20 75.5228 20 70V30Z" fill="url(#paint0_linear)" fillOpacity="0.1"/>
    <path d="M50 25V75M50 25C50 21 46 18 40 18H25V65H40C46 65 50 68 50 72M50 25C50 21 54 18 60 18H75V65H60C54 65 50 68 50 72" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 35H40M30 45H40M60 35H70M60 45H70" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    <path d="M15 85C30 75 70 95 85 85" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.5"/>
    <defs>
      <linearGradient id="paint0_linear" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop stopColor={color}/>
        <stop offset="1" stopColor={color} stopOpacity="0"/>
      </linearGradient>
    </defs>
  </svg>
);

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const StageCard: React.FC<{ type: PalletType, statsRecords: InventoryRecord[] }> = ({ type, statsRecords }) => {
  const typeRecords = statsRecords.filter(r => r.palletTypeId === type.id);
  const receivedRecords = typeRecords.filter(r => r.status === 'received');
  const receivedCount = receivedRecords.length;
  const inTransitCount = typeRecords.filter(r => r.status === 'in_transit').length;
  const pendingCount = typeRecords.filter(r => r.status === 'pending').length;
  
  let totalCartons = 0;
  let totalBundles = 0;

  receivedRecords.forEach(r => {
    let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
    let b = c * type.bundlesPerCarton;

    if (r.extraCartons) {
      c += r.extraCartons;
      b += r.extraCartons * type.bundlesPerCarton;
    }
    if (r.missingCartons) {
      c -= r.missingCartons;
      b -= r.missingCartons * type.bundlesPerCarton;
    }

    if (r.hasDiscrepancy) {
      const sign = r.discrepancyType === 'excess' ? 1 : -1;
      const diffC = r.discrepancyCartonsQty || 0;
      const diffB = r.discrepancyBundlesQty || 0;
      c += sign * diffC;
      b += sign * ((diffC * type.bundlesPerCarton) + diffB);
    }
    totalCartons += c;
    totalBundles += b;
  });

  return (
    <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-4 relative overflow-hidden group hover:border-indigo-200 transition-all">
      <div className={`absolute top-0 left-0 w-2 h-full opacity-20 group-hover:opacity-100 transition-opacity ${type.id.startsWith('ig') ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h4 className="text-sm font-black text-slate-800">{type.stageName}</h4>
          <p className="text-[10px] font-bold text-slate-400">كود: {type.stageCode}</p>
        </div>
        <div className={`${type.id.startsWith('ig') ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'} px-3 py-1 rounded-full text-[10px] font-black`}>
          {typeRecords.length} طبلية
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <span className="text-[8px] font-black text-slate-400 block mb-1 uppercase">الكراتين (المستلمة)</span>
          <span className="text-lg font-black text-indigo-900">{totalCartons.toLocaleString()}</span>
        </div>
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <span className="text-[8px] font-black text-slate-400 block mb-1 uppercase">الحزم (المستلمة)</span>
          <span className="text-lg font-black text-emerald-700">{totalBundles.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-50">
        <div className="flex-1 text-center">
          <span className="text-[7px] font-black text-slate-400 block uppercase">مستلم</span>
          <span className="text-[11px] font-black text-emerald-600">{receivedCount}</span>
        </div>
        <div className="flex-1 text-center border-x border-slate-100">
          <span className="text-[7px] font-black text-slate-400 block uppercase">في الطريق</span>
          <span className="text-[11px] font-black text-amber-600">{inTransitCount}</span>
        </div>
        <div className="flex-1 text-center">
          <span className="text-[7px] font-black text-slate-400 block uppercase">معلق</span>
          <span className="text-[11px] font-black text-slate-400">{pendingCount}</span>
        </div>
      </div>
    </div>
  );
};

export const Dashboard: React.FC<Props> = ({ palletTypes, records, trips, distributionTrips, currentTripId, role, userCode, userCenter, users, onSelectCenter, onNewTrip, onNotify }) => {
  const [showForm, setShowForm] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [pCode, setPCode] = useState<PressCode>(userCode);
  const [cCode, setCCode] = useState<CenterCode>('');
  const [semester, setSemester] = useState('1'); 
  const [year, setYear] = useState('2026'); 
  const [selections, setSelections] = useState<Record<string, { pallets: number, extraCartons: number, missingCartons: number }>>({});
  
  const [activeChoiceId, setActiveChoiceId] = useState<string | null>(null);
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const [selectedSize, setSelectedSize] = useState<LabelSize>('10x15');

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [showDistForm, setShowDistForm] = useState(false);
  const [distTripData, setDistTripData] = useState({
    tripNumber: '',
    date: new Date().toISOString().split('T')[0],
    originCenter: '',
    destinationCity: '',
    quantities: {} as Record<string, { cartons: number, bundles: number }>
  });

  const [editingTripId, setEditingTripId] = useState<string | null>(null);

  const centerOptions = useMemo(() => {
    const centers = users.filter(u => u.role === 'center');
    const uniqueCenters = new Map();
    centers.forEach(c => {
      if (!uniqueCenters.has(c.code)) {
        uniqueCenters.set(c.code, c);
      }
    });
    return Array.from(uniqueCenters.values());
  }, [users]);

  useEffect(() => {
    if (centerOptions.length > 0 && !cCode) setCCode(centerOptions[0].code);
  }, [centerOptions, cCode]);

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'رقم الرحلة': '5001',
        'تاريخ الرحلة': new Date().toISOString().split('T')[0],
        'نقطة الانطلاق': userCenter || 'RYD',
        'الوجهة': 'المدينة المستهدفة',
        ...palletTypes.reduce((acc, type) => {
          acc[type.stageCode] = 0; // عمود الكراتين
          acc[`${type.stageCode}L`] = 0; // عمود الحزم
          return acc;
        }, {} as Record<string, number>)
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Distribution_Plan_Template.xlsx");
  };

  const isAdmin = useMemo(() => userCode === 'ADMIN', [userCode]);

  const statsRecords = useMemo(() => {
    return (role === 'monitor' || isAdmin) ? records : records.filter(r => {
      if (role === 'factory') return r.palletBarcode.includes(userCode);
      if (role === 'center') return r.destination === userCenter;
      return false;
    });
  }, [records, role, userCode, userCenter, isAdmin]);

  const handleAiAnalysis = async () => {
    setIsAnalyzing(true);
    const result = await analyzeInventory(palletTypes, statsRecords);
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingExcel(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        data.forEach((row) => {
          const id = generateUUID();
          const trip: DistributionTrip = {
            id,
            tripNumber: String(row['رقم الرحلة'] || row['tripNumber']),
            date: String(row['تاريخ الرحلة'] || row['date']),
            originCenter: String(row['نقطة الانطلاق'] || row['originCenter']),
            destinationCity: String(row['الوجهة'] || row['destinationCity']),
            status: 'planned',
            quantities: palletTypes.map(type => {
              const cartons = Number(row[type.stageCode] || 0);
              const extraBundles = Number(row[`${type.stageCode}L`] || 0);
              const bPerC = type.bundlesPerCarton || 1;
              
              // إجمالي الحزم = (الكراتين * السعة) + الحزم الإضافية
              const totalBundles = (cartons * bPerC) + extraBundles;
              // عدد الكراتين النهائي (جبر الكسر للأعلى)
              const finalCartonCount = Math.ceil(totalBundles / bPerC);

              return {
                palletTypeId: type.id,
                cartonCount: finalCartonCount,
                bundleCount: totalBundles
              };
            }).filter(q => q.bundleCount > 0)
          };
          batch.set(doc(db, 'distributionTrips', id), trip);
        });

        await batch.commit();
        onNotify('نجاح', 'تم رفع الرحلات المخططة بنجاح');
      } catch (err) {
        console.error('Excel upload error:', err);
        onNotify('خطأ', 'خطأ في معالجة ملف الاكسل. يرجى التأكد من أسماء الأعمدة.');
      } finally {
        setIsUploadingExcel(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDispatchTrip = async (tripId: string) => {
    try {
      await updateDoc(doc(db, 'distributionTrips', tripId), { status: 'dispatched' });
      onNotify('نجاح', 'تم إطلاق الرحلة وتحديث المخزون');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `distributionTrips/${tripId}`);
    }
  };

  const handleDeleteDistTrip = async (tripId: string) => {
    if (!window.confirm('هل أنت متأكد من رغبتك في حذف هذه الرحلة المخططة؟')) return;
    try {
      await deleteDoc(doc(db, 'distributionTrips', tripId));
      onNotify('نجاح', 'تم حذف رحلة التوزيع بنجاح');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `distributionTrips/${tripId}`);
    }
  };

  const handleEditDistTrip = (trip: DistributionTrip) => {
    const quantitiesMap: Record<string, { cartons: number, bundles: number }> = {};
    trip.quantities.forEach(q => {
      const type = palletTypes.find(t => t.id === q.palletTypeId);
      const bPerC = type?.bundlesPerCarton || 1;
      const fullCartons = Math.floor(q.bundleCount / bPerC);
      const remainingBundles = q.bundleCount % bPerC;
      quantitiesMap[q.palletTypeId] = {
        cartons: fullCartons,
        bundles: remainingBundles
      };
    });

    setDistTripData({
      tripNumber: trip.tripNumber,
      date: trip.date,
      originCenter: trip.originCenter,
      destinationCity: trip.destinationCity,
      quantities: quantitiesMap
    });
    setEditingTripId(trip.id);
    setShowDistForm(true);
  };

  const handleCreateManualDistTrip = async () => {
    console.log('Attempting to create/update manual dist trip...', distTripData);
    if (!distTripData.tripNumber || !distTripData.originCenter || !distTripData.destinationCity) {
      onNotify('تنبيه', 'يرجى إكمال جميع البيانات الأساسية');
      return;
    }

    const quantities = Object.entries(distTripData.quantities)
      .filter(([_, qty]) => qty.cartons > 0 || qty.bundles > 0)
      .map(([typeId, qty]) => {
        const type = palletTypes.find(t => t.id === typeId);
        const bPerC = type?.bundlesPerCarton || 0;
        
        if (bPerC <= 0) return null; // تجاهل المراحل ذات البيانات الخاطئة

        // المنطق الجديد: تحويل كل المدخلات إلى حزم أولاً
        const totalBundles = (qty.cartons * bPerC) + qty.bundles;
        
        // ثم إعادة توزيعها إلى كراتين كاملة وحزم متبقية
        const finalCartonCount = Math.ceil(totalBundles / bPerC);
        
        return {
          palletTypeId: typeId,
          cartonCount: finalCartonCount,
          bundleCount: totalBundles
        };
      }).filter(q => q !== null) as { palletTypeId: string, cartonCount: number, bundleCount: number }[];

    if (quantities.length === 0) {
      onNotify('تنبيه', 'يرجى إضافة كمية واحدة على الأقل');
      return;
    }

    try {
      if (editingTripId) {
        await updateDoc(doc(db, 'distributionTrips', editingTripId), {
          tripNumber: distTripData.tripNumber,
          date: distTripData.date,
          originCenter: distTripData.originCenter,
          destinationCity: distTripData.destinationCity,
          quantities
        });
        onNotify('نجاح', 'تم تحديث الرحلة بنجاح');
      } else {
        const id = generateUUID();
        const newTrip: DistributionTrip = {
          id,
          tripNumber: distTripData.tripNumber,
          date: distTripData.date,
          originCenter: distTripData.originCenter,
          destinationCity: distTripData.destinationCity,
          status: 'planned',
          quantities
        };
        await setDoc(doc(db, 'distributionTrips', id), newTrip);
        onNotify('نجاح', 'تم إضافة الرحلة بنجاح');
      }
      
      setShowDistForm(false);
      setEditingTripId(null);
      setDistTripData({
        tripNumber: '',
        date: new Date().toISOString().split('T')[0],
        originCenter: '',
        destinationCity: '',
        quantities: {}
      });
    } catch (e) {
      handleFirestoreError(e, editingTripId ? OperationType.UPDATE : OperationType.CREATE, 'distributionTrips');
    }
  };

  const handleExportCenterInventory = () => {
    const exportData: any[] = [];

    centerOptions.forEach(center => {
      const centerRecords = statsRecords.filter(r => r.destination === center.code);
      const receivedRecords = centerRecords.filter(r => r.status === 'received');

      palletTypes.forEach(type => {
        const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
        const plannedQty = stats.plannedOutbound[center.code]?.[type.id] || 0;
        
        const palletCount = typeInCenter.length;

        let totalCartons = 0;
        let totalBundles = 0;
        let diffCartons = 0;
        let diffBundles = 0;

        typeInCenter.forEach(r => {
          let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
          let b = c * type.bundlesPerCarton;

          if (r.extraCartons) {
            c += r.extraCartons;
            b += r.extraCartons * type.bundlesPerCarton;
            diffCartons += r.extraCartons;
            diffBundles += r.extraCartons * type.bundlesPerCarton;
          }
          if (r.missingCartons) {
            c -= r.missingCartons;
            b -= r.missingCartons * type.bundlesPerCarton;
            diffCartons -= r.missingCartons;
            diffBundles -= r.missingCartons * type.bundlesPerCarton;
          }

          if (r.hasDiscrepancy) {
            const sign = r.discrepancyType === 'excess' ? 1 : -1;
            const diffC = r.discrepancyCartonsQty || 0;
            const diffB = r.discrepancyBundlesQty || 0;
            diffCartons += sign * diffC;
            diffBundles += sign * diffB;
            
            c += sign * diffC;
            b += sign * ((diffC * type.bundlesPerCarton) + diffB);
          }
          totalCartons += c;
          totalBundles += b;
        });

        const remaining = totalCartons - plannedQty;

        if (palletCount > 0 || plannedQty > 0) {
          exportData.push({
            'المركز': center.displayName,
            'المرحلة': type.stageName,
            'عدد الطبليات (المستلمة)': palletCount,
            'التباين (كرتون)': diffCartons,
            'التباين (حزمة)': diffBundles,
            'إجمالي الكراتين': totalCartons,
            'إجمالي الحزم': totalBundles,
            'مخطط صرفه (كرتون)': plannedQty,
            'المخزون المتبقي (كرتون)': remaining,
            'المخزون المتبقي (حزمة)': remaining * type.bundlesPerCarton
          });
        }
      });
    });

    if (exportData.length === 0) {
      onNotify('تنبيه', 'لا يوجد بيانات لتصديرها');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Report");
    XLSX.writeFile(wb, `Inventory_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const currentTrip = useMemo(() => trips.find(t => t.id === currentTripId), [trips, currentTripId]);
  const currentTripRecords = useMemo(() => records.filter(r => r.tripId === currentTripId), [records, currentTripId]);

  const stats = useMemo(() => {
    const received = statsRecords.filter(r => r.status === 'received');
    
    const stageSummary = palletTypes.map(type => {
      const typeReceived = received.filter(r => r.palletTypeId === type.id);
      const palletCount = typeReceived.length;

      let totalCartons = 0;
      let totalBundles = 0;
      typeReceived.forEach(r => {
        let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
        let b = c * type.bundlesPerCarton;

        if (r.extraCartons) {
          c += r.extraCartons;
          b += r.extraCartons * type.bundlesPerCarton;
        }
        if (r.missingCartons) {
          c -= r.missingCartons;
          b -= r.missingCartons * type.bundlesPerCarton;
        }

        if (r.hasDiscrepancy) {
          const sign = r.discrepancyType === 'excess' ? 1 : -1;
          const diffC = r.discrepancyCartonsQty || 0;
          const diffB = r.discrepancyBundlesQty || 0;
          c += sign * diffC;
          b += sign * ((diffC * type.bundlesPerCarton) + diffB);
        }
        totalCartons += c;
        totalBundles += b;
      });
      
      return { ...type, palletCount, totalCartons, totalBundles };
    }).filter(s => s.palletCount > 0);

    const totalBundles = stageSummary.reduce((acc, s) => acc + s.totalBundles, 0);
    const totalCartons = stageSummary.reduce((acc, s) => acc + s.totalCartons, 0);

    // حساب إجمالي النقص/الزيادة
    let totalDiffCartons = 0;
    let totalDiffBundles = 0;
    received.forEach(r => {
      const type = palletTypes.find(t => t.id === r.palletTypeId);
      if (type) {
        if (r.extraCartons) {
          totalDiffCartons += r.extraCartons;
          totalDiffBundles += r.extraCartons * type.bundlesPerCarton;
        }
        if (r.missingCartons) {
          totalDiffCartons -= r.missingCartons;
          totalDiffBundles -= r.missingCartons * type.bundlesPerCarton;
        }
        if (r.hasDiscrepancy) {
          const sign = r.discrepancyType === 'excess' ? 1 : -1;
          totalDiffCartons += sign * (r.discrepancyCartonsQty || 0);
          totalDiffBundles += sign * (r.discrepancyBundlesQty || 0);
        }
      }
    });

    // حساب إجمالي عدد الكراتين المتضررة بدقة
    const totalExtDamagedCartons = received.reduce((acc, r) => acc + (r.externalDamageQty || 0), 0);
    const totalIntDamagedCartons = received.reduce((acc, r) => acc + (r.internalDamageQty || 0), 0);
    const totalDamagedCartons = totalExtDamagedCartons + totalIntDamagedCartons;

    // حساب المخزون المخطط صرفه (Planned Outbound)
    const plannedOutbound = distributionTrips
      .filter(t => t.status === 'planned')
      .reduce((acc, t) => {
        t.quantities.forEach(q => {
          acc[t.originCenter] = acc[t.originCenter] || {};
          acc[t.originCenter][q.palletTypeId] = (acc[t.originCenter][q.palletTypeId] || 0) + q.cartonCount;
        });
        return acc;
      }, {} as Record<string, Record<string, number>>);

    return { 
      total: statsRecords.length, 
      received: received.length,
      inFactory: statsRecords.filter(r => r.status === 'pending').length,
      inTransit: statsRecords.filter(r => r.status === 'in_transit').length,
      totalCartons,
      totalBundles,
      totalDiffCartons,
      totalDiffBundles,
      stageSummary,
      totalDamagedCartons,
      totalExtDamagedCartons,
      totalIntDamagedCartons,
      palletsWithDamage: received.filter(r => r.condition && r.condition !== 'intact').length,
      plannedOutbound
    };
  }, [statsRecords, palletTypes, distributionTrips]);

  const getDisplayName = (code: string) => users.find(u => u.code === code)?.displayName || code;

  const generateLabelContent = (record: InventoryRecord, size: LabelSize) => {
    const pType = palletTypes.find(t => t.id === record?.palletTypeId);
    const trip = trips.find(t => t.id === record.tripId) || currentTrip;
    const barcodeImgUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${record?.palletBarcode}&scale=4&rotate=N&includetext=false`;
    const isLarge = size === '10x15';

    return `
      <div class="label-card" style="width: 100%; height: 100%; border: ${isLarge ? '8px' : '4px'} solid black; padding: ${isLarge ? '8mm' : '4mm'}; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: white; font-family: 'Tajawal', sans-serif; overflow: hidden; text-align: center; page-break-after: always;">
         <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: ${isLarge ? '4px' : '2px'} solid black; padding-bottom: ${isLarge ? '10px' : '5px'};">
            <div style="display: flex; gap: 10px; align-items: center;">
               <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${record?.palletBarcode}" style="width: ${isLarge ? '50px' : '30px'}; height: ${isLarge ? '50px' : '30px'};" />
               <div style="text-align: right;">
                  <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 800;">توصيل الكتب</div>
                  <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900; line-height: 1.1;">مشروع التعليم</div>
               </div>
            </div>
            <div style="background: white; color: black; border: ${isLarge ? '3px' : '2px'} solid black; padding: ${isLarge ? '8px 12px' : '4px 6px'}; border-radius: 6px; text-align: center;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700;">الرحلة</div>
               <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900;">#${trip?.tripNumber || '---'}</div>
            </div>
         </div>
         <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${isLarge ? '12px' : '6px'}; padding: 5px 0;">
            <div style="font-size: ${isLarge ? '13px' : '8px'}; font-weight: 900; color: #333;">PALLET BARCODE</div>
            <img src="${barcodeImgUrl}" style="width: 100%; max-height: ${isLarge ? '85px' : '45px'}; object-fit: contain;" />
            <div style="background: white; color: black; border: ${isLarge ? '3px' : '2px'} solid black; width: 100%; padding: ${isLarge ? '10px' : '5px'}; font-size: ${isLarge ? '26px' : '14px'}; font-weight: 900; font-family: monospace; border-radius: 8px;">
               ${record?.palletBarcode}
            </div>
         </div>
         <div style="padding: ${isLarge ? '8px 0' : '4px 0'}; border-top: ${isLarge ? '3px' : '1.5px'} solid black; border-bottom: ${isLarge ? '3px' : '1.5px'} solid black; margin-bottom: 5px;">
            <div style="font-size: ${isLarge ? '24px' : '12px'}; font-weight: 900; line-height: 1.1;">${pType?.stageName}</div>
            <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 700; color: #555;">
              ${record.isExtraOnly ? `(تحتوي على ${record.extraCartons} كرتون إضافي فقط بدون طبلية كاملة)` : `طبلية كاملة${record.extraCartons ? ` + (${record.extraCartons} كراتين إضافية)` : ''}`}
            </div>
            ${record.missingCartons ? `<div style="font-size: ${isLarge ? '13px' : '9px'}; font-weight: 900; color: #e11d48; margin-top: 2px;">(⚠️ طبلية ناقصة: مخصوم منها ${record.missingCartons} كراتين)</div>` : ''}
         </div>
         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <div style="text-align: right; border-left: ${isLarge ? '2px' : '1px'} solid black; padding-left: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المرسل:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900;">${getDisplayName(trip?.pressCode || '')}</div>
            </div>
            <div style="text-align: right; padding-right: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المستلم:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900;">${getDisplayName(record.destination)}</div>
            </div>
         </div>
      </div>
    `;
  };

  const handlePrintAllBatch = () => {
    if (currentTripRecords.length === 0) return;
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const allLabelsHTML = currentTripRecords.map(record => generateLabelContent(record, selectedSize)).join('');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`<html dir="rtl"><head><title>Trip Labels</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; } .label-card { width: ${w}mm; height: ${h}mm; }</style></head><body>${allLabelsHTML}<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); };</script></body></html>`);
        printWindow.document.close();
    }
    setIsBatchPrinting(false);
  };

  const handlePrintSingle = (id: string) => {
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const record = records.find(r => r.id === id);
    if (!record) return;
    const content = generateLabelContent(record, selectedSize);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`<html dir="rtl"><head><title>Label</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; }</style></head><body>${content}<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 300); };</script></body></html>`);
        printWindow.document.close();
    }
    setActiveChoiceId(null);
  };

  const handleNewTripSubmit = () => {
    const selectedEntries = Object.entries(selections);
    const selectedList = selectedEntries
      .filter(([_, sel]) => (sel.pallets || 0) > 0 || (sel.extraCartons || 0) > 0 || (sel.missingCartons || 0) > 0)
      .map(([typeId, sel]) => ({ typeId, pallets: sel.pallets || 0, extraCartons: sel.extraCartons || 0, missingCartons: sel.missingCartons || 0 }));
      
    if (selectedList.length === 0) { onNotify('تنبيه', 'يرجى اختيار كمية أو طبلية واحدة على الأقل'); return; }
    if (!cCode) { onNotify('تنبيه', 'يرجى اختيار وجهة الاستلام'); return; }
    
    // @ts-ignore
    onNewTrip(pCode, cCode, selectedList, semester, year);
    setShowForm(false); setSelections({});
    setTimeout(() => setShowLabels(true), 500);
  };

  const isMonitor = role === 'monitor' || isAdmin;
  const showStatsReport = isMonitor || role === 'center';

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <section className="bg-gradient-to-br from-indigo-900 to-indigo-800 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col items-center text-center gap-4">
         <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
         <div className="relative p-2 bg-white/10 backdrop-blur-xl rounded-[2.5rem] shadow-inner border border-white/10">
            <SubulLogo size={80} color="white" />
         </div>
         <div className="space-y-1 relative z-10">
            <h2 className="text-2xl font-black text-white leading-tight">ادارة مخزون مشروع التعليم</h2>
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-[0.3em]">
               {role === 'center' ? `إدارة استلام ${getDisplayName(userCenter || '')}` : 'نظام تتبع الكتب المدرسية'}
            </p>
         </div>
         {isAdmin && (
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              <button onClick={handleAiAnalysis} disabled={isAnalyzing} className={`px-6 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95 ${isAnalyzing ? 'animate-pulse' : ''}`}>
                {isAnalyzing ? 'جاري التحليل...' : '✨ تحليل الذكاء الاصطناعي'}
              </button>
              <button onClick={() => setShowDistForm(true)} className="px-6 py-2.5 rounded-2xl bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/30 transition-all active:scale-95">
                ➕ إضافة رحلة يدوياً
              </button>
              <div className="flex gap-1">
                <label className="px-6 py-2.5 rounded-2xl bg-emerald-500/20 backdrop-blur-md border border-emerald-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-emerald-500/30 transition-all active:scale-95 cursor-pointer">
                  {isUploadingExcel ? 'جاري الرفع...' : '📊 رفع خطة التوزيع'}
                  <input type="file" accept=".xlsx, .xls" onChange={handleExcelUpload} className="hidden" disabled={isUploadingExcel} />
                </label>
                <button onClick={handleDownloadTemplate} className="px-4 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95" title="تحميل القالب">
                  📥 القالب
                </button>
              </div>
            </div>
         )}
      </section>

      {showDistForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] relative my-auto">
            <div className="p-6 bg-indigo-900 text-white flex justify-between items-center shrink-0">
              <h3 className="font-black text-lg">{editingTripId ? 'تعديل رحلة توزيع' : 'إضافة رحلة توزيع يدوية'}</h3>
              <button onClick={() => {
                setShowDistForm(false);
                setEditingTripId(null);
                setDistTripData({
                  tripNumber: '',
                  date: new Date().toISOString().split('T')[0],
                  originCenter: '',
                  destinationCity: '',
                  quantities: {}
                });
              }} className="text-white/60 hover:text-white p-2">✕</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 mr-2">رقم الرحلة</label>
                  <input 
                    type="text" 
                    value={distTripData.tripNumber}
                    onChange={e => setDistTripData({...distTripData, tripNumber: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                    placeholder="مثلاً: 5001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 mr-2">التاريخ</label>
                  <input 
                    type="date" 
                    value={distTripData.date}
                    onChange={e => setDistTripData({...distTripData, date: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">مركز الانطلاق</label>
                <select 
                  value={distTripData.originCenter}
                  onChange={e => setDistTripData({...distTripData, originCenter: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                >
                  <option value="">اختر المركز</option>
                  {centerOptions.map(c => <option key={c.code} value={c.code}>{c.displayName}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">الوجهة (المدينة)</label>
                <input 
                  type="text" 
                  value={distTripData.destinationCity}
                  onChange={e => setDistTripData({...distTripData, destinationCity: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                  placeholder="مثلاً: مكة المكرمة"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100 mb-4">
                  <p className="text-[9px] font-bold text-indigo-700 leading-relaxed">
                    💡 <span className="font-black">منطق التوزيع:</span> يتم توزيع الكراتين بشكل كامل أولاً، ثم حساب الحزم المتبقية في كرتون جزئي أخير.
                  </p>
                </div>
                <label className="text-[10px] font-black text-slate-400 block mb-3">الكميات المطلوبة:</label>
                <div className="space-y-2">
                  {palletTypes.map(type => (
                    <div key={type.id} className="flex flex-col gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-700">{type.stageName}</span>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                          <span className="text-[9px] font-black text-slate-400">كرتون</span>
                          <input 
                            type="number"
                            min="0"
                            value={distTripData.quantities[type.id]?.cartons || ''}
                            onChange={e => setDistTripData({
                              ...distTripData, 
                              quantities: { 
                                ...distTripData.quantities, 
                                [type.id]: { 
                                  ...(distTripData.quantities[type.id] || { bundles: 0 }), 
                                  cartons: parseInt(e.target.value) || 0 
                                } 
                              }
                            })}
                            className="w-full text-center text-xs font-black outline-none"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                          <span className="text-[9px] font-black text-slate-400">حزمة</span>
                          <input 
                            type="number"
                            min="0"
                            value={distTripData.quantities[type.id]?.bundles || ''}
                            onChange={e => setDistTripData({
                              ...distTripData, 
                              quantities: { 
                                ...distTripData.quantities, 
                                [type.id]: { 
                                  ...(distTripData.quantities[type.id] || { cartons: 0 }), 
                                  bundles: parseInt(e.target.value) || 0 
                                } 
                              }
                            })}
                            className="w-full text-center text-xs font-black outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      {(() => {
                        const q = distTripData.quantities[type.id];
                        if (!q || (q.cartons === 0 && q.bundles === 0)) return null;
                        
                        const bPerC = type.bundlesPerCarton || 0;
                        if (bPerC <= 0) return (
                          <div className="mt-1 text-[8px] font-bold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100">
                            ⚠️ خطأ: سعة الكرتون لهذه المرحلة غير محددة بشكل صحيح (0). يرجى مراجعة الإعدادات.
                          </div>
                        );

                        const cartons = Number(q.cartons) || 0;
                        const bundles = Number(q.bundles) || 0;
                        const totalBundles = (cartons * bPerC) + bundles;
                        const finalCartons = Math.floor(totalBundles / bPerC);
                        const finalRemainingBundles = totalBundles % bPerC;
                        const totalCartonsNeeded = Math.ceil(totalBundles / bPerC);
                        
                        return (
                          <div className="mt-1 text-[8px] font-bold text-indigo-600 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50 flex flex-col gap-1">
                            <div className="flex justify-between">
                              <span>📦 الإجمالي: {finalCartons} كرتون</span>
                              <span>🔢 + {finalRemainingBundles} حزمة</span>
                            </div>
                            <div className="text-[7px] text-slate-500 border-t border-indigo-100/30 pt-1">
                              سيتم خصم {totalCartonsNeeded} كرتون من المخزون (منها كرتون واحد جزئي يحتوي على {finalRemainingBundles} حزمة).
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 shrink-0">
              <button 
                onClick={handleCreateManualDistTrip}
                className="w-full bg-indigo-900 text-white p-4 rounded-[1.5rem] font-black text-sm shadow-xl active:scale-95 transition-all"
              >
                حفظ الرحلة
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && aiAnalysis && (
        <section className="animate-slideDown">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-t-4 border-indigo-500 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
               <h3 className="text-sm font-black text-indigo-900">✨ توصيات الذكاء الاصطناعي</h3>
               <button onClick={() => setAiAnalysis(null)} className="text-[10px] font-bold text-slate-400">إغلاق</button>
            </div>
            <div className="text-xs leading-relaxed text-slate-600 font-bold whitespace-pre-line">{aiAnalysis}</div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">📦</span>
          <span className="text-3xl font-black text-slate-800">{stats.total}</span>
          <span className="text-[10px] font-bold text-slate-400">إجمالي الطبليات</span>
        </div>
        <div className="bg-emerald-50 p-6 rounded-[2.5rem] shadow-sm border border-emerald-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">✅</span>
          <span className="text-3xl font-black text-emerald-700">{stats.received}</span>
          <span className="text-[10px] font-bold text-emerald-500">
            {role === 'center' ? 'تم استلامها (في المركز)' : 'تم استلامها (في المراكز)'}
          </span>
        </div>
        <div className="bg-indigo-50 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">🏭</span>
          <span className="text-3xl font-black text-indigo-700">{stats.inFactory}</span>
          <span className="text-[10px] font-bold text-indigo-500">في المطبعة</span>
        </div>
        <div className="bg-amber-50 p-6 rounded-[2.5rem] shadow-sm border border-amber-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">🚚</span>
          <span className="text-3xl font-black text-amber-700">{stats.inTransit}</span>
          <span className="text-[10px] font-bold text-amber-500">في الطريق</span>
        </div>
      </section>

      {showStatsReport && (
        <section className="space-y-4 animate-slideDown">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
               <h2 className="text-lg font-black text-indigo-900">📊 تقرير التلفيات والمخزون</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl text-right border border-emerald-100">
                <span className="text-[9px] font-black text-emerald-400 block mb-1 uppercase">إجمالي الكتب (كراتين) المستلمة</span>
                <span className="text-2xl font-black text-emerald-900">{stats.totalCartons.toLocaleString()} كرتون</span>
              </div>
              <div className="bg-emerald-50 p-5 rounded-3xl text-right border border-emerald-100">
                <span className="text-[9px] font-black text-emerald-400 block mb-1 uppercase">إجمالي الحزم المستلمة</span>
                <span className="text-2xl font-black text-emerald-700">{stats.totalBundles.toLocaleString()} حزمة</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-50">
               <div className="bg-rose-50 p-4 rounded-3xl text-center border border-rose-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">⚠️</span>
                  <span className="text-xl font-black text-rose-700 leading-none">{stats.totalDamagedCartons}</span>
                  <span className="text-[7px] font-black text-rose-400 block uppercase mt-1">إجمالي الكراتين التالفة</span>
               </div>
               <div className="bg-amber-50 p-4 rounded-3xl text-center border border-amber-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📦</span>
                  <span className="text-xl font-black text-amber-700 leading-none">{stats.totalExtDamagedCartons}</span>
                  <span className="text-[7px] font-black text-amber-400 block uppercase mt-1">تلف كراتين خارجي</span>
               </div>
               <div className="bg-orange-50 p-4 rounded-3xl text-center border border-orange-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📖</span>
                  <span className="text-xl font-black text-orange-700 leading-none">{stats.totalIntDamagedCartons}</span>
                  <span className="text-[7px] font-black text-orange-400 block uppercase mt-1">تلف كراتين داخلي</span>
               </div>
            </div>

            {(stats.totalDiffCartons !== 0 || stats.totalDiffBundles !== 0) && (
              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                 <div className="bg-indigo-50 p-4 rounded-3xl text-center border border-indigo-100 flex flex-col items-center">
                    <span className="text-xl block mb-1">⚖️</span>
                    <span className={`text-xl font-black leading-none ${stats.totalDiffCartons > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {stats.totalDiffCartons > 0 ? '+' : ''}{stats.totalDiffCartons}
                    </span>
                    <span className="text-[7px] font-black text-indigo-400 block uppercase mt-1">تباين المخزون (كرتون)</span>
                 </div>
                 <div className="bg-indigo-50 p-4 rounded-3xl text-center border border-indigo-100 flex flex-col items-center">
                    <span className="text-xl block mb-1">⚖️</span>
                    <span className={`text-xl font-black leading-none ${stats.totalDiffBundles > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {stats.totalDiffBundles > 0 ? '+' : ''}{stats.totalDiffBundles}
                    </span>
                    <span className="text-[7px] font-black text-indigo-400 block uppercase mt-1">تباين المخزون (حزم)</span>
                 </div>
              </div>
            )}
          </div>
        </section>
      )}

      {(isMonitor || isAdmin) && (
        <section className="space-y-4 animate-slideDown">
          <div className="flex items-center justify-between px-2">
            <div className="flex flex-col">
              <h3 className="text-lg font-black text-indigo-900">🏢 المخزون حسب المركز</h3>
              <span className="text-[10px] font-bold text-slate-400">إجمالي المراكز: {centerOptions.length}</span>
            </div>
            <button 
              onClick={handleExportCenterInventory}
              className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-sm"
            >
              📊 تصدير تقرير المخزون (Excel)
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {centerOptions.map(center => {
              const centerRecords = statsRecords.filter(r => r.destination === center.code);
              const receivedRecords = centerRecords.filter(r => r.status === 'received');
              
              let centerCartons = 0;
              let centerBundles = 0;
              receivedRecords.forEach(r => {
                const type = palletTypes.find(t => t.id === r.palletTypeId);
                if (type) {
                  let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
                  let b = c * type.bundlesPerCarton;

                  if (r.extraCartons) {
                    c += r.extraCartons;
                    b += r.extraCartons * type.bundlesPerCarton;
                  }
                  if (r.missingCartons) {
                    c -= r.missingCartons;
                    b -= r.missingCartons * type.bundlesPerCarton;
                  }

                  if (r.hasDiscrepancy) {
                    const sign = r.discrepancyType === 'excess' ? 1 : -1;
                    const diffC = r.discrepancyCartonsQty || 0;
                    const diffB = r.discrepancyBundlesQty || 0;
                    c += sign * diffC;
                    b += sign * ((diffC * type.bundlesPerCarton) + diffB);
                  }
                  centerCartons += c;
                  centerBundles += b;
                }
              });

              const centerPlannedTrips = distributionTrips.filter(t => t.originCenter === center.code && t.status === 'planned');

              return (
                <div key={center.id} className="bg-white p-5 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-4 relative overflow-hidden group hover:border-emerald-200 transition-all">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500 opacity-20 group-hover:opacity-100 transition-opacity"></div>
                  <div className="flex justify-between items-start">
                    <h4 className="text-xs font-black text-slate-800">{center.displayName}</h4>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        كود: {center.code}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    <div className="bg-slate-50 p-2 rounded-xl text-center border border-slate-100">
                      <span className="text-lg block">📦</span>
                      <span className="text-xs font-black text-slate-800 block">{centerRecords.length}</span>
                      <span className="text-[7px] font-bold text-slate-400 uppercase">إجمالي</span>
                    </div>
                    <div className="bg-emerald-50 p-2 rounded-xl text-center border border-emerald-100">
                      <span className="text-lg block">✅</span>
                      <span className="text-xs font-black text-emerald-700 block">{receivedRecords.length}</span>
                      <span className="text-[7px] font-bold text-emerald-500 uppercase">مستلم</span>
                    </div>
                    <div className="bg-indigo-50 p-2 rounded-xl text-center border border-indigo-100">
                      <span className="text-lg block">🏭</span>
                      <span className="text-xs font-black text-indigo-700 block">{centerRecords.filter(r => r.status === 'pending').length}</span>
                      <span className="text-[7px] font-bold text-indigo-500 uppercase">بالمطبعة</span>
                    </div>
                    <div className="bg-amber-50 p-2 rounded-xl text-center border border-amber-100">
                      <span className="text-lg block">🚚</span>
                      <span className="text-xs font-black text-amber-700 block">{centerRecords.filter(r => r.status === 'in_transit').length}</span>
                      <span className="text-[7px] font-bold text-amber-500 uppercase">بالطريق</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-[8px] font-black text-slate-400 uppercase block">الكراتين</span>
                      <span className="text-sm font-black text-indigo-900">{centerCartons.toLocaleString()}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl text-center">
                      <span className="text-[8px] font-black text-slate-400 uppercase block">الحزم</span>
                      <span className="text-sm font-black text-emerald-700">{centerBundles.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-50">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-black text-slate-400 uppercase block mr-1">تفاصيل المراحل والمخزون المتبقي:</span>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                      {palletTypes.map(type => {
                        const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
                        const plannedQty = stats.plannedOutbound[center.code]?.[type.id] || 0;
                        if (typeInCenter.length === 0 && plannedQty === 0) return null;
                        
                        let typeCartons = 0;
                        let typeBundles = 0;
                        let stageDiffCartons = 0;
                        let stageDiffBundles = 0;

                        typeInCenter.forEach(r => {
                          let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
                          let b = c * type.bundlesPerCarton;

                          if (r.extraCartons) {
                            c += r.extraCartons;
                            b += r.extraCartons * type.bundlesPerCarton;
                            stageDiffCartons += r.extraCartons;
                            stageDiffBundles += r.extraCartons * type.bundlesPerCarton;
                          }
                          if (r.missingCartons) {
                            c -= r.missingCartons;
                            b -= r.missingCartons * type.bundlesPerCarton;
                            stageDiffCartons -= r.missingCartons;
                            stageDiffBundles -= r.missingCartons * type.bundlesPerCarton;
                          }

                          if (r.hasDiscrepancy) {
                            const sign = r.discrepancyType === 'excess' ? 1 : -1;
                            const diffC = r.discrepancyCartonsQty || 0;
                            const diffB = r.discrepancyBundlesQty || 0;
                            
                            stageDiffCartons += (sign * diffC);
                            stageDiffBundles += (sign * diffB);

                            c += sign * diffC;
                            b += sign * ((diffC * type.bundlesPerCarton) + diffB);
                          }
                          typeCartons += c;
                          typeBundles += b;
                        });

                        const remaining = typeCartons - plannedQty;
                        const remainingBundles = remaining * type.bundlesPerCarton; // approximate since we mix carton/bundle shortages, but good enough for UI
                        const isShortage = remaining < 0;

                        return (
                          <div key={type.id} className={`flex flex-col gap-1 p-2 rounded-lg border ${isShortage ? 'bg-rose-50 border-rose-100' : 'bg-slate-50/50 border-slate-100/50'}`}>
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col">
                                <span className="text-[9px] font-bold text-slate-600 truncate max-w-[100px]">{type.stageName}</span>
                                {(stageDiffCartons !== 0 || stageDiffBundles !== 0) && (
                                  <div className="flex gap-1 mt-1">
                                    {stageDiffCartons !== 0 && (
                                      <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-md ${stageDiffCartons > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {stageDiffCartons > 0 ? '+' : '-'}{Math.abs(stageDiffCartons)} كرتون
                                      </span>
                                    )}
                                    {stageDiffBundles !== 0 && (
                                      <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-md ${stageDiffBundles > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {stageDiffBundles > 0 ? '+' : '-'}{Math.abs(stageDiffBundles)} حزمة
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-black text-indigo-600">{typeCartons} ك</span>
                                <span className="text-[9px] font-black text-emerald-600">{typeBundles} ح</span>
                                <span className="text-[8px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded-md border border-slate-100">{typeInCenter.length} ط</span>
                              </div>
                            </div>
                            {plannedQty > 0 && (
                              <div className="flex justify-between items-center pt-1 border-t border-slate-100/50">
                                <span className="text-[8px] font-bold text-amber-600">مخطط صرفه: {plannedQty}</span>
                                <div className="flex flex-col items-end">
                                  <span className={`text-[8px] font-black ${isShortage ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {isShortage ? `عجز: ${Math.abs(remaining)}` : `المتبقي: ${remaining}`}
                                  </span>
                                  {!isShortage && (
                                    <span className="text-[7px] font-bold text-emerald-500">
                                      (~{remainingBundles} حزمة)
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {centerPlannedTrips.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-50">
                      <span className="text-[9px] font-black text-indigo-600 uppercase block mr-1">الرحلات المخططة ({centerPlannedTrips.length}):</span>
                      <div className="space-y-2">
                        {(() => {
                          const currentStock = palletTypes.reduce((acc, type) => {
                            const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
                            let tC = 0;
                            typeInCenter.forEach(r => {
                              let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;

                              if (r.extraCartons) {
                                c += r.extraCartons;
                              }
                              if (r.missingCartons) {
                                c -= r.missingCartons;
                              }

                              if (r.hasDiscrepancy) {
                                const sign = r.discrepancyType === 'excess' ? 1 : -1;
                                c += sign * (r.discrepancyCartonsQty || 0);
                              }
                              tC += c;
                            });
                            acc[type.id] = tC;
                            return acc;
                          }, {} as Record<string, number>);

                          return centerPlannedTrips.map(trip => {
                            let hasShortage = false;
                            const tripDeficits: { stageName: string, deficit: number }[] = [];

                            trip.quantities.forEach(q => {
                              const available = currentStock[q.palletTypeId] || 0;
                              if (available < q.cartonCount) {
                                hasShortage = true;
                                tripDeficits.push({
                                  stageName: palletTypes.find(t => t.id === q.palletTypeId)?.stageName || 'غير معروف',
                                  deficit: q.cartonCount - available
                                });
                              }
                              currentStock[q.palletTypeId] = available - q.cartonCount;
                            });

                            return (
                              <div key={trip.id} className={`p-3 rounded-2xl border transition-all ${hasShortage ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'} flex flex-col gap-2`}>
                                <div className="flex justify-between items-center">
                                  <div className="text-right">
                                    <div className={`text-[10px] font-black ${hasShortage ? 'text-rose-900' : 'text-emerald-900'}`}>رحلة #{trip.tripNumber}</div>
                                    <div className="text-[8px] font-bold text-slate-500">{trip.destinationCity} - {trip.date}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {(isAdmin || isMonitor || (role === 'center' && userCenter === center.code)) && (
                                      <div className="flex items-center gap-1 ml-2">
                                        <button onClick={() => handleEditDistTrip(trip)} className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-indigo-100 hover:text-indigo-600 transition-all" title="تعديل">
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button onClick={() => handleDeleteDistTrip(trip.id)} className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-rose-100 hover:text-rose-600 transition-all" title="حذف">
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                      </div>
                                    )}
                                    {hasShortage ? (
                                      <span className="bg-rose-600 text-white px-2 py-0.5 rounded-full text-[7px] font-black uppercase">عجز في المخزون</span>
                                    ) : (
                                      <span className="bg-emerald-600 text-white px-2 py-0.5 rounded-full text-[7px] font-black uppercase">مخزون كافٍ</span>
                                    )}
                                    {(role === 'center' && userCenter === center.code) && (
                                      <button 
                                        onClick={() => handleDispatchTrip(trip.id)}
                                        className={`${hasShortage ? 'bg-rose-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-3 py-1.5 rounded-xl text-[8px] font-black transition-all shadow-sm`}
                                        disabled={hasShortage}
                                      >
                                        إطلاق
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {hasShortage && (
                                  <div className="bg-white/50 p-2 rounded-xl border border-rose-100">
                                    <div className="text-[8px] font-black text-rose-600 mb-1">تفاصيل العجز:</div>
                                    <div className="flex flex-wrap gap-1">
                                      {tripDeficits.map((d, i) => (
                                        <span key={i} className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-md text-[7px] font-bold">
                                          {d.stageName}: {d.deficit} كرتون
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-50">
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(role === 'center' || isMonitor || isAdmin) && (
        <section className="space-y-8 animate-slideDown">
          {/* قسم التعليم العام */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-4 border-r-4 border-indigo-600">
              <h3 className="text-lg font-black text-indigo-900">📚 مخزون التعليم العام (G)</h3>
              <span className="text-[10px] font-bold text-slate-400">
                {palletTypes.filter(t => t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).length} مرحلة
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {palletTypes.filter(t => t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).map(type => (
                <StageCard key={type.id} type={type} statsRecords={statsRecords} />
              ))}
            </div>
          </div>

          {/* قسم المدارس العالمية */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-4 border-r-4 border-emerald-600">
              <h3 className="text-lg font-black text-emerald-900">🌍 مخزون المدارس العالمية (IG)</h3>
              <span className="text-[10px] font-bold text-slate-400">
                {palletTypes.filter(t => t.stageCode.startsWith('IG')).length} مرحلة
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {palletTypes.filter(t => t.stageCode.startsWith('IG')).map(type => (
                <StageCard key={type.id} type={type} statsRecords={statsRecords} />
              ))}
            </div>
          </div>

          {/* أي مراحل أخرى غير مصنفة */}
          {palletTypes.filter(t => !t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-4 border-r-4 border-slate-400">
                <h3 className="text-lg font-black text-slate-700">📦 مراحل أخرى</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {palletTypes.filter(t => !t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).map(type => (
                  <StageCard key={type.id} type={type} statsRecords={statsRecords} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {role === 'factory' && (
        <div className="space-y-3">
            {currentTripId && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setShowLabels(true)} className="bg-white border-2 border-indigo-200 text-indigo-900 p-5 rounded-[2.5rem] font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm">👁️ استعراض الملصقات</button>
                  <button onClick={() => setIsBatchPrinting(true)} className="bg-indigo-900 text-white p-5 rounded-[2.5rem] font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg">🖨️ طباعة الكل</button>
                </div>
            )}
            <button onClick={() => setShowForm(!showForm)} className="w-full bg-white border-2 border-indigo-600 text-indigo-600 p-6 rounded-[2.5rem] font-black text-sm flex items-center justify-center gap-3 shadow-xl hover:bg-indigo-50 transition-all">{showForm ? 'إلغاء' : '➕ إنشاء رحلة جديدة'}</button>
        </div>
      )}

      {showForm && (
        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border border-slate-100 space-y-6 animate-slideDown">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">الوجهة</label>
              <select value={cCode} onChange={e => setCCode(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                {centerOptions.map(center => <option key={center.id} value={center.code}>{center.displayName}</option>)}
              </select>
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">المطبعة</label>
              <div className="w-full bg-slate-100 p-4 rounded-2xl text-xs font-black text-slate-500 text-center">{getDisplayName(pCode)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">الفصل الدراسي</label>
              <select value={semester} onChange={e => setSemester(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                <option value="1">الفصل الأول</option>
                <option value="2">الفصل الثاني</option>
                <option value="3">الفصل الثالث</option>
              </select>
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">العام الدراسي</label>
              <select value={year} onChange={e => setYear(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                <option value="2026">2026 م</option>
                <option value="2027">2027 م</option>
                <option value="2028">2028 م</option>
                <option value="2029">2029 م</option>
                <option value="2030">2030 م</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 mr-2">تحديد المراحل والكميات</label>
            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto p-2 bg-slate-50 rounded-2xl border border-slate-100 custom-scrollbar">
              {palletTypes.map(type => (
                <div key={type.id} className="flex flex-col gap-2 p-3 bg-white rounded-xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black text-slate-700">{type.stageName}</span>
                      <span className="text-[8px] font-bold text-slate-400">الطبلية: {type.cartonsPerPallet} كرتون</span>
                    </div>
                  </div>
                  <div className="flex justify-between gap-4">
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-indigo-900 border-b border-indigo-100 pb-1 w-full text-center">عدد الطبليات</span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: Math.max(0, ((prev[type.id]?.pallets) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.pallets || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: ((prev[type.id]?.pallets) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-indigo-100 rounded-lg text-indigo-600 font-black"
                        >+</button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-emerald-700 border-b border-emerald-100 pb-1 w-full text-center flex items-center justify-center gap-1">كراتين إضافية <span className="text-[7px] text-emerald-500">(بجانب الطبلية)</span></span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: Math.max(0, ((prev[type.id]?.extraCartons) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.extraCartons || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5 text-emerald-700"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: ((prev[type.id]?.extraCartons) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-emerald-100 rounded-lg text-emerald-700 font-black"
                        >+</button>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-rose-700 border-b border-rose-100 pb-1 w-full text-center flex items-center justify-center gap-1">كراتين ناقصة <span className="text-[7px] text-rose-500">(من الطبلية)</span></span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: Math.max(0, ((prev[type.id]?.missingCartons) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.missingCartons || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5 text-rose-700"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: ((prev[type.id]?.missingCartons) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-rose-100 rounded-lg text-rose-700 font-black"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={handleNewTripSubmit} className="w-full bg-indigo-900 text-white p-6 rounded-[2rem] font-black text-sm shadow-xl active:scale-95 transition-all">إرسال وتجهيز ملصقات المشروع</button>
        </div>
      )}

      {(activeChoiceId || isBatchPrinting) && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl text-center border-4 border-indigo-900">
             <div className="text-4xl mb-2">📐</div>
             <h3 className="text-xl font-black text-slate-800">{isBatchPrinting ? 'طباعة كامل الرحلة' : 'إعدادات الطباعة'}</h3>
             <div className="flex gap-2">
                <button onClick={() => setSelectedSize('3x4')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '3x4' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>3 × 4 إنش</button>
                <button onClick={() => setSelectedSize('10x15')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '10x15' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>10 × 15 سم</button>
             </div>
             <button onClick={() => isBatchPrinting ? handlePrintAllBatch() : handlePrintSingle(activeChoiceId!)} className="w-full bg-indigo-900 text-white p-5 rounded-2xl font-black text-sm active:scale-95 transition-all">بدء الطباعة</button>
             <button onClick={() => { setActiveChoiceId(null); setIsBatchPrinting(false); }} className="w-full bg-slate-100 text-slate-500 p-4 rounded-2xl font-black text-xs">إلغاء</button>
          </div>
        </div>
      )}

      {showLabels && (
        <div className="fixed inset-0 z-[5000] bg-slate-100 flex flex-col animate-fadeIn overflow-hidden">
          <div className="flex flex-col p-6 bg-white border-b shadow-md no-print gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-slate-800">ملصقات الرحلة: #{currentTrip?.tripNumber}</h3>
              <div className="flex gap-2">
                <button onClick={() => setIsBatchPrinting(true)} className="bg-indigo-900 text-white px-4 py-2 rounded-xl font-black text-[10px]">🖨️ طباعة الكل</button>
                <button onClick={() => setShowLabels(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-black text-[10px]">إغلاق</button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 items-center bg-slate-200">
             {currentTripRecords.map(record => (
               <div key={record.id} className="w-full max-w-sm bg-white p-5 rounded-3xl shadow-xl flex justify-between items-center">
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-800">{palletTypes.find(t => t.id === record.palletTypeId)?.stageName}</div>
                    <div className="text-[10px] font-bold text-indigo-600 font-mono">{record.palletBarcode}</div>
                  </div>
                  <button onClick={() => setActiveChoiceId(record.id)} className="bg-indigo-900 text-white px-5 py-3 rounded-2xl font-black text-xs">🖨️ طباعة</button>
               </div>
             ))}
          </div>
        </div>
      )}
    </div>
  );
};

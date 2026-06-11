
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { PalletType, UserCredentials, UserRole, PressCode, CenterCode, SystemLog, Trip, InventoryRecord, DistributionTrip, PalletStatus } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { db, collection, query, orderBy, limit, onSnapshot, setDoc, doc, writeBatch, getDocs, isOffline, triggerOfflineListeners } from '../firebase';
import { createClient } from '@supabase/supabase-js';
import defaultFirebaseConfig from '../firebase-applet-config.json';

interface Props {
  palletTypes: PalletType[];
  users: UserCredentials[];
  onUpdateUsers: (newUsers: UserCredentials[]) => void;
  onUpdate: (type: PalletType) => void;
  onAdd: (type: Omit<PalletType, 'id'>) => void;
  onDelete: (id: string) => void;
  onResetData: () => Promise<void>;
  onResetStages: () => Promise<void>;
  onMigrateData: () => Promise<void>;
  onNotify: (title: string, msg: string) => void;
  allowCentersExport: boolean;
  onToggleCentersExport: (value: boolean) => Promise<void>;
  allowedExportCenters: string[];
  onUpdateAllowedExportCenters: (value: string[]) => Promise<void>;
}

export const Settings: React.FC<Props> = ({ 
  palletTypes, 
  users, 
  onUpdateUsers, 
  onUpdate, 
  onAdd, 
  onDelete, 
  onResetData, 
  onResetStages, 
  onMigrateData, 
  onNotify,
  allowCentersExport,
  onToggleCentersExport,
  allowedExportCenters,
  onUpdateAllowedExportCenters
}) => {
  const [tab, setTab] = useState<'stages' | 'users' | 'logs' | 'database'>('users');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetStagesConfirm, setShowResetStagesConfirm] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<SystemLog[]>([]);
  
  const [dbConfigJson, setDbConfigJson] = useState(() => localStorage.getItem('custom_firebase_config') || '');
  const [offlineMode, setOfflineMode] = useState(() => {
     const saved = localStorage.getItem('force_offline_mode');
     return saved !== null ? saved : 'false';
  });

  const [offlineTripsCount, setOfflineTripsCount] = useState(0);
  const [offlineRecordsCount, setOfflineRecordsCount] = useState(0);
  const [offlineDistCount, setOfflineDistCount] = useState(0);
  const [isSyncingOfflineData, setIsSyncingOfflineData] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [connTestStatus, setConnTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connTestError, setConnTestError] = useState('');

  useEffect(() => {
    try {
      const trips = JSON.parse(localStorage.getItem('offline_col_trips') || '[]');
      const recs = JSON.parse(localStorage.getItem('offline_col_records') || '[]');
      const dists = JSON.parse(localStorage.getItem('offline_col_distribution_trips') || '[]');
      setOfflineTripsCount(trips.length);
      setOfflineRecordsCount(recs.length);
      setOfflineDistCount(dists.length);
    } catch(e) {
      console.warn("Failed to load offline storage counts:", e);
    }
  }, [offlineMode]);

  const handleSaveDatabaseConfig = () => {
    try {
      if (dbConfigJson.trim() !== '') {
        JSON.parse(dbConfigJson); // Validate JSON
        localStorage.setItem('custom_firebase_config', dbConfigJson);
      } else {
        localStorage.removeItem('custom_firebase_config');
      }
      localStorage.setItem('force_offline_mode', offlineMode);
      onNotify('نجاح', 'تم حفظ إعدادات قاعدة البيانات. سيتم إعادة تحميل التطبيق...');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      onNotify('خطأ', 'الصيغة غير صحيحة، يرجى كتابة JSON صالح.');
    }
  };

  const testConnection = async () => {
    setConnTestStatus('testing');
    setConnTestError('');
    try {
      const config = dbConfigJson.trim() !== '' ? JSON.parse(dbConfigJson) : defaultFirebaseConfig;
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('إعدادات Supabase غير مكتملة - يجب توفير supabaseUrl و supabaseAnonKey');
      }
      const testClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
      const checkPromise = testClient.from('config').select('*').limit(1);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('انتهت مهلة الاتصال (4 ثوانٍ) - خادم Supabase غير قابل للوصول')), 4000)
      );
      await Promise.race([checkPromise, timeoutPromise]);
      setConnTestStatus('success');
    } catch (e: any) {
      setConnTestStatus('error');
      const msg = e?.message || String(e);
      setConnTestError(msg);
    }
  };

  const yieldToUI = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  const processSheetInChunks = async (
    ws: XLSX.WorkSheet,
    colMap: Map<string, string>,
    palletTypes: PalletType[],
    stageNameLowerToId: Map<string, string>,
    stageCodeToId: Map<string, string>,
    allTripsMap: Map<string, Trip>,
    allRecords: InventoryRecord[],
    allDistTrips: DistributionTrip[]
  ) => {
    const ref = ws['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    const totalRows = range.e.r;
    const CHUNK = 100;

    // Read header row (row 0)
    const headerRows = XLSX.utils.sheet_to_json(ws, { range: 0, raw: false }) as any[];
    if (headerRows.length === 0) return;
    const firstRow = headerRows[0];

    const hasPalletBarcode = getValCached(firstRow, ['الباركود', 'باركود الطبلية', 'باركود طبلية', 'باركود', 'طبلية', 'barcode', 'pallet barcode', 'palletbarcode', 'id'], colMap) !== undefined;
    const hasTripNumber = getValCached(firstRow, ['رقم الرحلة', 'الرحلة', 'رحلة', 'trip number', 'tripnumber', 'trip', 'id'], colMap) !== undefined;
    
    let hasStageQuantities = false;
    for (const key of Object.keys(firstRow)) {
      const k = key.trim().toLowerCase();
      for (const pt of palletTypes) {
        const name = pt.stageName.trim().toLowerCase();
        const code = pt.stageCode.trim().toLowerCase();
        if (k.includes(name) || name.includes(k) || k === code) {
          hasStageQuantities = true;
          break;
        }
      }
      if (hasStageQuantities) break;
    }

    // Process data rows in chunks (starting from row 1)
    for (let start = 1; start <= totalRows; start += CHUNK) {
      const end = Math.min(start + CHUNK - 1, totalRows);
      const chunkRows = XLSX.utils.sheet_to_json(ws, {
        range: { s: { r: start, c: 0 }, e: { r: end, c: range.e.c } },
        raw: false,
        header: Object.keys(firstRow)
      }) as any[];

      if (hasPalletBarcode) {
        for (const row of chunkRows) {
          const barcodeVal = getValCached(row, ['الباركود', 'باركود الطبلية', 'باركود طبلية', 'باركود', 'طبلية', 'barcode', 'pallet barcode', 'palletbarcode', 'id'], colMap);
          if (!barcodeVal) continue;

          const palletBarcode = String(barcodeVal).trim().toUpperCase();
          let tripIdVal = getValCached(row, ['رقم الرحلة', 'الرحلة', 'رحلة', 'trip id', 'tripid', 'trip number', 'tripnumber', 'trip'], colMap);
          let tripId = tripIdVal ? String(tripIdVal).trim() : '';
          if (tripId) {
            if (/^\d+$/.test(tripId)) tripId = tripId.padStart(4, '0');
          } else {
            tripId = '0001';
          }

          const stageVal = String(getValCached(row, ['المرحلة', 'المرحلة الدراسية', 'كود المرحلة', 'stage', 'stage id', 'stageid', 'pallettype', 'pallet type'], colMap) || '').trim().toLowerCase();
          let palletTypeId = stageNameLowerToId.get(stageVal) || stageCodeToId.get(stageVal) || (stageVal || 'g01');
          if (!palletTypeId || palletTypeId === stageVal) {
            const matchedType = palletTypes.find(pt => 
              pt.id.toLowerCase() === stageVal || 
              pt.stageCode.toLowerCase() === stageVal || 
              pt.stageName.toLowerCase().includes(stageVal) || 
              stageVal.includes(pt.stageName.toLowerCase())
            );
            palletTypeId = matchedType ? matchedType.id : (stageVal || 'g01');
          }

          let pressCode = String(getValCached(row, ['المنشأ', 'المطبعة', 'كود المطبعة', 'press code', 'presscode', 'press', 'origin'], colMap) || '').trim().toUpperCase();
          if (!pressCode) {
            if (palletBarcode.includes('OPK')) pressCode = 'OPK';
            else if (palletBarcode.includes('UNI')) pressCode = 'UNI';
            else pressCode = 'OPK';
          }

          const destination = String(getValCached(row, ['الوجهة', 'المركز', 'كود المركز', 'center code', 'centercode', 'center', 'destination'], colMap) || 'DMM').trim().toUpperCase();

          const statusVal = String(getValCached(row, ['الحالة', 'حالة', 'status', 'state'], colMap) || 'received').trim().toLowerCase();
          let status: PalletStatus = 'received';
          if (statusVal.includes('pending') || statusVal.includes('wait') || statusVal.includes('انتظار') || statusVal.includes('تجهيز') || statusVal.includes('مطبعة') || statusVal.includes('المطبعة') || statusVal.includes('بانتظار')) {
            status = 'pending';
          } else if (statusVal.includes('transit') || statusVal.includes('طريق') || statusVal.includes('منطلق') || statusVal.includes('شحن') || statusVal.includes('سفر')) {
            status = 'in_transit';
          } else if (statusVal.includes('cancelled') || statusVal.includes('cancel') || statusVal.includes('ملغاة') || statusVal.includes('ملغى') || statusVal.includes('ملغيه') || statusVal.includes('الغاء') || statusVal.includes('إلغاء')) {
            status = 'cancelled';
          }

          const extraVal = getValCached(row, ['كراتين إضافية', 'كراتين إضافيا', 'الزيادة', 'extra cartons', 'extracartons', 'extra', 'اضافي', 'إضافي'], colMap);
          const extraCartons = extraVal ? Number(extraVal) : 0;
          const missingVal = getValCached(row, ['كراتين ناقصة', 'كراتين ناقصه', 'النقص', 'missing cartons', 'missingcartons', 'missing', 'ناقص', 'النواقص'], colMap);
          const missingCartons = missingVal ? Number(missingVal) : 0;

          const datePrepVal = getValCached(row, ['تاريخ التجهيز', 'تاريخ الإنشاء', 'تاريخ البدء', 'تاريخ التعبئة', 'creation date', 'createdat'], colMap);
          const dateExitVal = getValCached(row, ['تاريخ الخروج', 'تاريخ الانطلاق', 'تاريخ مغادرة المطبعة', 'departure date', 'exit date'], colMap);
          const dateRecvVal = getValCached(row, ['تاريخ الاستلام', 'تاريخ الوصول', 'تاريخ الاستلام في المركز', 'arrival date', 'received date', 'date', 'timestamp', 'التاريخ', 'تاريخ'], colMap);
          
          const parseDateToMs = (val: any): number | undefined => {
            if (!val) return undefined;
            const d = new Date(val);
            return isNaN(d.getTime()) ? undefined : d.getTime();
          };

          const parsedPrep = parseDateToMs(datePrepVal);
          const parsedExit = parseDateToMs(dateExitVal);
          const parsedRecv = parseDateToMs(dateRecvVal);

          const now = Date.now();
          let timestamp = parsedPrep || now;
          let factoryTimestamp: number | undefined = parsedExit;
          let centerTimestamp: number | undefined = parsedRecv;
          let cancelledAt: number | undefined = undefined;

          if (status === 'received') {
            if (!centerTimestamp) centerTimestamp = parsedRecv || now;
            if (!factoryTimestamp) factoryTimestamp = parsedExit || (centerTimestamp - 4 * 3600 * 1000);
            if (!timestamp) timestamp = parsedPrep || (centerTimestamp - 8 * 3600 * 1000);
          } else if (status === 'in_transit') {
            if (!factoryTimestamp) factoryTimestamp = parsedExit || now;
            if (!timestamp) timestamp = parsedPrep || (factoryTimestamp - 4 * 3600 * 1000);
            centerTimestamp = undefined;
          } else if (status === 'pending') {
            if (!timestamp) timestamp = parsedPrep || now;
            factoryTimestamp = undefined;
            centerTimestamp = undefined;
          } else if (status === 'cancelled') {
            cancelledAt = parsedRecv || now;
            if (!timestamp) timestamp = parsedPrep || (now - 4 * 3600 * 1000);
            factoryTimestamp = undefined;
            centerTimestamp = undefined;
          }

          if (!allTripsMap.has(tripId)) {
            allTripsMap.set(tripId, {
              id: tripId,
              tripNumber: tripId,
              tripBarcode: tripId,
              pressCode,
              centerCode: destination,
              startDate: timestamp,
              status: status === 'received' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'active'
            } as Trip);
          }

          const isReceived = status === 'received';
          allRecords.push({
            id: palletBarcode,
            palletBarcode,
            tripId,
            palletTypeId,
            status,
            timestamp,
            factoryTimestamp,
            centerTimestamp,
            cancelledAt,
            destination,
            receivedByCenter: isReceived ? destination : undefined,
            receivedByUsername: isReceived ? 'النظام (مستورد)' : undefined,
            extraCartons: isNaN(extraCartons) ? 0 : extraCartons,
            missingCartons: isNaN(missingCartons) ? 0 : missingCartons,
            scannedBy: isReceived ? 'center' : 'factory',
            truckId: '1'
          } as InventoryRecord);
        }
        setProcessingProgress(`جاري معالجة الطبليات... ${Math.min(end, totalRows)} / ${totalRows}`);
      } else if (hasTripNumber && hasStageQuantities) {
        for (const row of chunkRows) {
          const tripNumberVal = getValCached(row, ['رقم الرحلة', 'الرحلة', 'رحلة', 'trip number', 'tripnumber', 'trip', 'id'], colMap);
          if (!tripNumberVal) continue;

          const tripNumber = String(tripNumberVal).trim();
          const dateVal = getValCached(row, ['تاريخ', 'تاريخ الرحلة', 'تاريخ الانطلاق', 'التاريخ', 'date'], colMap);
          const date = dateVal ? new Date(dateVal).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
          const destinationCity = String(getValCached(row, ['الوجهة', 'المدينة', 'destination', 'destinationcity', 'city'], colMap) || 'غير محدد').trim();

          const quantities: { palletTypeId: string; cartonCount: number; bundleCount: number; }[] = [];
          for (const pt of palletTypes) {
            const matches = Object.keys(row).filter(key => {
              const k = key.trim().toLowerCase();
              const name = pt.stageName.trim().toLowerCase();
              const code = pt.stageCode.trim().toLowerCase();
              return k.includes(name) || name.includes(k) || k === code;
            });
            if (matches.length > 0) {
              const val = Number(row[matches[0]]);
              if (!isNaN(val) && val > 0) {
                quantities.push({ palletTypeId: pt.id, cartonCount: val, bundleCount: val * pt.bundlesPerCarton });
              }
            }
          }

          allDistTrips.push({
            id: tripNumber,
            tripNumber,
            date,
            originCenter: 'DMM',
            destinationCity,
            status: 'executed',
            quantities,
            executedDate: date,
            executedQuantities: quantities
          } as DistributionTrip);
        }
        setProcessingProgress(`جاري معالجة التوزيع... ${Math.min(end, totalRows)} / ${totalRows}`);
      } else if (hasTripNumber) {
        for (const row of chunkRows) {
          const tripNumberVal = getValCached(row, ['رقم الرحلة', 'الرحلة', 'رحلة', 'trip number', 'tripnumber', 'trip', 'id'], colMap);
          if (!tripNumberVal) continue;

          const tripNumberStr = String(tripNumberVal).trim();
          const tripBarcodeStr = String(getValCached(row, ['باركود الرحلة', 'باركود', 'trip barcode', 'barcode'], colMap) || tripNumberStr).trim();
          const dateVal = getValCached(row, ['تاريخ', 'تاريخ الرحلة', 'التاريخ', 'date', 'start date', 'startdate'], colMap);
          const startDate = dateVal ? new Date(dateVal).getTime() : Date.now();
          const pressCode = String(getValCached(row, ['المطبعة', 'كود المطبعة', 'press code', 'presscode', 'press', 'origin'], colMap) || 'OPK').trim();
          const centerCode = String(getValCached(row, ['المركز', 'كود المركز', 'center code', 'centercode', 'center', 'destination'], colMap) || 'DMM').trim();
          const statusVal = String(getValCached(row, ['الحالة', 'حالة', 'status'], colMap) || 'completed').trim().toLowerCase();
          const status = (statusVal === 'نشط' || statusVal === 'active' || statusVal.includes('transit') || statusVal.includes('طريق')) ? 'active' : 'completed';

          if (!allTripsMap.has(tripNumberStr)) {
            allTripsMap.set(tripNumberStr, {
              id: tripNumberStr, tripNumber: tripNumberStr, tripBarcode: tripBarcodeStr,
              pressCode, centerCode, startDate, status
            } as Trip);
          }
        }
      }

      await yieldToUI();
    }
  };

  const buildColumnMap = (firstRow: any): Map<string, string> => {
    const map = new Map<string, string>();
    for (const key of Object.keys(firstRow)) {
      map.set(key.trim().toLowerCase().replace(/[\s_\-]/g, ''), key);
    }
    return map;
  };

  const getValCached = (row: any, keys: string[], colMap: Map<string, string>) => {
    for (const k of keys) {
      const cleanK = k.trim().toLowerCase().replace(/[\s_\-]/g, '');
      const match = colMap.get(cleanK);
      if (match !== undefined) return row[match];
    }
    for (const k of keys) {
      const cleanK = k.trim().toLowerCase().replace(/[\s_\-]/g, '');
      for (const [colKey, colName] of colMap) {
        if (colKey.includes(cleanK) || cleanK.includes(colKey)) return row[colName];
      }
    }
    return undefined;
  };

  const processUnifiedExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isProcessing) return;

    setIsProcessing(true);
    setProcessingProgress('جاري قراءة ملف الإكسل...');

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const arrayBuffer = evt.target?.result as ArrayBuffer;
      setTimeout(async () => {
        try {
          setProcessingProgress('جاري فك الملف...');
          await yieldToUI();

          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          
          let tripsCount = 0;
          let recordsCount = 0;
          let distTripsCount = 0;

          const allTripsMap = new Map<string, Trip>();
          const allRecords: InventoryRecord[] = [];
          const allDistTrips: DistributionTrip[] = [];

          const stageNameLowerToId = new Map<string, string>();
          const stageCodeToId = new Map<string, string>();
          palletTypes.forEach(pt => {
            stageCodeToId.set(pt.stageCode, pt.id);
            stageNameLowerToId.set(pt.stageName.trim().toLowerCase(), pt.id);
          });

          setProcessingProgress('جاري معالجة البيانات...');
          await yieldToUI();

          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const ref = ws['!ref'];
            if (!ref) continue;

            const headerRows = XLSX.utils.sheet_to_json(ws, { range: 0, raw: false }) as any[];
            if (headerRows.length === 0) continue;
            const colMap = buildColumnMap(headerRows[0]);

            setProcessingProgress(`جاري معالجة الورقة: ${sheetName}...`);
            await yieldToUI();

            await processSheetInChunks(
              ws, colMap, palletTypes,
              stageNameLowerToId, stageCodeToId,
              allTripsMap, allRecords, allDistTrips
            );
          }

          const trips = Array.from(allTripsMap.values());
          
          if (trips.length === 0 && allRecords.length === 0 && allDistTrips.length === 0) {
            throw new Error('لم يتم العثور على أي معلومات صالحة للاستيراد في الملف المرفوع. يرجى التأكد من مطابقة أسماء الأعمدة.');
          }

          setProcessingProgress('جاري حفظ البيانات...');
          await yieldToUI();

          // حفظ البيانات
          if (isOffline()) {
            // الوضع المحلي - حفظ في localStorage (قد يفشل إذا كانت البيانات كبيرة)
            setProcessingProgress('جاري حفظ البيانات محلياً...');
            await yieldToUI();
            const safeMerge = (key: string, items: any[], idField: string) => {
              try {
                const existing = JSON.parse(localStorage.getItem(key) || '[]');
                const map = new Map<string, any>();
                for (const item of existing) map.set(item[idField] || item.id, { ...item });
                for (const item of items) {
                  const mapKey = item[idField] || item.id;
                  if (map.has(mapKey)) {
                    map.set(mapKey, { ...map.get(mapKey), ...item });
                  } else {
                    map.set(mapKey, { ...item });
                  }
                }
                localStorage.setItem(key, JSON.stringify(Array.from(map.values())));
                return true;
              } catch (e: any) {
                if (e.name === 'QuotaExceededError' || e.code === 22 || e.message?.includes('quota')) {
                  throw new Error('مساحة التخزين المحلية غير كافية. يرجى التبديل إلى وضع الاتصال بقاعدة البيانات السحابية لحفظ هذه البيانات.');
                }
                throw e;
              }
            };
            if (trips.length > 0) { safeMerge('offline_col_trips', trips, 'tripNumber'); tripsCount = trips.length; await yieldToUI(); }
            if (allRecords.length > 0) { safeMerge('offline_col_records', allRecords, 'palletBarcode'); recordsCount = allRecords.length; await yieldToUI(); }
            if (allDistTrips.length > 0) { safeMerge('offline_col_distribution_trips', allDistTrips, 'tripNumber'); distTripsCount = allDistTrips.length; await yieldToUI(); }
            triggerOfflineListeners();
          } else {
            // الوضع السحابي - حفظ مباشرة في Firebase (لا نحفظ في localStorage لتفادي تجاوز السعة)
            const chunkSize = 200;
            const saveBatch = async (items: any[], col: string, idField: string, label: string) => {
              for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach((item: any) => batch.set(doc(db, col, item[idField]), item, { merge: true }));
                await batch.commit();
                setProcessingProgress(`جاري حفظ ${label}... ${Math.min(i + chunkSize, items.length)} / ${items.length}`);
                await yieldToUI();
              }
            };
            if (trips.length > 0) { await saveBatch(trips, 'trips', 'tripNumber', 'رحلات المطبعة'); tripsCount = trips.length; }
            if (allRecords.length > 0) { await saveBatch(allRecords, 'records', 'palletBarcode', 'الطبليات'); recordsCount = allRecords.length; }
            if (allDistTrips.length > 0) { await saveBatch(allDistTrips, 'distributionTrips', 'tripNumber', 'التوزيع'); distTripsCount = allDistTrips.length; }
          }

          // تحرير الذاكرة
          (allTripsMap as any).clear();
          allRecords.length = 0;
          allDistTrips.length = 0;

          try {
            setOfflineTripsCount(JSON.parse(localStorage.getItem('offline_col_trips') || '[]').length);
            setOfflineRecordsCount(JSON.parse(localStorage.getItem('offline_col_records') || '[]').length);
            setOfflineDistCount(JSON.parse(localStorage.getItem('offline_col_distribution_trips') || '[]').length);
          } catch(e) {}

          onNotify('نجاح الاستيراد الشامل 🎉', `تم استيراد الملف بنجاح! السجلات المضافة: ${tripsCount} رحلة مصنع، ${recordsCount} طبلية، و ${distTripsCount} رحلة توزيع داخلي.`);
        } catch (err: any) {
          console.error(err);
          onNotify('خطأ في استيراد ملف الإكسل الموحد', err.message || 'يرجى التحقق من صحة الأعمدة والبيانات والامتداد.');
        } finally {
          setIsProcessing(false);
          setProcessingProgress('');
        }
      }, 50);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const downloadUnifiedTemplate = () => {
    // 1. Sheet: "الطبليات" (Pallets)
    const palletsHeaders = [
      {
        'باركود الطبلية': 'OPK-2026-G01-0001',
        'باركود الطبلية (Barcode)': 'OPK-2026-G01-0001',
        'رقم الرحلة': '0001',
        'المرحلة': palletTypes[0]?.stageName || 'الصف الأول الابتدائي',
        'الوجهة': 'DMM',
        'الحالة': 'تم الاستلام',
        'المنشأ': 'OPK',
        'كراتين إضافية': '0',
        'كراتين ناقصة': '0',
        'تاريخ الإنشاء': '2026-06-05 08:30:00'
      },
      {
        'باركود الطبلية': 'OPK-2026-G02-0002',
        'باركود الطبلية (Barcode)': 'OPK-2026-G02-0002',
        'رقم الرحلة': '0001',
        'المرحلة': palletTypes[1]?.stageName || 'الصف الثاني الابتدائي',
        'الوجهة': 'DMM',
        'الحالة': 'في الطريق',
        'المنشأ': 'OPK',
        'كراتين إضافية': '2',
        'كراتين ناقصة': '0',
        'تاريخ الإنشاء': '2026-06-05 08:45:00'
      },
      {
        'باركود الطبلية': 'UNI-2026-G01-0003',
        'باركود الطبلية (Barcode)': 'UNI-2026-G01-0003',
        'رقم الرحلة': '0002',
        'المرحلة': palletTypes[0]?.stageCode || 'G01',
        'الوجهة': 'RYD',
        'الحالة': 'في المطبعة',
        'المنشأ': 'UNI',
        'كراتين إضافية': '0',
        'كراتين ناقصة': '1',
        'تاريخ الإنشاء': '2026-06-08 09:00:00'
      },
      {
        'باركود الطبلية': 'OPK-2026-G01-0004',
        'باركود الطبلية (Barcode)': 'OPK-2026-G01-0004',
        'رقم الرحلة': '0003',
        'المرحلة': palletTypes[0]?.stageName || 'الصف الأول الابتدائي',
        'الوجهة': 'DMM',
        'الحالة': 'ملغاة',
        'المنشأ': 'OPK',
        'كراتين إضافية': '0',
        'كراتين ناقصة': '0',
        'تاريخ الإنشاء': '2026-06-05 10:00:00'
      }
    ];

    // 3. Sheet: "الرموز والمراحل الدراسية المتوفرة"
    const stagesHeaders = palletTypes.map(pt => ({
      'كود المرحلة': pt.stageCode,
      'اسم المرحلة': pt.stageName,
      'الكراتين لكل طبلية': pt.cartonsPerPallet,
      'الحزم لكل كرتونة': pt.bundlesPerCarton
    }));

    // Create Excel Workbook
    const wb = XLSX.utils.book_new();

    const wsInstructions = XLSX.utils.json_to_sheet([
      {
        'الخطوة': '1. تعبئة بيانات الطبليات والمسارات',
        'التعليمات': 'افتح تبويب "الطبليات" واكتب معلومات رحلات المطابع وطبلياتها بدقة. الأعمدة الأساسية هي: (رقم الرحلة، باركود الطبلية، المرحلة الدراسية، الخ).'
      },
      {
        'الخطوة': '2. حالات الطبليات المعتمدة',
        'التعليمات': 'تحت عمود "الحالة" يمكنك تحديد إحدى القيم التالية: "تم الاستلام" (وصول للمركز)، "في الطريق" (خروج من المطبعة)، "في المطبعة" (قيد التجهيز)، أو "ملغاة" (محذوفة وتستثنى تلقائياً من الإحصائيات).'
      },
      {
        'الخطوة': '3. حقول التواريخ والزمن الفعلي',
        'التعليمات': 'الآن يمكنك تحديد التواريخ الخاصة بالمسح بدقة بالغة عبر الأعمدة: "تاريخ التجهيز" (الإنشاء)، "تاريخ الخروج" (مغادرة المطبعة)، و"تاريخ الاستلام" (وصول المركز) لإنشاء سجل تتبع زمني حقيقي لكل طبلية.'
      },
      {
        'الخطوة': '4. ربط المراحل الدراسية',
        'التعليمات': 'تحت عمود "المرحلة الدراسية" في تبويب الطبليات، يمكنك كتابة كود المرحلة (مثل g01) أو اسمها الكامل (مثل الصف الأول الابتدائي) كما هو معرف بالنظام. راجع تبويب "المراحل الدراسية المتاحة" للاطلاع على مسميات المراحل المسجله حالياً.'
      },
      {
        'الخطوة': '5. حفظ ورفع الملف الموحد',
        'التعليمات': 'بعد التعديل، احفظ الملف بالامتداد نفسه (.xlsx)، ثم استخدم زر "اختيار الملف الشامل الموحد" في الإعدادات لرفع كافّة البيانات بضغطة زر واحدة بنظام السجلات المدمجة.'
      }
    ]);

    const wsPallets = XLSX.utils.json_to_sheet(palletsHeaders);
    const wsStages = XLSX.utils.json_to_sheet(stagesHeaders);

    XLSX.utils.book_append_sheet(wb, wsInstructions, 'تعليمات الملف الموحد');
    XLSX.utils.book_append_sheet(wb, wsPallets, 'الطبليات');
    XLSX.utils.book_append_sheet(wb, wsStages, 'المراحل الدراسية المتاحة');

    XLSX.writeFile(wb, 'قالب_البيانات_الموحد_الشامل.xlsx');
    onNotify('تم تنزيل القالب 📥', 'تم إنشاء قالب Excel الموحد بكامل المراحل الدراسية المتاحة بنجاح، جاهز للتعبئة الآن!');
  };

  useEffect(() => {
    if (tab === 'logs') {
      const q = query(collection(db, 'system_logs'), orderBy('timestamp', 'desc'), limit(100));
      const unsub = onSnapshot(q, (snap) => {
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SystemLog)));
      });
      return () => unsub();
    }
  }, [tab]);
  
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormData, setUserFormData] = useState<Omit<UserCredentials, 'id'>>({
    role: 'factory',
    code: 'OPK',
    username: '',
    password: '',
    displayName: ''
  });

  const [showStageForm, setShowStageForm] = useState(false);
  const [editingStage, setEditingStage] = useState<PalletType | null>(null);
  const [stageFormData, setStageFormData] = useState<Omit<PalletType, 'id'>>({
    stageCode: '',
    stageName: '',
    cartonsPerPallet: 24,
    bundlesPerCarton: 5
  });

  const handleOpenUserForm = (user?: UserCredentials) => {
    if (user) { 
      setEditingUserId(user.id); 
      setUserFormData({ role: user.role, code: user.code, username: user.username, password: user.password, displayName: user.displayName }); 
    } else { 
      setEditingUserId(null); 
      setUserFormData({ role: 'factory', code: 'OPK', username: '', password: '', displayName: '' }); 
    }
    setShowUserForm(true);
  };

  const handleSaveUser = () => {
    if (!userFormData.username || !userFormData.password || !userFormData.displayName || !userFormData.code) {
      onNotify('تنبيه', 'يرجى إكمال كافة البيانات');
      return;
    }
    if (!editingUserId && users.some(u => u.username === userFormData.username)) {
      onNotify('تنبيه', 'اسم المستخدم موجود مسبقاً');
      return;
    }
    let newUsers = [...users];
    if (editingUserId) newUsers = newUsers.map(u => u.id === editingUserId ? { ...userFormData, id: editingUserId } : u);
    else newUsers.push({ ...userFormData, id: Date.now().toString() });
    onUpdateUsers(newUsers); 
    setShowUserForm(false);
  };

  const handleOpenStageForm = (stage?: PalletType) => {
    if (stage) {
      setEditingStage(stage);
      setStageFormData({ stageCode: stage.stageCode, stageName: stage.stageName, cartonsPerPallet: stage.cartonsPerPallet, bundlesPerCarton: stage.bundlesPerCarton || 5 });
    } else {
      setEditingStage(null);
      setStageFormData({ stageCode: '', stageName: '', cartonsPerPallet: 24, bundlesPerCarton: 5 });
    }
    setShowStageForm(true);
  };

  const handleSaveStage = () => {
    if (!stageFormData.stageName || !stageFormData.stageCode) {
      onNotify('تنبيه', 'يرجى إكمال بيانات المرحلة');
      return;
    }
    if (editingStage) onUpdate({ ...stageFormData, id: editingStage.id });
    else onAdd(stageFormData);
    setShowStageForm(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <ConfirmModal isOpen={showResetConfirm} title="تصفير البيانات" message="سيتم حذف رحلات التوزيع وسجلات المخزون فقط بشكل نهائي من السحابة. (المراحل والحسابات ستبقى كما هي). هل أنت متأكد؟" type="danger" onConfirm={async () => { setShowResetConfirm(false); await onResetData(); }} onCancel={() => setShowResetConfirm(false)} />
      <ConfirmModal isOpen={showResetStagesConfirm} title="إعادة تهيئة المراحل" message="سيتم حذف كافة المراحل الحالية واستبدالها بالمراحل الافتراضية للتعليم العام والعالمي. هل أنت متأكد؟" type="danger" onConfirm={async () => { setShowResetStagesConfirm(false); await onResetStages(); }} onCancel={() => setShowResetStagesConfirm(false)} />
      <ConfirmModal isOpen={!!showDeleteUserConfirm} title="حذف مستخدم" message="هل تريد حذف هذا الحساب؟ لن يتمكن المستخدم من الدخول بعد الآن." type="danger" onConfirm={() => { onUpdateUsers(users.filter(u => u.id !== showDeleteUserConfirm)); setShowDeleteUserConfirm(null); }} onCancel={() => setShowDeleteUserConfirm(null)} />
      
      <div className="flex bg-slate-200/50 p-1.5 rounded-3xl gap-1 sticky top-0 z-10 backdrop-blur-md overflow-x-auto">
        <button onClick={() => setTab('stages')} className={`min-w-fit px-3 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'stages' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>📚 المراحل</button>
        <button onClick={() => setTab('users')} className={`min-w-fit px-3 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'users' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>👤 المستخدمين</button>
        <button onClick={() => setTab('database')} className={`min-w-fit px-3 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'database' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>⚙️ قاعدة البيانات</button>
        <button onClick={() => setTab('logs')} className={`min-w-fit px-3 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'logs' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>🚨 السجل</button>
      </div>

      <div className="px-4 space-y-4">
        {/* بطاقة التحكم بصلاحيات النظام */}
        <div className="bg-white border border-slate-150 p-6 rounded-[2rem] shadow-sm space-y-4 text-right">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🔐</span>
              <h3 className="font-black text-slate-800 text-xs">صلاحيات وأمن النظام</h3>
            </div>
            <span className="bg-indigo-50 text-indigo-700 text-[9px] font-bold px-2.5 py-1 rounded-full border border-indigo-100">تحكم فوري</span>
          </div>
          
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-100/70">
            <div className="text-right flex-1 pl-4">
              <span className="text-xs font-black text-slate-800 block">السماح لجميع مراكز الاستلام بالجرد الصادر</span>
              <span className="text-[9px] text-slate-500 block mt-1 font-bold">عند تفعيلها، سيتمكن موظفو كافة المراكز من جرد الكراتين عبر حساباتهم.</span>
            </div>
            
            {/* Toggle Switch */}
            <button 
              onClick={() => onToggleCentersExport(!allowCentersExport)}
              className={`w-12 h-6.5 rounded-full p-0.5 transition-colors duration-200 outline-none ${allowCentersExport ? 'bg-indigo-600' : 'bg-slate-300'} relative cursor-pointer shrink-0`}
            >
              <div 
                className={`bg-white w-5.5 h-5.5 rounded-full shadow transition-transform duration-200 absolute top-0.5 left-0.5 ${allowCentersExport ? 'translate-x-[22px]' : 'translate-x-0'}`} 
              />
            </button>
          </div>

          {/* تفعيل الجرد لمراكز محددة */}
          <div className="border-t border-slate-100 pt-4 mt-2 text-right">
            <span className="text-[11px] font-black text-slate-700 block mb-3">أو تفعيل صلاحية الجرد الصادر لمراكز محددة بالتفصيل:</span>
            
            {(() => {
              const centersMap = new Map<string, string>();
              users.forEach(u => {
                if (u.role === 'center' && u.code) {
                  centersMap.set(u.code, u.locationName || u.displayName || u.code);
                }
              });
              const centers = Array.from(centersMap.entries()).map(([code, name]) => ({ code, name }));

              if (centers.length === 0) {
                return (
                  <div className="text-center py-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block">لا توجد حسابات مراكز استلام مضافة حالياً</span>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {centers.map(center => {
                    const isAllowed = allowCentersExport || (allowedExportCenters || []).includes(center.code);
                    return (
                      <div 
                        key={center.code} 
                        className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                          isAllowed 
                            ? 'bg-indigo-50/40 border-indigo-100 text-indigo-900 shadow-sm' 
                            : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-right pl-2">
                          <span className="text-[11px] font-extrabold block leading-tight">{center.name}</span>
                          <span className="text-[9px] font-bold text-slate-400 block mt-0.5">كود: {center.code}</span>
                        </div>
                        
                        <button 
                          disabled={allowCentersExport}
                          onClick={async () => {
                            let newAllowed = [...(allowedExportCenters || [])];
                            if (newAllowed.includes(center.code)) {
                              newAllowed = newAllowed.filter(c => c !== center.code);
                            } else {
                              newAllowed.push(center.code);
                            }
                            await onUpdateAllowedExportCenters(newAllowed);
                          }}
                          className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none ${
                            isAllowed 
                              ? (allowCentersExport ? 'bg-indigo-200 cursor-not-allowed' : 'bg-indigo-600 cursor-pointer') 
                              : 'bg-slate-200 cursor-pointer'
                          } relative shrink-0`}
                        >
                          <div 
                            className={`bg-white w-4.5 h-4.5 rounded-full shadow transition-transform duration-200 absolute top-0.5 left-0.5 ${
                              isAllowed ? 'translate-x-[18px]' : 'translate-x-0'
                            }`} 
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        <button onClick={() => setShowResetConfirm(true)} className="w-full bg-rose-50 text-rose-600 p-4 rounded-2xl border border-rose-100 font-black text-xs active:scale-95 transition-all mb-4">🗑️ تصفير كافة البيانات السحابية</button>
      </div>

      {tab === 'logs' && (
        <div className="space-y-4 animate-fadeIn px-2">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-sm font-black text-slate-800">سجل أخطاء النظام الحية</h2>
            <span className="text-[10px] font-bold text-slate-400">آخر 100 خطأ</span>
          </div>
          <div className="space-y-3">
             {logs.length === 0 ? (
                <div className="text-center p-8 bg-slate-50 rounded-3xl">
                   <p className="text-slate-400 font-bold text-xs">لا توجد أخطاء مسجلة حالياً</p>
                </div>
             ) : (
                logs.map(log => (
                  <div key={log.id} className={`p-4 rounded-3xl border-2 flex flex-col gap-2 ${log.type === 'login_error' ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100'}`}>
                    <div className="flex justify-between items-center">
                       <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${log.type === 'login_error' ? 'bg-amber-200 text-amber-800' : 'bg-rose-200 text-rose-800'}`}>
                           {log.type === 'login_error' ? 'دخول خاطئ' : 'مسح الباركود'}
                       </span>
                       <span className="text-[10px] font-bold text-slate-500" dir="ltr">
                          {new Date(log.timestamp).toLocaleString('en-GB')}
                       </span>
                    </div>
                    <div>
                       <h4 className="text-xs font-black text-slate-800">{log.message}</h4>
                       <p className="text-[10px] font-bold text-slate-600 mt-1">{log.details}</p>
                    </div>
                    <div className="text-[10px] font-bold text-indigo-600 bg-white/50 w-fit px-2 py-1 rounded-md mt-1">
                       مُنفذ بواسطة: {log.userId}
                    </div>
                  </div>
                ))
             )}
          </div>
        </div>
      )}

      {tab === 'database' && (
        <div className="space-y-4 animate-fadeIn px-4">
          <div className="bg-white border-2 border-indigo-100 p-6 rounded-[2rem] shadow-sm space-y-4 text-right">
            <h3 className="text-sm font-black text-indigo-900 mb-2">ربط قاعدة بيانات جديدة</h3>
            <p className="text-[10px] font-bold text-slate-500 mb-4">انسخ إعدادات Firebase بصيغة JSON والصقها هنا للاتصال بقاعدة بيانات مختلفة (مشروع جديد). للحذف والعودة للافتراضي اترك الحقل فارغاً.</p>
            
            <textarea
              value={dbConfigJson}
              onChange={e => setDbConfigJson(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl text-[10px] font-mono h-32 outline-none focus:ring-2 ring-indigo-500 text-left"
              placeholder={`{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "...",\n  ...\n}`}
              dir="ltr"
            />
            
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 mt-4">
               <div>
                  <span className="text-xs font-black text-slate-800 block">تشغيل الوضع المحلي (Offline Simulation)</span>
                  <span className="text-[9px] text-slate-500 font-bold block mt-1">عند تفعيله لن يتصل بالإنترنت تفادياً لمشكلة الحظر</span>
               </div>
               <button 
                  onClick={() => setOfflineMode(offlineMode === 'true' ? 'false' : 'true')}
                  className={`w-12 h-6.5 rounded-full p-0.5 transition-colors duration-200 outline-none ${offlineMode === 'true' ? 'bg-indigo-600' : 'bg-slate-300'} relative cursor-pointer shrink-0`}
                >
                  <div className={`bg-white w-5.5 h-5.5 rounded-full shadow transition-transform duration-200 absolute top-0.5 left-0.5 ${offlineMode === 'true' ? 'translate-x-[22px]' : 'translate-x-0'}`} />
                </button>
            </div>

            <button onClick={handleSaveDatabaseConfig} className="w-full bg-indigo-600 text-white p-4 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-md">
              💾 حفظ التعديلات وإعادة التشغيل
            </button>

            <div className="flex gap-2">
              <button
                onClick={testConnection}
                disabled={connTestStatus === 'testing'}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 p-3.5 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {connTestStatus === 'testing' ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                    جاري الاختبار...
                  </span>
                ) : '🔌 اختبار الاتصال بالسحابة'}
              </button>
              <button
                onClick={() => {
                  if (connTestStatus === 'success') {
                    setConnTestStatus('idle');
                    setConnTestError('');
                  }
                }}
                className="px-4 bg-slate-50 hover:bg-slate-100 text-slate-400 rounded-2xl font-black text-xs active:scale-95 transition-all"
              >
                إلغاء
              </button>
            </div>

            {connTestStatus === 'success' && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-right">
                <span className="text-lg">✅</span>
                <div>
                  <span className="text-[11px] font-black text-emerald-800 block">تم الاتصال بنجاح 🎉</span>
                  <span className="text-[10px] font-bold text-emerald-600 block mt-0.5">خادم Firebase متاح ويعمل بشكل طبيعي</span>
                </div>
              </div>
            )}

            {connTestStatus === 'error' && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-right">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg mt-0.5">❌</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-black text-red-800 block">فشل الاتصال</span>
                    <span className="text-[10px] font-bold text-red-600 block mt-0.5 break-words whitespace-pre-wrap">{connTestError}</span>
                  </div>
                </div>
              </div>
            )}

            {offlineMode === 'false' && (offlineTripsCount > 0 || offlineRecordsCount > 0 || offlineDistCount > 0) && (
              <div className="p-5 bg-amber-50/70 border border-amber-200 rounded-[2rem] flex flex-col gap-3 mt-4 text-right shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="text-xl">☁️</span>
                  <div className="flex-1">
                    <h4 className="text-xs font-black text-amber-900 leading-tight">مزامنة البيانات غير المرفوعة لسحابة Firebase الحالية</h4>
                    <p className="text-[10px] text-amber-700 font-bold mt-1.5 leading-relaxed">
                      يوجد لديك بيانات محفوظة محلياً بالوضع دون اتصال: 
                      {offlineTripsCount > 0 && <span className="mx-1"><strong>{offlineTripsCount}</strong> رحلة شحن و</span>} 
                      {offlineRecordsCount > 0 && <span className="mx-1"><strong>{offlineRecordsCount}</strong> طبليات كتب و</span>}
                      {offlineDistCount > 0 && <span className="mx-1"><strong>{offlineDistCount}</strong> رحلات توزيع</span>}
                      . يمكنك الآن رفع هذه البيانات محلياً ودمجها بالكامل مع قاعدة بياناتك السحابية النشطة الحالية لتجنيب ضياع السجلات.
                    </p>
                  </div>
                </div>
                {isSyncingOfflineData && syncProgress && (
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    <span className="text-[10px] font-bold text-amber-800">{syncProgress}</span>
                  </div>
                )}
                <button 
                  type="button"
                  disabled={isSyncingOfflineData}
                  onClick={async () => {
                    try {
                      setIsSyncingOfflineData(true);
                      setSyncProgress('جاري تحميل البيانات المحلية...');
                      onNotify('جاري المزامنة مع السحابة ☁️', 'يرجى البقاء متصلاً بالإنترنت وعدم إغلاق الصفحة حتي نرفع السجلات محلياً...');
                      await yieldToUI();
                      
                      const tList: Trip[] = JSON.parse(localStorage.getItem('offline_col_trips') || '[]');
                      const rList: InventoryRecord[] = JSON.parse(localStorage.getItem('offline_col_records') || '[]');
                      const dList: DistributionTrip[] = JSON.parse(localStorage.getItem('offline_col_distribution_trips') || '[]');
                      
                      // معرفة السجلات الموجودة مسبقاً في قاعدة البيانات لتخطيها
                      setSyncProgress('جاري التحقق من السجلات المرفوعة مسبقاً...');
                      await yieldToUI();
                      const [tripsSnap, recsSnap, distSnap] = await Promise.all([
                        getDocs(collection(db, 'trips')),
                        getDocs(collection(db, 'records')),
                        getDocs(collection(db, 'distributionTrips'))
                      ]);
                      const existingTrips = new Set(tripsSnap.docs.map((d: any) => d.id));
                      const existingRecs = new Set(recsSnap.docs.map((d: any) => d.id));
                      const existingDist = new Set(distSnap.docs.map((d: any) => d.id));
                      
                      const newTrips = tList.filter(t => !existingTrips.has(t.tripNumber));
                      const newRecords = rList.filter(r => !existingRecs.has(r.palletBarcode));
                      const newDist = dList.filter(d => !existingDist.has(d.tripNumber));
                      const skipped = (tList.length - newTrips.length) + (rList.length - newRecords.length) + (dList.length - newDist.length);
                      
                      const total = newTrips.length + newRecords.length + newDist.length;
                      let done = 0;
                      
                      const chunkSize = 200;
                      const saveChunk = async (items: any[], collection: string, keyField: string) => {
                        for (let i = 0; i < items.length; i += chunkSize) {
                          const chunk = items.slice(i, i + chunkSize);
                          const batch = writeBatch(db);
                          chunk.forEach((item: any) => {
                            batch.set(doc(db, collection, item[keyField]), item, { merge: true });
                          });
                          await batch.commit();
                          done += chunk.length;
                          const pct = total > 0 ? Math.round((done / total) * 100) : 100;
                          setSyncProgress(`جاري الرفع للسحابة... ${pct}% (${Math.min(done, total)} / ${total})`);
                          await yieldToUI();
                        }
                      };
                      
                      if (newTrips.length > 0) await saveChunk(newTrips, 'trips', 'tripNumber');
                      if (newRecords.length > 0) await saveChunk(newRecords, 'records', 'palletBarcode');
                      if (newDist.length > 0) await saveChunk(newDist, 'distributionTrips', 'tripNumber');
                      
                      onNotify('نجاح المزامنة والتحديث 🎉', `تم بنجاح مزامنة ورفع: ${newTrips.length} رحلة، ${newRecords.length} طبلية، و${newDist.length} رحلة توزيع. (تخطي ${skipped} موجودة مسبقاً)`);
                      setOfflineTripsCount(0);
                      setOfflineRecordsCount(0);
                      setOfflineDistCount(0);
                    } catch (syncErr: any) {
                      console.error(syncErr);
                      onNotify('فشل في المزامنة والسحابة 🔌', `تعذر مزامنة السجلات لقاعدة البيانات النشطة. الرجاء مراجعة الإعدادات أو المحاولة لاحقاً.\nالخطأ: ${syncErr.message || syncErr}`);
                    } finally {
                      setIsSyncingOfflineData(false);
                      setSyncProgress('');
                    }
                  }}
                  className={`w-full py-3 rounded-2xl font-black text-[11px] transition-all shadow-md ${
                    isSyncingOfflineData 
                      ? 'bg-amber-100 text-amber-400 cursor-not-allowed animate-pulse shadow-none' 
                      : 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95'
                  }`}
                >
                  {isSyncingOfflineData ? 'جاري المزامنة والرفع...' : '🚀 ابدأ عملية رفع ومزامنة السجلات محلياً للسحابية'}
                </button>
              </div>
            )}

            <div className="pt-6 border-t border-slate-100 space-y-4">
                <h3 className="text-sm font-black text-indigo-950 mb-1">📥 استيراد ملف البيانات الشامل الموحد (Excel Workbook) 📄</h3>
                <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                  لتسهيل إعداد النظام بضغطة زر واحدة وتوليد جميع الاحصائيات والتقارير تلقائياً وتلافي انقطاع قواعد البيانات البعيدة، يمكنك رفع ملف Excel واحد يحتوي على تبويب أو أكثر للطبليات والتوزيع.
                </p>

                <div className="bg-indigo-50/50 p-5 rounded-3xl border border-indigo-100 flex flex-col gap-4 text-right">
                  <div>
                    <span className="text-[11px] font-black text-indigo-950 block mb-1">📋 مواصفات الملف الشامل لتشغيل كافة الخصائص والاحصائيات:</span>
                    <ul className="text-[10px] font-bold text-slate-600 space-y-2 list-disc list-inside mt-2 leading-relaxed">
                      <li>
                        <strong className="text-indigo-900">تبويب الطبليات (الاسم: الطبليات أو Pallets) :</strong> 
                        يربط الطبليات برحلات المطبعة تلقائياً. الأعمدة المطلوبة: 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">رقم الرحلة</code>، 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">باركود الطبلية</code>، 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">المرحلة الدراسية</code>، 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">الوجهة (المركز)</code>.
                        (يمكن أيضاً تضمين اختياري: <code className="bg-white px-1 py-0.5 rounded border text-[9px]">كراتين إضافية</code>, <code className="bg-white px-1 py-0.5 rounded border text-[9px]">كراتين ناقصة</code>, <code className="bg-white px-1 py-0.5 rounded border text-[9px]">الحالة</code>).
                      </li>
                      <li>
                        <strong className="text-indigo-900">تبويب رحلات التوزيع (الاسم: التوزيع أو Distributions) :</strong> 
                        لتوليد إحصائيات التوزيع في الميدان والمطابقة الفورية الصادرة لمراكز التسليم الفرعية. الأعمدة المطلوبة: 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">رقم الرحلة</code>، 
                        <code className="bg-white px-1.5 py-0.5 rounded border text-indigo-700 font-mono text-[9px] mx-1">الوجهة (المدينة)</code>، 
                        وأعمدة إضافية بأسماء المراحل والكميات مثل (<code className="bg-white px-1 py-0.5 rounded border text-[9px]">الصف الأول الابتدائي</code>، إلخ).
                      </li>
                    </ul>
                  </div>

                  {isProcessing && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center gap-3">
                      <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span className="text-[11px] font-bold text-amber-800">{processingProgress}</span>
                    </div>
                  )}

                  <div className="bg-white/80 border border-indigo-100/80 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-right">
                    <div className="flex-1">
                      <span className="text-[11px] font-black text-indigo-950 block">📄 تنزيل القالب الموحد لتعبئة بياناتك:</span>
                      <span className="text-[10px] text-indigo-700 font-bold block mt-0.5 leading-relaxed">
                        قالب إكسل مجهّز مسبقاً بالأعمدة المطلوبة وتنسيقات المراحل الدراسية لتبسيط العمل وتعبئة البيانات بضغطة زر.
                      </span>
                    </div>
                    <button 
                      type="button"
                      onClick={downloadUnifiedTemplate}
                      className="bg-indigo-50 hover:bg-indigo-100/90 text-indigo-700 px-4.5 py-3 rounded-xl font-black text-xs border border-indigo-100 active:scale-95 transition-all text-center shrink-0 w-full sm:w-auto flex items-center justify-center gap-1.5"
                    >
                      📥 تنزيل قالب Excel فارغ
                    </button>
                  </div>

                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 mt-2 pt-4 border-t border-indigo-100/60">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 font-bold block leading-relaxed">
                        * سيتعرف النظام تلقائياً على بنية الملف ويدرج كافة السجلات لتبدأ لوحة التحكم بعرض الرسوم البيانية ونسب الاستلام والصرف فوراً وبدون تكرار.
                      </span>
                    </div>
                    <label className={`${isProcessing ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer active:scale-95'} text-white px-6 py-3.5 rounded-2xl font-black text-xs shadow-md shadow-indigo-100 flex items-center justify-center transition-all text-center shrink-0 w-full md:w-auto`}>
                      {isProcessing ? '⏳ جاري المعالجة...' : '📁 اختيار الملف الشامل الموحد'}
                      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={processUnifiedExcelUpload} disabled={isProcessing} />
                    </label>
                  </div>
                </div>
            </div>

            <div className="pt-6 border-t border-slate-100 space-y-4">
                <h3 className="text-sm font-black text-indigo-900 mb-2">النسخ الاحتياطي والمزامنة (JSON) 🔄</h3>
                <p className="text-[10px] font-bold text-slate-500 mb-4">في حال أردت الانتقال لقاعدة بيانات أخرى، قم أولاً بتحميل البيانات الاحتياطية (Export) ثم توجه للقاعدة الجديدة وارفع الملف (Import).</p>
                <div className="grid grid-cols-2 gap-2">
                   <button 
                      onClick={() => {
                         const rawCols = ['users', 'palletTypes', 'config', 'trips', 'records', 'inventory_records'].reduce((acc, col) => {
                            acc[col] = localStorage.getItem(`offline_col_${col}`) || '[]';
                            return acc;
                         }, {} as any);
                         const blob = new Blob([JSON.stringify(rawCols)], {type: 'application/json'});
                         const url = URL.createObjectURL(blob);
                         const a = document.createElement('a');
                         a.href = url;
                         a.download = `backup_db_${Date.now()}.json`;
                         a.click();
                      }}
                      className="bg-slate-100 text-slate-700 p-4 rounded-2xl font-black text-xs border border-slate-200 shadow-sm active:scale-95"
                   >
                     ⬇️ تنزيل نسخة (JSON)
                   </button>
                   <label className="bg-indigo-50 text-indigo-700 p-4 rounded-2xl font-black text-xs border border-indigo-100 shadow-sm flex items-center justify-center cursor-pointer active:scale-95">
                     ⬆️ استيراد ومزامنة
                     <input type="file" accept=".json" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (e) => {
                           try {
                              const data = JSON.parse(e.target?.result as string);
                              Object.keys(data).forEach(col => {
                                 localStorage.setItem(`offline_col_${col}`, data[col]);
                              });
                              onNotify('نجاح', 'تمت مزامنة واستيراد البيانات. يرجى الانتظار...');
                              setTimeout(() => window.location.reload(), 1500);
                           } catch(err) {
                              onNotify('خطأ', 'ملف النسخة الاحتياطية غير صالح.');
                           }
                        };
                        reader.readAsText(file);
                     }} />
                   </label>
                </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex justify-between items-center px-4">
            <h2 className="text-sm font-black text-slate-800">إدارة الحسابات المسموح لها</h2>
            <button onClick={() => handleOpenUserForm()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md">+ حساب جديد</button>
          </div>
          <div className="grid gap-3">
            {users.map(u => (
              <div key={u.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group hover:border-indigo-200 transition-all">
                <div className="text-right">
                  <h3 className="text-xs font-black text-slate-800">{u.displayName}</h3>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 uppercase tracking-widest">{u.role}</span>
                    <span className="text-[8px] font-bold text-slate-400">كود: {u.code}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => handleOpenUserForm(u)} className="p-2 text-indigo-400 hover:bg-indigo-50 rounded-lg">✏️</button>
                   {u.code !== 'ADMIN' && <button onClick={() => setShowDeleteUserConfirm(u.id)} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg">🗑️</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'stages' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex justify-between items-center px-4">
            <h2 className="text-sm font-black text-slate-800">إدارة المراحل والطبليات</h2>
            <div className="flex gap-2">
              <button onClick={() => setShowResetStagesConfirm(true)} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-[10px] font-black border border-rose-100 shadow-sm">🔄 إعادة تهيئة</button>
              <button onClick={() => handleOpenStageForm()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md">+ مرحلة جديدة</button>
            </div>
          </div>
          <div className="grid gap-3">
            {palletTypes.map(t => (
              <div key={t.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group">
                <div className="text-right">
                  <h3 className="text-xs font-black text-slate-800">{t.stageName}</h3>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 uppercase">كود: {t.stageCode}</span>
                    <span className="text-[8px] font-bold text-slate-400">{t.cartonsPerPallet} كرتون | {t.bundlesPerCarton} حزمة/كرتون</span>
                  </div>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => handleOpenStageForm(t)} className="p-2 text-indigo-400 hover:bg-indigo-50 rounded-lg">✏️</button>
                   <button onClick={() => onDelete(t.id)} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* نموذج تعديل مرحلة معدل ليشمل عدد الحزم */}
      {showStageForm && (
        <div className="fixed inset-0 z-[7000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl relative">
              <h3 className="text-lg font-black text-slate-800">{editingStage ? 'تعديل المرحلة' : 'إضافة مرحلة كتب جديدة'}</h3>
              <div className="space-y-3">
                <input type="text" value={stageFormData.stageName} onChange={e => setStageFormData({...stageFormData, stageName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المرحلة (مثلاً: الصف الأول الابتدائي)" />
                <div className="grid grid-cols-1 gap-2">
                   <input type="text" value={stageFormData.stageCode} onChange={e => setStageFormData({...stageFormData, stageCode: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="كود المرحلة (مثلاً: G01)" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 block mr-2">كرتون / طبلية</label>
                      <input type="number" value={stageFormData.cartonsPerPallet} onChange={e => setStageFormData({...stageFormData, cartonsPerPallet: parseInt(e.target.value) || 0})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكراتين" />
                   </div>
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 block mr-2">حزمة / كرتون</label>
                      <input type="number" value={stageFormData.bundlesPerCarton} onChange={e => setStageFormData({...stageFormData, bundlesPerCarton: parseInt(e.target.value) || 0})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الحزم" />
                   </div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveStage} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ المرحلة</button>
                 <button onClick={() => setShowStageForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}

      {/* ... (rest of Settings form stay same) */}
      {showUserForm && (
        <div className="fixed inset-0 z-[7000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl relative">
              <h3 className="text-lg font-black text-slate-800">{editingUserId ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h3>
              <div className="space-y-3">
                <input type="text" value={userFormData.displayName} onChange={e => setUserFormData({...userFormData, displayName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الاسم المعروض للموظف (مثلاً: أحمد - مشرف الوردية)" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={userFormData.username} onChange={e => setUserFormData({...userFormData, username: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المستخدم" />
                  <input type="password" value={userFormData.password} onChange={e => setUserFormData({...userFormData, password: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="كلمة المرور" />
                </div>
                {userFormData.role !== 'monitor' && (
                  <input type="text" value={userFormData.locationName || ''} onChange={e => setUserFormData({...userFormData, locationName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المركز أو المطبعة الفعلي (اكتبه لمرة واحدة ليظهر للجميع)" />
                )}
                <div className="grid grid-cols-2 gap-2">
                   <select value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value as UserRole, code: e.target.value === 'center' ? 'DMM' : e.target.value === 'factory' ? 'OPK' : 'STATS'})} className="bg-slate-50 p-4 rounded-xl text-xs font-black outline-none border border-slate-100">
                      <option value="factory">مطبعة</option>
                      <option value="center">مركز استلام</option>
                      <option value="monitor">مراقب/مسئول</option>
                   </select>
                   
                   {userFormData.role === 'center' ? (
                     <div className="relative">
                       <select 
                         value={['DMM', 'RYD', 'JED'].includes(userFormData.code) ? userFormData.code : userFormData.code ? 'OTHER' : 'DMM'} 
                         onChange={e => setUserFormData({...userFormData, code: e.target.value === 'OTHER' ? '' : e.target.value})} 
                         className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none"
                       >
                         <option value="DMM">مركز الدمام (DMM)</option>
                         <option value="RYD">مركز الرياض (RYD)</option>
                         <option value="JED">مركز جدة (JED)</option>
                         <option value="OTHER">مركز آخر (إدخال يدوي)</option>
                       </select>
                       {!['DMM', 'RYD', 'JED'].includes(userFormData.code) && (
                         <input 
                           type="text" 
                           value={userFormData.code} 
                           onChange={e => setUserFormData({...userFormData, code: e.target.value})} 
                           placeholder="أدخل كود المركز الجديد" 
                           className="absolute inset-0 bg-white p-4 rounded-xl text-xs font-bold border border-indigo-500 outline-none w-full" 
                           autoFocus
                         />
                       )}
                     </div>
                   ) : userFormData.role === 'factory' ? (
                     <div className="relative">
                       <select 
                         value={['OPK', 'UNI'].includes(userFormData.code) ? userFormData.code : userFormData.code ? 'OTHER' : 'OPK'} 
                         onChange={e => setUserFormData({...userFormData, code: e.target.value === 'OTHER' ? '' : e.target.value})} 
                         className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none"
                       >
                         <option value="OPK">مطبعة العبيكان (OPK)</option>
                         <option value="UNI">المطبعة المتحدة (UNI)</option>
                         <option value="OTHER">مطبعة أخرى (إدخال يدوي)</option>
                       </select>
                       {!['OPK', 'UNI'].includes(userFormData.code) && (
                         <input 
                           type="text" 
                           value={userFormData.code} 
                           onChange={e => setUserFormData({...userFormData, code: e.target.value})} 
                           placeholder="أدخل كود المطبعة الجديد" 
                           className="absolute inset-0 bg-white p-4 rounded-xl text-xs font-bold border border-indigo-500 outline-none w-full" 
                           autoFocus
                         />
                       )}
                     </div>
                   ) : (
                     <input type="text" value={userFormData.code} onChange={e => setUserFormData({...userFormData, code: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكود (ADMIN, الخ)" />
                   )}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveUser} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ</button>
                 <button onClick={() => setShowUserForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

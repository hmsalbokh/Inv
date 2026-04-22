
export type UserRole = 'factory' | 'center' | 'monitor';
// جعل الأكواد مرنة لتقبل أي قيم جديدة مضافة من الإعدادات
export type PressCode = string;
export type CenterCode = string;
export type PalletStatus = 'pending' | 'in_transit' | 'received' | 'cancelled';
export type PalletCondition = 'intact' | 'damaged' | 'external_box_damage' | 'internal_content_damage' | 'both';

export interface UserCredentials {
  id: string;
  role: UserRole;
  code: string; // كود المنشأة (مثلاً: OPK, RYD, KSA_01)
  locationName?: string; // اسم المنشأة (مثلاً: مركز الرياض)
  username: string;
  password: string;
  displayName: string; // اسم الموظف
}

export interface PalletType {
  id: string;
  stageCode: string;
  stageName: string;
  cartonsPerPallet: number;
  bundlesPerCarton: number;
}

export interface InventoryRecord {
  id: string;
  palletTypeId: string;
  palletBarcode: string;
  tripId: string;
  truckId: string;
  status: PalletStatus;
  timestamp: number; 
  factoryTimestamp?: number; 
  centerTimestamp?: number; 
  scannedBy: UserRole;
  destination: CenterCode;
  condition?: PalletCondition;
  externalDamageQty?: number; 
  internalDamageQty?: number; 
  photos?: string[];
  notes?: string;
  damageDetails?: string; 
  hasDiscrepancy?: boolean;
  discrepancyType?: 'shortage' | 'excess';
  discrepancyCartonsQty?: number;
  discrepancyBundlesQty?: number;
  extraCartons?: number;
  missingCartons?: number;
  isExtraOnly?: boolean;
  localOnly?: boolean; 
}

export interface Trip {
  id: string;
  tripNumber: string;
  tripBarcode: string;
  pressCode: PressCode;
  centerCode: CenterCode;
  startDate: number;
  status: 'active' | 'completed' | 'cancelled';
}

export interface DistributionTrip {
  id: string;
  tripNumber: string;
  date: string; // YYYY-MM-DD
  originCenter: CenterCode;
  destinationCity: string;
  quantities: {
    palletTypeId: string;
    cartonCount: number;
    bundleCount: number;
  }[];
  status: 'planned' | 'dispatched';
}

export interface SystemLog {
  id: string;
  timestamp: number;
  type: 'login_error' | 'scan_error' | 'system_error';
  userId?: string;
  message: string;
  details: string;
}

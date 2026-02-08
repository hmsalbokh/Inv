
export type UserRole = 'factory' | 'center' | 'monitor';
export type PressCode = 'OPK' | 'UNI';
export type CenterCode = 'DMM' | 'RYD' | 'JED';
export type PalletStatus = 'pending' | 'in_transit' | 'received';
export type PalletCondition = 'intact' | 'damaged' | 'external_box_damage' | 'internal_content_damage' | 'both';

export interface UserCredentials {
  id: string;
  role: UserRole;
  code: PressCode | CenterCode | 'ADMIN' | 'STATS';
  username: string;
  password: string;
  displayName: string;
}

export interface PalletType {
  id: string;
  stageCode: string;
  stageName: string;
  cartonsPerPallet: number;
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
  externalDamageQty?: number; // عدد الكراتين المتضررة خارجياً
  internalDamageQty?: number; // عدد الكراتين المتضررة داخلياً
  photos?: string[];
  notes?: string;
  damageDetails?: string; 
  localOnly?: boolean; 
}

export interface Trip {
  id: string;
  tripNumber: string;
  tripBarcode: string;
  pressCode: PressCode;
  centerCode: CenterCode;
  startDate: number;
  status: 'active' | 'completed';
}

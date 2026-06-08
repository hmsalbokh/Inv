import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Global flag to use highly performant local simulation when cloud API keys are suspended
export const useOfflineSimulation = true;

// Initialize the real application block but keep catch-safe if it breaks due to disabled services
let realApp: any = null;
let realDb: any = null;
let realAuth: any = null;

try {
  realApp = initializeApp(firebaseConfig);
  realDb = getFirestore(realApp, firebaseConfig.firestoreDatabaseId);
  realAuth = getAuth(realApp);
} catch (error) {
  console.warn("Real Firebase initialization failed or disabled, running in zero-latency sandboxed simulation:", error);
}

// Persisted Mock Database Setup
const DEFAULT_USERS = [
  { id: '1', role: 'monitor', code: 'ADMIN', username: 'admin', password: 'H0566749388h', displayName: 'مسئول النظام', locationName: 'الإدارة' },
  { id: '7', role: 'monitor', code: 'STATS', username: 'stats', password: '123', displayName: 'مسئول المراقبة', locationName: 'المراقبة والإحصاء' },
  { id: '2', role: 'factory', code: 'OPK', username: 'opk', password: '123', displayName: 'موظف مطبعة العبيكان', locationName: 'مطبعة العبيكان' },
  { id: '3', role: 'factory', code: 'UNI', username: 'uni', password: '123', displayName: 'موظف المطبعة المتحدة', locationName: 'المطبعة المتحدة' },
  { id: '4', role: 'center', code: 'DMM', username: 'dmm', password: '123', displayName: 'موظف الدمام', locationName: 'مركز الدمام' },
  { id: '5', role: 'center', code: 'RYD', username: 'ryd', password: '123', displayName: 'موظف الرياض', locationName: 'مركز الرياض' },
  { id: '6', role: 'center', code: 'JED', username: 'jed', password: '123', displayName: 'موظف جدة', locationName: 'مركز جدة' },
];

const DEFAULT_TYPES = [
  { id: 'g01', stageCode: 'G01', stageName: 'الصف الأول الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g02', stageCode: 'G02', stageName: 'الصف الثاني الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g03', stageCode: 'G03', stageName: 'الصف الثالث الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g04', stageCode: 'G04', stageName: 'الصف الرابع الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g05', stageCode: 'G05', stageName: 'الصف الخامس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g06', stageCode: 'G06', stageName: 'الصف السادس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g07', stageCode: 'G07', stageName: 'الصف الأول المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g08', stageCode: 'G08', stageName: 'الصف الثاني المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g09', stageCode: 'G09', stageName: 'الصف الثالث المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g11', stageCode: 'G11', stageName: 'الصف الأول الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g12', stageCode: 'G12', stageName: 'الصف الثاني الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g13', stageCode: 'G13', stageName: 'الصف الثالث الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig01', stageCode: 'IG01', stageName: 'المدارس العالمية - الأول الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig02', stageCode: 'IG02', stageName: 'المدارس العالمية - الثاني الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig03', stageCode: 'IG03', stageName: 'المدارس العالمية - الثالث الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig04', stageCode: 'IG04', stageName: 'المدارس العالمية - الرابع الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig05', stageCode: 'IG05', stageName: 'المدارس العالمية - الخامس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig06', stageCode: 'IG06', stageName: 'المدارس العالمية - السادس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig07', stageCode: 'IG07', stageName: 'المدارس العالمية - الأول المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig08', stageCode: 'IG08', stageName: 'المدارس العالمية - الثاني المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig09', stageCode: 'IG09', stageName: 'المدارس العالمية - الثالث المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig11', stageCode: 'IG11', stageName: 'المدارس العالمية - الأول الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig12', stageCode: 'IG12', stageName: 'المدارس العالمية - الثاني الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig13', stageCode: 'IG13', stageName: 'المدارس العالمية - الثالث الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
];

function generateOfflineId() {
  return 'col_' + Math.random().toString(36).substr(2, 9);
}

export function getOfflineCollection(colName: string): any[] {
  const items = localStorage.getItem(`offline_col_${colName}`);
  if (!items) {
    if (colName === 'users') {
      localStorage.setItem('offline_col_users', JSON.stringify(DEFAULT_USERS));
      return DEFAULT_USERS;
    }
    if (colName === 'palletTypes') {
      localStorage.setItem('offline_col_palletTypes', JSON.stringify(DEFAULT_TYPES));
      return DEFAULT_TYPES;
    }
    if (colName === 'config') {
      const defaultConfig = [{ id: 'system', lastResetTimestamp: 0, allowCentersExport: false, allowedExportCenters: [] }];
      localStorage.setItem('offline_col_config', JSON.stringify(defaultConfig));
      return defaultConfig;
    }
    return [];
  }
  return JSON.parse(items);
}

export function setOfflineCollection(colName: string, items: any[]): void {
  localStorage.setItem(`offline_col_${colName}`, JSON.stringify(items));
}

// Sync management listeners
const listeners = new Set<() => void>();
export function triggerOfflineListeners() {
  listeners.forEach(cb => cb());
}

// Mock snapshot classes matching Firestore schema
export class MockDocSnapshot {
  id: string;
  _data: any;
  ref: any;
  constructor(id: string, data: any, ref: any) {
    this.id = id;
    this._data = data;
    this.ref = ref;
  }
  exists() {
    return this._data !== undefined && this._data !== null;
  }
  data() {
    return this._data ? { ...this._data } : undefined;
  }
}

export class MockQuerySnapshot {
  docs: MockDocSnapshot[];
  constructor(docs: MockDocSnapshot[]) {
    this.docs = docs;
  }
  get empty() {
    return this.docs.length === 0;
  }
  forEach(callback: (doc: MockDocSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

// Re-export original or simulated database and authentication
export const db = useOfflineSimulation ? ({ type: 'mock_firestore' } as any) : realDb;

export const auth = useOfflineSimulation ? {
  currentUser: null as any,
  providerData: [] as any[]
} : realAuth;

// Database type mocks
export type DocumentData = any;
export type QueryDocumentSnapshot = any;

// Simulated Authentication APIs
let mockAuthUser: any = null;
const authStateListeners = new Set<(user: any) => void>();

export function setMockUser(user: any) {
  mockAuthUser = user;
  auth.currentUser = user;
  authStateListeners.forEach(cb => cb(user));
}

export function onAuthStateChanged(authObj: any, callback: any) {
  if (useOfflineSimulation) {
    const user = {
      uid: 'offline_anon_user',
      isAnonymous: true,
      email: null,
      emailVerified: false,
      tenantId: null,
      providerData: []
    };
    setMockUser(user);
    setTimeout(() => callback(user), 0);
    authStateListeners.add(callback);
    return () => {
      authStateListeners.delete(callback);
    };
  }
  // Safe fallback if real chosen
  return () => {};
}

export async function signInAnonymously(authObj: any) {
  if (useOfflineSimulation) {
    const user = {
      uid: 'offline_anon_user',
      isAnonymous: true,
      email: null,
      emailVerified: false,
      tenantId: null,
      providerData: []
    };
    setMockUser(user);
    return { user };
  }
}

export async function signOut(authObj: any) {
  if (useOfflineSimulation) {
    setMockUser(null);
    return;
  }
}

// Simulated Firestore APIs
export function collection(dbObj: any, path: string) {
  if (useOfflineSimulation) {
    return { path, type: 'collection' };
  }
}

export function doc(dbObj: any, colOrDocPath: string, docId?: string) {
  if (useOfflineSimulation) {
    const fullPath = docId ? `${colOrDocPath}/${docId}` : colOrDocPath;
    const computedId = docId || colOrDocPath.split('/').pop() || '';
    return { path: fullPath, id: computedId, type: 'doc' };
  }
}

export function query(colRef: any, ...constraints: any[]) {
  if (useOfflineSimulation) {
    return { path: colRef.path, type: 'query', constraints };
  }
}

export function where(field: string, operator: string, value: any) {
  return { type: 'where', field, operator, value };
}

export function orderBy(field: string, direction: string = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(n: number) {
  return { type: 'limit', n };
}

export function startAfter(...args: any[]) {
  return { type: 'startAfter', args };
}

export function deleteField() {
  return '__DELETE_FIELD__';
}

export function serverTimestamp() {
  return { _methodName: 'serverTimestamp' };
}

export async function getDoc(docRef: any) {
  if (useOfflineSimulation) {
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const docId = parts[1];
    const items = getOfflineCollection(colName);
    const found = items.find(item => item.id === docId);
    return new MockDocSnapshot(docId, found, docRef);
  }
}

export async function getDocFromServer(docRef: any) {
  return getDoc(docRef);
}

export async function getDocs(queryRefOrColRef: any) {
  if (useOfflineSimulation) {
    const colName = queryRefOrColRef.path;
    let items = getOfflineCollection(colName);

    if (queryRefOrColRef.constraints) {
      for (const c of queryRefOrColRef.constraints) {
        if (c.type === 'where') {
          const { field, operator, value } = c;
          items = items.filter(item => {
            const itemVal = item[field];
            if (operator === '==') return String(itemVal).trim().toUpperCase() === String(value).trim().toUpperCase();
            if (operator === '>') return Number(itemVal) > Number(value);
            if (operator === '<') return Number(itemVal) < Number(value);
            if (operator === '>=') return Number(itemVal) >= Number(value);
            if (operator === '<=') return Number(itemVal) <= Number(value);
            return true;
          });
        }
      }
    }

    const docSnaps = items.map(item => new MockDocSnapshot(item.id || '', item, { path: `${colName}/${item.id}` }));
    return new MockQuerySnapshot(docSnaps);
  }
}

export async function setDoc(docRef: any, data: any, options?: any) {
  if (useOfflineSimulation) {
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const docId = parts[1];
    let items = getOfflineCollection(colName);
    const index = items.findIndex(item => item.id === docId);
    
    const processedData = { ...data };
    Object.keys(processedData).forEach(k => {
      if (processedData[k] && typeof processedData[k] === 'object' && processedData[k]._methodName === 'serverTimestamp') {
        processedData[k] = Date.now();
      }
    });

    if (index >= 0) {
      if (options?.merge) {
        items[index] = { ...items[index], ...processedData, id: docId };
      } else {
        items[index] = { ...processedData, id: docId };
      }
    } else {
      items.push({ ...processedData, id: docId });
    }
    
    setOfflineCollection(colName, items);
    triggerOfflineListeners();
    return;
  }
}

export async function updateDoc(docRef: any, data: any) {
  if (useOfflineSimulation) {
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const docId = parts[1];
    let items = getOfflineCollection(colName);
    const index = items.findIndex(item => item.id === docId);
    if (index >= 0) {
      const updated = { ...items[index] };
      Object.keys(data).forEach(key => {
        if (data[key] === '__DELETE_FIELD__') {
          delete updated[key];
        } else {
          updated[key] = data[key];
        }
      });
      items[index] = updated;
      setOfflineCollection(colName, items);
      triggerOfflineListeners();
    }
    return;
  }
}

export async function addDoc(colRef: any, data: any) {
  if (useOfflineSimulation) {
    const colName = colRef.path;
    const items = getOfflineCollection(colName);
    const newId = generateOfflineId();
    const newItem = { ...data, id: newId };
    items.push(newItem);
    setOfflineCollection(colName, items);
    triggerOfflineListeners();
    return { id: newId, path: `${colName}/${newId}` };
  }
}

export async function deleteDoc(docRef: any) {
  if (useOfflineSimulation) {
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const docId = parts[1];
    let items = getOfflineCollection(colName);
    items = items.filter(item => item.id !== docId);
    setOfflineCollection(colName, items);
    triggerOfflineListeners();
    return;
  }
}

export function onSnapshot(ref: any, callback: any, errorCallback?: any) {
  if (useOfflineSimulation) {
    const update = () => {
      if (ref.type === 'doc') {
        getDocOffline(ref).then(snap => callback(snap)).catch(err => errorCallback?.(err));
      } else {
        getDocsOffline(ref).then(snap => callback(snap)).catch(err => errorCallback?.(err));
      }
    };
    
    setTimeout(update, 0);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }
  return () => {};
}

async function getDocOffline(ref: any) {
  const parts = ref.path.split('/');
  const colName = parts[0];
  const docId = parts[1];
  const items = getOfflineCollection(colName);
  const found = items.find(item => item.id === docId);
  return new MockDocSnapshot(docId, found, ref);
}

async function getDocsOffline(ref: any) {
  const colName = ref.path;
  let items = getOfflineCollection(colName);

  if (ref.constraints) {
    for (const c of ref.constraints) {
      if (c.type === 'where') {
        const { field, operator, value } = c;
        items = items.filter(item => {
          const itemVal = item[field];
          if (operator === '==') return String(itemVal).trim().toUpperCase() === String(value).trim().toUpperCase();
          if (operator === '>') return Number(itemVal) > Number(value);
          if (operator === '<') return Number(itemVal) < Number(value);
          if (operator === '>=') return Number(itemVal) >= Number(value);
          if (operator === '<=') return Number(itemVal) <= Number(value);
          return true;
        });
      }
    }
  }

  const docSnaps = items.map(item => new MockDocSnapshot(item.id || '', item, { path: `${colName}/${item.id}` }));
  return new MockQuerySnapshot(docSnaps);
}

export function writeBatch(dbObj: any) {
  if (useOfflineSimulation) {
    const ops: { type: 'set' | 'update' | 'delete', ref: any, data?: any, options?: any }[] = [];
    return {
      set(docRef: any, data: any, options?: any) {
        ops.push({ type: 'set', ref: docRef, data, options });
      },
      update(docRef: any, data: any) {
        ops.push({ type: 'update', ref: docRef, data });
      },
      delete(docRef: any) {
        ops.push({ type: 'delete', ref: docRef });
      },
      async commit() {
        for (const op of ops) {
          if (op.type === 'set') {
            await setDoc(op.ref, op.data, op.options);
          } else if (op.type === 'update') {
            await updateDoc(op.ref, op.data);
          } else if (op.type === 'delete') {
            await deleteDoc(op.ref);
          }
        }
        triggerOfflineListeners();
      }
    };
  }
}

// Original error handler
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

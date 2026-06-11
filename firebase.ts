import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import defaultFirebaseConfig from './firebase-applet-config.json';

// ============================================================
// Configuration
// ============================================================
const storedConfigRaw = localStorage.getItem('custom_firebase_config');
let customConfig: any = null;
if (storedConfigRaw && storedConfigRaw.trim() !== '') {
  try { customConfig = JSON.parse(storedConfigRaw); } catch (e) { }
}
export const activeFirebaseConfig = customConfig || defaultFirebaseConfig;

const forcedOffline = localStorage.getItem('force_offline_mode');
export const useOfflineSimulation = forcedOffline === 'true';

// ============================================================
// Supabase Client
// ============================================================
let supabaseClient: SupabaseClient | null = null;

function getSupabaseUrl(): string | null {
  return activeFirebaseConfig.supabaseUrl || null;
}

function getSupabaseAnonKey(): string | null {
  return activeFirebaseConfig.supabaseAnonKey || null;
}

export function initSupabase(): SupabaseClient | null {
  try {
    const url = getSupabaseUrl();
    const key = getSupabaseAnonKey();
    if (!url || !key) return null;
    if (supabaseClient) return supabaseClient;
    supabaseClient = createClient(url, key, {
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });
    return supabaseClient;
  } catch (e) {
    console.warn("Supabase init failed:", e);
    return null;
  }
}

if (!useOfflineSimulation) {
  initSupabase();
}

// ============================================================
// Mode Detection
// ============================================================
export function isOffline(): boolean {
  return useOfflineSimulation || !supabaseClient;
}

export function shouldSimulate(dbOrRef: any): boolean {
  if (isOffline()) return true;
  if (!dbOrRef) return true;
  if (dbOrRef.type === 'mock_firestore' || dbOrRef.type === 'collection' || dbOrRef.type === 'doc' || dbOrRef.type === 'query') return true;
  return false;
}

// ============================================================
// Database Reference
// ============================================================
export const db = isOffline() ? ({ type: 'mock_firestore' } as any) : ({ type: 'supabase' } as any);

// ============================================================
// Auth (mock only - Supabase auth can be added later)
// ============================================================
export const auth = {
  currentUser: null as any,
  providerData: [] as any[]
};

let mockAuthUser: any = null;
const authStateListeners = new Set<(user: any) => void>();

export function setMockUser(user: any) {
  mockAuthUser = user;
  auth.currentUser = user;
  authStateListeners.forEach(cb => cb(user));
}

export function onAuthStateChanged(authObj: any, callback: any) {
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
  return () => { authStateListeners.delete(callback); };
}

export async function signInAnonymously(authObj: any) {
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

export async function signOut(authObj: any) {
  setMockUser(null);
}

// ============================================================
// Types
// ============================================================
export type DocumentData = any;
export type QueryDocumentSnapshot = any;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ============================================================
// Mock Snapshot Classes
// ============================================================
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

// ============================================================
// Offline (localStorage) Implementation
// ============================================================
const OFFLINE_STORAGE_VERSION = 'v14';
const OFFLINE_VERSION_KEY = 'offline_storage_version';

function checkOfflineVersion(): void {
  const storedVersion = localStorage.getItem(OFFLINE_VERSION_KEY);
  if (storedVersion !== OFFLINE_STORAGE_VERSION) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('offline_col_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(OFFLINE_VERSION_KEY, OFFLINE_STORAGE_VERSION);
  }
}
function generateOfflineId() {
  return 'col_' + Math.random().toString(36).substr(2, 9);
}

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

export function getOfflineCollection(colName: string): any[] {
  checkOfflineVersion();
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
let supabaseSubscriptions: RealtimeChannel[] = [];

export function triggerOfflineListeners() {
  listeners.forEach(cb => cb());
}

// ============================================================
// Collection / Document / Query References
// ============================================================
export function collection(dbObj: any, path: string) {
  return { path, type: 'collection' };
}

export function doc(dbObj: any, colOrDocPath: string, docId?: string) {
  const fullPath = docId ? `${colOrDocPath}/${docId}` : colOrDocPath;
  const computedId = docId || colOrDocPath.split('/').pop() || '';
  return { path: fullPath, id: computedId, type: 'doc' };
}

export function query(colRef: any, ...constraints: any[]) {
  return { path: colRef.path, type: 'query', constraints };
}

export function where(field: string, operator: any, value: any) {
  return { type: 'where', field, operator, value };
}

export function orderBy(field: string, direction: any = 'asc') {
  return { type: 'orderBy', field, direction: direction === 'desc' ? 'desc' : 'asc' };
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

// ============================================================
// Supabase Query Helpers
// ============================================================
function colNameFromPath(path: string): string {
  return path.split('/')[0];
}

function docIdFromPath(path: string): string {
  return path.split('/').pop() || '';
}

function buildSupabaseQuery(col: string, constraints?: any[]) {
  const tableName = toSupabaseTable(col);
  let query = supabaseClient!.from(tableName).select('*');

  if (constraints) {
    for (const c of constraints) {
      if (c.type === 'where') {
        const field = `document->>${c.field}`;
        if (c.operator === '==') query = query.eq(field, String(c.value));
        else if (c.operator === '>') query = query.gt(field, String(c.value));
        else if (c.operator === '<') query = query.lt(field, String(c.value));
        else if (c.operator === '>=') query = query.gte(field, String(c.value));
        else if (c.operator === '<=') query = query.lte(field, String(c.value));
      } else if (c.type === 'orderBy') {
        query = query.order(`document->>${c.field}`, { ascending: c.direction !== 'desc' });
      } else if (c.type === 'limit') {
        query = query.limit(c.n);
      }
    }
  }

  return query;
}

function toSupabaseTable(colName: string): string {
  if (colName === 'distributionTrips') return 'distribution_trips';
  if (colName === 'system_logs') return 'system_logs';
  if (colName === 'palletTypes') return 'pallet_types';
  return colName;
}

// ============================================================
// Read Operations
// ============================================================
export async function getDoc(docRef: any) {
  if (isOffline()) {
    const parts = docRef.path.split('/');
    const colName = parts[0];
    const docId = parts[1];
    const items = getOfflineCollection(colName);
    const found = items.find(item => item.id === docId);
    return new MockDocSnapshot(docId, found, docRef);
  }

  const col = colNameFromPath(docRef.path);
  const id = docIdFromPath(docRef.path);
  const { data, error } = await supabaseClient!
    .from(toSupabaseTable(col))
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return new MockDocSnapshot(id, data?.document, docRef);
}

export async function getDocFromServer(docRef: any) {
  return getDoc(docRef);
}

async function applyOfflineConstraints(items: any[], constraints?: any[]): Promise<any[]> {
  if (!constraints) return items;
  for (const c of constraints) {
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
    } else if (c.type === 'orderBy') {
      const { field, direction } = c;
      items.sort((a, b) => {
        const va = a[field], vb = b[field];
        if (direction === 'desc') return va > vb ? -1 : va < vb ? 1 : 0;
        return va < vb ? -1 : va > vb ? 1 : 0;
      });
    } else if (c.type === 'limit') {
      items = items.slice(0, c.n);
    }
  }
  return items;
}

export async function getDocs(queryRefOrColRef: any) {
  if (isOffline()) {
    const colName = queryRefOrColRef.path;
    let items = getOfflineCollection(colName);
    items = await applyOfflineConstraints(items, queryRefOrColRef.constraints);
    const docSnaps = items.map(item => new MockDocSnapshot(item.id || '', item, { path: `${colName}/${item.id}` }));
    return new MockQuerySnapshot(docSnaps);
  }

  const col = colNameFromPath(queryRefOrColRef.path);
  let sbQuery = buildSupabaseQuery(col, queryRefOrColRef.constraints);

  if (queryRefOrColRef.type === 'doc') {
    const id = docIdFromPath(queryRefOrColRef.path);
    sbQuery = (sbQuery as any).eq('id', id);
  }

  const { data, error } = await (sbQuery as any);
  if (error) throw error;

  const docs = (data || []).map((row: any) =>
    new MockDocSnapshot(row.id, row.document, { path: `${col}/${row.id}` })
  );
  return new MockQuerySnapshot(docs);
}

// ============================================================
// Write Operations
// ============================================================
export async function setDoc(docRef: any, data: any, options?: any) {
  const col = colNameFromPath(docRef.path);
  const id = docIdFromPath(docRef.path);

  if (isOffline()) {
    const items = getOfflineCollection(col);
    const existingIdx = items.findIndex(item => item.id === id);
    const newItem = options?.merge ? { ...(existingIdx >= 0 ? items[existingIdx] : {}), ...data, id } : { ...data, id };
    if (existingIdx >= 0) {
      items[existingIdx] = newItem;
    } else {
      items.push(newItem);
    }
    setOfflineCollection(col, items);
    triggerOfflineListeners();
    return;
  }

  const existing = (await supabaseClient!
    .from(toSupabaseTable(col))
    .select('*')
    .eq('id', id)
    .maybeSingle()).data;

  let document = data;
  if (options?.merge && existing?.document) {
    document = { ...existing.document, ...data };
  }

  const { error } = await supabaseClient!
    .from(toSupabaseTable(col))
    .upsert({ id, document }, { onConflict: 'id' });

  if (error) throw error;
}

export async function updateDoc(docRef: any, data: any) {
  const col = colNameFromPath(docRef.path);
  const id = docIdFromPath(docRef.path);

  if (isOffline()) {
    const items = getOfflineCollection(col);
    const idx = items.findIndex(item => item.id === id);
    if (idx >= 0) {
      // Handle deleteField
      for (const [key, val] of Object.entries(data)) {
        if (val === '__DELETE_FIELD__') {
          delete items[idx][key];
        } else {
          items[idx][key] = val;
        }
      }
      setOfflineCollection(col, items);
    }
    triggerOfflineListeners();
    return;
  }

  const { data: existing } = await supabaseClient!
    .from(toSupabaseTable(col))
    .select('document')
    .eq('id', id)
    .maybeSingle();

  if (existing) {
    const updatedDoc = { ...existing.document };
    for (const [key, val] of Object.entries(data)) {
      if (val === '__DELETE_FIELD__') {
        delete updatedDoc[key];
      } else {
        (updatedDoc as any)[key] = val;
      }
    }
    const { error } = await supabaseClient!
      .from(toSupabaseTable(col))
      .update({ document: updatedDoc })
      .eq('id', id);
    if (error) throw error;
  }
}

export async function addDoc(colRef: any, data: any) {
  const col = colNameFromPath(colRef.path);
  const id = generateOfflineId();

  if (isOffline()) {
    const items = getOfflineCollection(col);
    items.push({ ...data, id });
    setOfflineCollection(col, items);
    triggerOfflineListeners();
    return { id };
  }

  const { error } = await supabaseClient!
    .from(toSupabaseTable(col))
    .insert({ id, document: { ...data, id } });

  if (error) throw error;
  return { id };
}

export async function deleteDoc(docRef: any) {
  const col = colNameFromPath(docRef.path);
  const id = docIdFromPath(docRef.path);

  if (isOffline()) {
    const items = getOfflineCollection(col);
    const filtered = items.filter(item => item.id !== id);
    setOfflineCollection(col, filtered);
    triggerOfflineListeners();
    return;
  }

  const { error } = await supabaseClient!
    .from(toSupabaseTable(col))
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================================
// Batch Write
// ============================================================
export function writeBatch(dbObj: any) {
  const ops: { type: 'set' | 'update' | 'delete'; ref: any; data?: any; options?: any }[] = [];
  return {
    set(docRef: any, data: any, options?: any) { ops.push({ type: 'set', ref: docRef, data, options }); },
    update(docRef: any, data: any) { ops.push({ type: 'update', ref: docRef, data }); },
    delete(docRef: any) { ops.push({ type: 'delete', ref: docRef }); },
    async commit() {
      for (const op of ops) {
        if (op.type === 'set') await setDoc(op.ref, op.data, op.options);
        else if (op.type === 'update') await updateDoc(op.ref, op.data);
        else if (op.type === 'delete') await deleteDoc(op.ref);
      }
    }
  };
}

// ============================================================
// Realtime (onSnapshot)
// ============================================================
const snapshotSubscriptions = new Map<string, () => void>();

export function onSnapshot(ref: any, callback: any, errorCallback?: any) {
  if (isOffline()) {
    const update = () => {
      if (ref.type === 'doc') {
        getDoc(ref).then(snap => callback(snap)).catch(err => errorCallback?.(err));
      } else {
        getDocs(ref).then(snap => callback(snap)).catch(err => errorCallback?.(err));
      }
    };
    setTimeout(update, 0);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }

  // Supabase real-time mode
  const col = colNameFromPath(ref.path);
  const channelName = `snapshot-${col}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const fetchData = ref.type === 'doc'
    ? () => getDoc(ref)
    : () => getDocs(ref);

  const channel = supabaseClient!.channel(channelName)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: toSupabaseTable(col) },
      async () => {
        try {
          const snap = await fetchData();
          callback(snap);
        } catch (err) {
          if (errorCallback) errorCallback(err);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        fetchData().then(snap => callback(snap));
      }
    });

  return () => {
    supabaseClient!.removeChannel(channel);
  };
}

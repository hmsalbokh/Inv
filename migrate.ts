
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

// إعدادات القاعدة القديمة والجديدة
const oldConfig = { ...firebaseConfig, firestoreDatabaseId: "ai-studio-a3ac8a8c-5df1-408d-b9fd-4ba0941c298d" };
const newConfig = { ...firebaseConfig, firestoreDatabaseId: "default" };

const oldApp = initializeApp(oldConfig, 'oldApp');
const newApp = initializeApp(newConfig, 'newApp');

const oldDb = getFirestore(oldApp, oldConfig.firestoreDatabaseId);
const newDb = getFirestore(newApp, newConfig.firestoreDatabaseId);

async function migrateCollection(name: string) {
  console.log(`بدء نقل مجموعة: ${name}...`);
  try {
    const snapshot = await getDocs(collection(oldDb, name));
    console.log(`تم العثور على ${snapshot.size} سجل في ${name}`);
    let count = 0;
    for (const d of snapshot.docs) {
      const data = d.data();
      await setDoc(doc(newDb, name, d.id), data);
      count++;
      if (count % 20 === 0) console.log(`تم نقل ${count} سجل من ${name}...`);
    }
    console.log(`✅ انتهى نقل ${name} بنجاح (${count} سجل)`);
  } catch (e: any) {
    console.error(`❌ فشل نقل ${name}:`, e.message);
  }
}

async function run() {
  try {
    await migrateCollection('users');
    await migrateCollection('palletTypes');
    await migrateCollection('trips');
    await migrateCollection('records');
    await migrateCollection('distributionTrips');
    await migrateCollection('config');
    console.log('🎉 تمت عملية النقل بنجاح كامل!');
  } catch (e: any) {
    console.error('توقف النقل:', e.message);
  }
}

run();

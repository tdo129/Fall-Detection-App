// src/services/firebaseConfig.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAmFTOmaFx8nxajv0bnZ38dhh29exWnQfc",
  authDomain: "doandidongtest.firebaseapp.com",
  projectId: "doandidongtest",
  storageBucket: "doandidongtest.firebasestorage.app",
  messagingSenderId: "635739886483",
  appId: "1:635739886483:web:77b777f17110866fd68e66"
};

// Khởi tạo Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  } as any);
} catch {
  firestoreDb = getFirestore(app);
}

export const db = firestoreDb;
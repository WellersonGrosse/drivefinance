import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_4NhqjrX3PRuhjeJpPQ7KyfOVo3JXWZg",
  authDomain: "drivefinance-61f17.firebaseapp.com",
  projectId: "drivefinance-61f17",
  storageBucket: "drivefinance-61f17.firebasestorage.app",
  messagingSenderId: "1014871624492",
  appId: "1:1014871624492:web:ceb1387e5bb751166e3a89",
  measurementId: "G-85EWQFT9V9"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);

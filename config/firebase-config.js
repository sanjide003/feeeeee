import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD7a37Mgo8BKGdlx4MVTN3j1oGuALHriyg",
  authDomain: "nimdevathiyal.firebaseapp.com",
  projectId: "nimdevathiyal",
  storageBucket: "nimdevathiyal.firebasestorage.app",
  messagingSenderId: "156742492721",
  appId: "1:156742492721:web:e624a301e52714863a6b10",
  measurementId: "G-F8GV4HKSC7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Exporting to use in index.html
export { db, auth };

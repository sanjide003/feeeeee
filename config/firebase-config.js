import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB9f48oJP6e_HkkyD8mgXLofq0S8TMfih0",
  authDomain: "result-aistudio.firebaseapp.com",
  projectId: "result-aistudio",
  storageBucket: "result-aistudio.firebasestorage.app",
  messagingSenderId: "515968357351",
  appId: "1:515968357351:web:abed438db3e752375fe342",
  measurementId: "G-F31CJQC8T7"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Exporting to use in index.html
export { db, auth };

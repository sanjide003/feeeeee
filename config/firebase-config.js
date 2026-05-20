import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";

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

const app = initializeApp(firebaseConfig);

const appCheckSiteKey = window.__APP_CHECK_SITE_KEY || 'REPLACE_WITH_RECAPTCHA_V3_SITE_KEY';
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(appCheckSiteKey),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth, appCheck };

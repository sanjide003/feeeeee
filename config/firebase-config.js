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

const appCheckSiteKey = String(window.__APP_CHECK_SITE_KEY || '').trim();
const canEnableAppCheck = appCheckSiteKey && appCheckSiteKey !== 'REPLACE_WITH_RECAPTCHA_V3_SITE_KEY';
const appCheck = canEnableAppCheck
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    })
  : null;

if (!canEnableAppCheck) {
  console.warn('[Security] App Check is not enabled yet: set window.__APP_CHECK_SITE_KEY with a valid reCAPTCHA v3 site key.');
}

const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth, appCheck, canEnableAppCheck };

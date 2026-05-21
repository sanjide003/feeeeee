# Firebase Access & Security Hardening

## 1) Firestore strict validation
Implemented in `firestore.rules` for high-risk paths.

## 2) App Check enforcement
Client bootstrap is enabled in `config/firebase-config.js`.

**Console enforcement (required):**
1. Firebase Console → Build → App Check.
2. Register reCAPTCHA v3 for the web app.
3. Set site key to `window.__APP_CHECK_SITE_KEY` at deploy time.
4. Turn enforcement ON for Firestore (and Storage/Auth if used).

## 3) Authorized domains lock
Firebase Console → Authentication → Settings → Authorized domains.
Keep only:
- production domain
- localhost (only for development)
- required preview domain(s)

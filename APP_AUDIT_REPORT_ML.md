# App Audit Report (ML)

## Security hardening status
- Firestore rules tightened with field-level validation for critical write paths.
- App Check bootstrap enabled in `config/firebase-config.js`.
- CSP policies updated to remove `unsafe-eval`.
- Session guard inline scripts moved to external script.

## Manual actions required
- In Firebase Console, enforce App Check for Firestore/Auth/Storage.
- In Firebase Authentication > Settings > Authorized domains, keep only production + required preview domains.
- Set `window.__APP_CHECK_SITE_KEY` from a secure deployment variable before production rollout.

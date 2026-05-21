# Rollback Runbook

1. Revert latest deployment.
2. Re-deploy previous known-good commit.
3. If App Check blocks clients, temporarily set App Check to monitoring mode.
4. Restore prior Firestore rules from Firebase rules history.
5. Re-run regression gate and smoke checks.

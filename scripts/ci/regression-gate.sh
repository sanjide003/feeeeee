#!/usr/bin/env bash
set -euo pipefail

echo "[1/5] JavaScript syntax check"
while IFS= read -r file; do
  node --check "$file" >/dev/null
done < <(rg --files -g '*.js' scripts config)

echo "[2/5] Firestore rules security assertions"
rg -n "match /institutions/\{institutionId\}/payments/\{docId\}" firestore.rules >/dev/null
rg -n "allow read: if isAdmin\(institutionId\) \|\| isCollectionSession\(\);" firestore.rules >/dev/null
rg -n "match /institutions/\{institutionId\}/academicYears/\{yearId\}/payments/\{docId\}" firestore.rules >/dev/null

echo "[3/5] Accessibility baseline assertions"
rg -n "skip-link" collection.html >/dev/null
rg -n "aria-live=\"polite\"" collection.html >/dev/null
rg -n ":focus-visible" styles/main.css >/dev/null

echo "[4/5] Key workflow hooks assertions"
rg -n "writeDutyStateToLocal|readDutyUpdatedAtFromLocal|validateDutyPaymentDetails" scripts/pages/collection-page.js >/dev/null

echo "[5/5] Audit + handover docs presence"
for f in APP_AUDIT_REPORT_ML.md qa/UAT_HANDOVER_CHECKLIST_ML.md qa/ROLLBACK_RUNBOOK.md; do
  test -f "$f"
done

echo "Regression gate checks passed."

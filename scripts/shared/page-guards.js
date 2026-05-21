(function () {
  const guardKey = document.documentElement?.dataset?.sessionGuard;
  if (!guardKey || !window.AppSession) return;

  const guardMap = {
    admin: () => window.AppSession.guardAdminPage?.(),
    collection: () => window.AppSession.guardStaffOrAdminPage?.(),
    result: () => window.AppSession.guardStaffPageAccess?.('result'),
    student: () => window.AppSession.guardStudentPage?.()
  };

  const runGuard = guardMap[guardKey];
  if (runGuard) runGuard();
})();

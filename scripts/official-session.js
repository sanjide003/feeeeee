    (function () {
        const DEFAULT_SESSION_MAX_AGE_MS = 1000 * 60 * 15;
        const DEFAULT_SESSION_IDLE_MAX_AGE_MS = 1000 * 60 * 10;
        const ROLE_SESSION_POLICY = {
            student: { maxAgeMs: 1000 * 60 * 30, idleMs: 1000 * 60 * 20 },
            staff: { maxAgeMs: 0, idleMs: 0 },
            admin: { maxAgeMs: 1000 * 60 * 15, idleMs: 1000 * 60 * 10 }
        };
        const STAFF_STATE_KEY = 'app_session_staff_state';
        const ADMIN_STATE_KEY = 'app_session_admin_state';
        const STUDENT_STATE_KEY = 'app_session_student_state';
        const STUDENT_ACCOUNTS_KEY = 'app_student_accounts';
        const CURRENT_ROLE_KEY = 'app_session_current_role';
        const FLASH_KEY = 'app_session_flash';

        const now = () => Date.now();
        const readJson = (key) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (error) { return null; } };
        const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
        const removeKey = (key) => localStorage.removeItem(key);
        const setCurrentRole = (role = '') => { if (role) sessionStorage.setItem(CURRENT_ROLE_KEY, role); else sessionStorage.removeItem(CURRENT_ROLE_KEY); };
        const getRole = () => sessionStorage.getItem(CURRENT_ROLE_KEY) || '';
        const buildState = (extra = {}) => { const timestamp = now(); return { startedAt: timestamp, lastActiveAt: timestamp, ...extra }; };
        const getSessionPolicy = (role = '') => ROLE_SESSION_POLICY[role] || { maxAgeMs: DEFAULT_SESSION_MAX_AGE_MS, idleMs: DEFAULT_SESSION_IDLE_MAX_AGE_MS };

        const isStateFresh = (state, role = getRole()) => {
            if (!state || !state.lastActiveAt || !state.startedAt) return false;
            const policy = getSessionPolicy(role);
            const age = now() - Number(state.startedAt);
            const idle = now() - Number(state.lastActiveAt);
            const maxAgeMs = Number(policy.maxAgeMs || 0);
            const idleMs = Number(policy.idleMs || 0);
            return (maxAgeMs <= 0 || age <= maxAgeMs) && (idleMs <= 0 || idle <= idleMs);
        };

        const getStaffState = () => readJson(STAFF_STATE_KEY);
        const getAdminState = () => readJson(ADMIN_STATE_KEY);
        const getStudentState = () => readJson(STUDENT_STATE_KEY);
        const getStudentAccounts = () => { const accounts = readJson(STUDENT_ACCOUNTS_KEY); return Array.isArray(accounts) ? accounts : []; };
        const saveStudentAccounts = (accounts = []) => writeJson(STUDENT_ACCOUNTS_KEY, accounts);
        const getStateByRole = (role) => { if (role === 'staff') return getStaffState(); if (role === 'admin') return getAdminState(); if (role === 'student') return getStudentState(); return null; };
        const setFlash = (message) => { if (message) sessionStorage.setItem(FLASH_KEY, message); };

        const clearClientData = async () => {
            try {
                const preserve = {};
                const savedStudentAccounts = localStorage.getItem(STUDENT_ACCOUNTS_KEY);
                if (savedStudentAccounts) preserve[STUDENT_ACCOUNTS_KEY] = savedStudentAccounts;
                localStorage.clear();
                Object.entries(preserve).forEach(([key, value]) => localStorage.setItem(key, value));
            } catch (error) {}
            if ('caches' in window) { try { const cacheNames = await caches.keys(); await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))); } catch (error) {} }
        };

        const clearAll = async (options = {}) => {
            [STAFF_STATE_KEY, ADMIN_STATE_KEY, STUDENT_STATE_KEY].forEach(removeKey);
            setCurrentRole('');
            if (options.purgeClientData) await clearClientData();
        };

        const pruneExpiredStates = () => {
            if (!isStateFresh(getStaffState(), 'staff')) removeKey(STAFF_STATE_KEY);
            if (!isStateFresh(getAdminState(), 'admin')) removeKey(ADMIN_STATE_KEY);
            const studentState = getStudentState();
            if (studentState && !studentState.studentId) removeKey(STUDENT_STATE_KEY);
        };

        const touchSession = () => {
            const role = getRole();
            const state = getStateByRole(role);
            if (!state) return;
            if (role !== 'student' && !isStateFresh(state, role)) return;
            writeJson(role === 'admin' ? ADMIN_STATE_KEY : role === 'staff' ? STAFF_STATE_KEY : STUDENT_STATE_KEY, { ...state, lastActiveAt: now() });
        };

        const hasStaffSession = () => isStateFresh(getStaffState(), 'staff');
        const hasAdminSession = () => isStateFresh(getAdminState(), 'admin');
        const hasStudentSession = () => Boolean(getStudentState()?.studentId);
        const redirectHome = (message = '') => { setFlash(message); window.location.href = 'index.html'; };

        let activityBound = false;
        const bindActivityTracking = () => {
            if (activityBound) return;
            activityBound = true;
            let lastTouch = 0;
            const throttledTouch = () => { const currentTime = now(); if ((currentTime - lastTouch) < 15000) return; lastTouch = currentTime; touchSession(); };
            ['click', 'keydown', 'pointerdown', 'focus'].forEach((eventName) => { window.addEventListener(eventName, throttledTouch, { passive: true }); });
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') throttledTouch(); });
        };

        pruneExpiredStates();
        bindActivityTracking();

        window.AppSession = {
            SESSION_MAX_AGE_MS: DEFAULT_SESSION_MAX_AGE_MS,
            SESSION_IDLE_MAX_AGE_MS: DEFAULT_SESSION_IDLE_MAX_AGE_MS,
            SESSION_POLICY: ROLE_SESSION_POLICY,
            clearAll,
            getRole,
            getStudentId() { const state = getStudentState(); return state?.studentId || ''; },
            getStaffName() { const state = getStaffState(); return state?.name || ''; },
            getStaffEmail() { const state = getStaffState(); return state?.email || ''; },
            isFresh() { const role = getRole(); return isStateFresh(getStateByRole(role), role); },
            getStaffAccess() { const state = getStaffState(); return (state?.access && typeof state.access === 'object') ? state.access : null; }
        };
    }());
  

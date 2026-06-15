import { signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, query, where, writeBatch, getDocs, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE, STAFF_ACCESS_COLLECTION } from '../../config/app-config.js';
import { BASE_PATH, applyCachedInstitutionLogo, enableSmartSelectWindowing, escapeHtml, formatDateDisplay, hardenExternalLinks, registerServiceWorker, rememberInstitutionLogo, renderVersionInfo, sanitizeUrl } from '../shared/app-common.js';

registerServiceWorker();
hardenExternalLinks();
enableSmartSelectWindowing(document, { visibleCount: 6 });
applyCachedInstitutionLogo(['admin-header-logo', 'admin-loader-logo']);

const confirmPublicExit = (message = 'Public page-ിലേക്ക് പോകുമ്പോൾ ഈ സെഷൻ logout ചെയ്യും. തുടരട്ടേ?') => confirm(message);
window.logoutAdmin = (options = {}) => {
    const { skipConfirm = false } = options;
    if(!skipConfirm && !confirmPublicExit()) return;
    signOut(auth).then(async () => {
        await window.AppSession?.clearAll({ purgeClientData: true });
        window.location.href = 'index.html';
    });
};

const STUDENT_STATUS_OPTIONS = ['Active', 'Inactive', 'Graduated'];
const ADMIN_ROLE_OPTIONS = {
    super_admin: {
        label: 'Super Admin',
        badgeClass: 'bg-red-100 text-red-700 border-red-200',
        permissions: ['dashboard.view', 'academic-years.manage', 'staff.manage', 'students.manage', 'classes.manage', 'groups.manage', 'results.manage', 'concessions.manage', 'fees.manage', 'website.manage', 'security.manage', 'backup.export', 'backup.restore', 'audit.view']
    },
    operations_admin: {
        label: 'Operations Admin',
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
        permissions: ['dashboard.view', 'academic-years.manage', 'students.manage', 'classes.manage', 'groups.manage', 'results.manage', 'website.manage', 'audit.view']
    },
    finance_admin: {
        label: 'Finance Admin',
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        permissions: ['dashboard.view', 'concessions.manage', 'fees.manage', 'backup.export', 'audit.view']
    },
    viewer: {
        label: 'Viewer',
        badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
        permissions: ['dashboard.view', 'audit.view']
    },
    result_operator: {
        label: 'Result Operator',
        badgeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        permissions: ['dashboard.view', 'results.manage', 'audit.view']
    }
};
const PAGE_PERMISSIONS = {
    dashboard: 'dashboard.view',
    'academic-years': 'academic-years.manage',
    'manage-staff': 'staff.manage',
    'add-students': 'students.manage',
    'manage-students': 'students.manage',
    'manage-classes': 'classes.manage',
    'manage-groups': 'groups.manage',
    results: 'results.manage',
    'fee-concessions': 'concessions.manage',
    'fee-settings': 'fees.manage',
    'web-basic-info': 'website.manage',
    'web-notices': 'website.manage',
    'web-gallery': 'website.manage',
    'web-directory': 'website.manage',
    'web-directory-entries': 'website.manage',
    'security-settings': 'security.manage'
};

let students = [], classes = [], studentGroups = [], feeItems = [], allStaff = [], allPayments = [];
let resultSchemas = [];
let rawStudents = [];
let webContent = { notices: [], gallery: [], directoryCategories: [] };
let publicDirectoryEntries = [];
let categoryAuthConfig = { categories: {} };
let pageAccessConfig = { categories: {}, overrides: {} };
let editingStudentId = null, editingClassName = null, editingStaffId = null;
let academicYears = [];
let activeAcademicYear = '';
let adminAccounts = [];
let currentAdminEmail = '';
let currentAdminRole = 'super_admin';
let auditLogs = [];
let pendingRestorePayload = null;
let sessionControl = {};
let sessionRegistry = { sessions: {} };
let sessionRegistryHeartbeat = null;
let hasRedirectedNonSuperAdmin = false;
let isResultOperatorSession = false;
const MONTH_SEQUENCE = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const normalizeEmail = (value = '') => value.toString().trim().toLowerCase();
const toAcademicYearDocId = (academicYear = '') => String(academicYear || '').trim().replace(/[^\w-]/g, '_');
const getEnrollmentRef = (academicYear = '', studentId = '') => doc(db, `${BASE_PATH}/academicYears/${toAcademicYearDocId(academicYear || currentAcademicYear)}/enrollments`, studentId);
const buildEnrollmentPayload = (studentId = '', studentRecord = {}) => ({
    studentId,
    academicYear: studentRecord.academicYear || currentAcademicYear,
    class: studentRecord.class || '',
    status: studentRecord.status || 'Active',
    adm: studentRecord.adm || '',
    uid: studentRecord.uid || '',
    concessionFee: studentRecord.concessionFee ?? null,
    updatedAt: new Date().toISOString()
});
const syncEnrollmentRecord = async (studentId = '', studentRecord = {}) => {
    if (!studentId) return;
    const academicYear = studentRecord.academicYear || currentAcademicYear;
    await setDoc(getEnrollmentRef(academicYear, studentId), buildEnrollmentPayload(studentId, { ...studentRecord, academicYear }), { merge: true });
};
const getAdminAuthRef = () => doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
const getSessionRegistryRef = () => doc(db, `${BASE_PATH}/settings`, 'sessionRegistry');
const getLocalDeviceId = () => {
    const key = 'fee_admin_device_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const generated = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(key, generated);
    return generated;
};
const getDeviceLabel = () => {
    const ua = navigator.userAgent || '';
    if (ua.includes('Android')) return 'Android Device';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS Device';
    if (ua.includes('Windows')) return 'Windows Device';
    if (ua.includes('Macintosh')) return 'Mac Device';
    if (ua.includes('Linux')) return 'Linux Device';
    return 'Unknown Device';
};
const getStaffAccessRef = (email = '') => doc(db, STAFF_ACCESS_COLLECTION, normalizeEmail(email));
const syncStaffAccessRecord = async (staffRecord = {}) => {
    const email = normalizeEmail(staffRecord.email || '');
    if (!email) return;
    await setDoc(getStaffAccessRef(email), {
        email,
        isActive: staffRecord.isActive !== false,
        canCollect: staffRecord.canCollect !== false,
        name: staffRecord.name || '',
        role: staffRecord.role || '',
        type: staffRecord.type || '',
        updatedAt: new Date().toISOString()
    }, { merge: true });
};
const removeStaffAccessRecord = async (email = '') => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    await deleteDoc(getStaffAccessRef(normalized));
};
const rebuildStaffAccessIndex = async (staffRecords = []) => {
    const accessSnap = await getDocs(collection(db, STAFF_ACCESS_COLLECTION));
    const activeEmails = new Set(staffRecords.map((staffRecord) => normalizeEmail(staffRecord.email)).filter(Boolean));
    const operations = [];
    accessSnap.forEach((docSnap) => {
        if (!activeEmails.has(docSnap.id)) operations.push((batch) => batch.delete(docSnap.ref));
    });
    staffRecords.forEach((staffRecord) => {
        const email = normalizeEmail(staffRecord.email);
        if (!email) return;
        operations.push((batch) => batch.set(getStaffAccessRef(email), {
            email,
            isActive: staffRecord.isActive !== false,
            canCollect: staffRecord.canCollect !== false,
            name: staffRecord.name || '',
            role: staffRecord.role || '',
            type: staffRecord.type || '',
            updatedAt: new Date().toISOString()
        }, { merge: true }));
    });
    await runBatchedWrites(operations);
};
const formatDateTime = (value) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${formatDateDisplay(value)} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
const getRoleMeta = (role = 'viewer') => ADMIN_ROLE_OPTIONS[role] || ADMIN_ROLE_OPTIONS.viewer;
const normalizeAdminAccounts = (accounts = [], legacyEmail = '') => {
    const seen = new Set();
    const normalized = [];
    accounts.forEach((account) => {
        const email = normalizeEmail(account?.email);
        if (!email || seen.has(email)) return;
        seen.add(email);
        normalized.push({
            name: (account?.name || '').toString().trim(),
            email,
            role: ADMIN_ROLE_OPTIONS[account?.role] ? account.role : 'viewer',
            isActive: account?.isActive !== false,
            createdAt: account?.createdAt || new Date().toISOString(),
            updatedAt: account?.updatedAt || new Date().toISOString()
        });
    });
    if (legacyEmail && !seen.has(legacyEmail)) {
        normalized.unshift({
            name: 'Master Admin',
            email: legacyEmail,
            role: 'super_admin',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    return normalized;
};
const buildAdminIndex = (accounts = []) => {
    return accounts.reduce((index, account) => {
        const rawEmail = (account?.email || '').toString().trim();
        const email = normalizeEmail(rawEmail);
        if (!email || account?.isActive === false) return index;
        index[email] = true;
        if (rawEmail && rawEmail !== email) index[rawEmail] = true;
        return index;
    }, {});
};
const buildAdminAuthPayload = (legacyEmail = '', accounts = []) => {
    const normalizedLegacyEmail = normalizeEmail(legacyEmail);
    const normalizedAdmins = normalizeAdminAccounts(accounts, normalizedLegacyEmail);
    return {
        email: normalizedLegacyEmail,
        admins: normalizedAdmins,
        adminsIndex: buildAdminIndex(normalizedAdmins)
    };
};
const getCurrentAdminAccount = () => adminAccounts.find((account) => account.email === currentAdminEmail) || null;
const hasPermission = (permission = '') => {
    if (!permission) return true;
    const currentAccount = getCurrentAdminAccount();
    const effectiveRole = currentAccount?.role || currentAdminRole || 'viewer';
    const roleMeta = getRoleMeta(effectiveRole);
    return Array.isArray(roleMeta?.permissions) && roleMeta.permissions.includes(permission);
};
const requirePermission = (permission, message = 'You do not have access to perform this action.') => {
    if (hasPermission(permission)) return true;
    alert(message);
    return false;
};
const enforceResultOperatorModeUI = () => {
    if (!isResultOperatorSession) return;
    document.querySelectorAll('.nav-link').forEach((link) => {
        const href = link.getAttribute('href') || '';
        const keepVisible = href === '#results' || href === 'result.html' || href === 'collection.html';
        link.classList.toggle('hidden', !keepVisible);
    });
    document.querySelectorAll('.page').forEach((page) => page.classList.add('hidden'));
    document.getElementById('results-page')?.classList.remove('hidden');
};
const enforceResultOperatorResultTabs = () => {
    const onlyAllowedTabs = isResultOperatorSession
        ? new Set(['result-marks-tab', 'result-published-tab', 'result-draft-tab'])
        : new Set(RESULT_DRAWER_TABS.map((entry) => entry.tab));
    const tabButtons = Array.from(document.querySelectorAll('.result-tab-btn'));
    const tabPanels = Array.from(document.querySelectorAll('.result-tab-content'));
    if (!tabButtons.length || !tabPanels.length) return;

    if (!isResultOperatorSession) {
        tabButtons.forEach((button) => button.classList.remove('hidden'));
        tabPanels.forEach((panel) => panel.classList.remove('hidden'));
        return;
    }

    tabButtons.forEach((button) => {
        const tabId = button.dataset.tab || '';
        button.classList.toggle('hidden', !onlyAllowedTabs.has(tabId));
    });
    tabPanels.forEach((panel) => {
        if (!onlyAllowedTabs.has(panel.id)) panel.classList.add('hidden');
    });
    switchResultTab(isResultOperatorSession ? 'result-marks-tab' : 'result-dashboard-tab');
};
const getCurrentAcademicYear = () => {
    const today = new Date();
    const month = today.getMonth();
    const year = today.getFullYear();
    if (month < 5) return `${year - 1}-${year}`;
    return `${year}-${year + 1}`;
};
const currentAcademicYear = getCurrentAcademicYear();
const normalizeAcademicYearLabel = (startYear, endYear) => {
    const start = parseInt(startYear, 10);
    const end = parseInt(endYear, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || end != start + 1) return '';
    return `${start}-${end}`;
};
const sanitizeAcademicYearLabel = (label = '') => {
    const parts = String(label).match(/\d{4}/g);
    if (!parts || parts.length < 2) return currentAcademicYear;
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end !== start + 1) return currentAcademicYear;
    return `${start}-${end}`;
};
const buildAcademicYearLabelFromStart = (startYear = 0) => `${startYear}-${startYear + 1}`;
const getAcademicYearPresetLabels = () => {
    const labels = [];
    for (let year = 2020; year <= 2050; year += 1) {
        labels.push(buildAcademicYearLabelFromStart(year));
    }
    return labels;
};
const normalizeGenderLabel = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.startsWith('m') || normalized.includes('boy') || normalized.includes('male')) return 'Male';
    if (normalized.startsWith('f') || normalized.includes('girl') || normalized.includes('female')) return 'Female';
    return '';
};
const normalizeStudentStatus = (status = 'Active') => {
    const normalizedStatus = status?.toString().trim().toLowerCase();
    return STUDENT_STATUS_OPTIONS.find((option) => option.toLowerCase() === normalizedStatus) || 'Active';
};
const getStudentStatusBadgeClass = (status) => ({
    Active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Inactive: 'bg-gray-100 text-gray-700 border-gray-200',
    Transferred: 'bg-amber-100 text-amber-700 border-amber-200',
    'TC Issued': 'bg-rose-100 text-rose-700 border-rose-200',
    Graduated: 'bg-indigo-100 text-indigo-700 border-indigo-200'
}[normalizeStudentStatus(status)] || 'bg-gray-100 text-gray-700 border-gray-200');
const compareClassLabels = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const sortClassLabels = (classList) => [...classList].sort(compareClassLabels);
const getDefaultClassLadder = () => Array.from({ length: 12 }, (_, index) => String(index + 1));
const buildDivisionLabels = (baseClass = '', count = 3) => {
    const normalizedBase = String(baseClass || '').trim().toUpperCase();
    if (!normalizedBase) return [];
    const normalizedCount = Math.max(1, Math.min(10, Number(count) || 0));
    return Array.from({ length: normalizedCount }, (_, index) => `${normalizedBase} ${String.fromCharCode(65 + index)}`);
};
const getActiveAcademicYearLabel = () => activeAcademicYear || currentAcademicYear;
const getActiveAcademicYearRecord = () => academicYears.find((year) => year.label === getActiveAcademicYearLabel()) || null;
const getAcademicMonthSequence = (yearRecord = {}) => {
    const startMonth = Number.isInteger(Number(yearRecord?.startMonth)) ? Number(yearRecord.startMonth) : 5;
    const endMonth = Number.isInteger(Number(yearRecord?.endMonth)) ? Number(yearRecord.endMonth) : 4;
    const months = [];
    let cursor = startMonth;
    const safetyCap = 24;
    for (let count = 0; count < safetyCap; count += 1) {
        months.push(cursor);
        if (cursor === endMonth) break;
        cursor = (cursor + 1) % 12;
    }
    return months.length ? months : [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];
};
const populateAcademicMonthSelectors = () => {
    const startSelect = document.getElementById('academic-year-start-month');
    const endSelect = document.getElementById('academic-year-end-month');
    const editStartSelect = document.getElementById('academic-year-edit-start-month');
    const editEndSelect = document.getElementById('academic-year-edit-end-month');
    if (!startSelect || !endSelect) return;
    const options = MONTH_LABELS.map((label, index) => `<option value="${index}">${label}</option>`).join('');
    startSelect.innerHTML = options;
    endSelect.innerHTML = options;
    if (editStartSelect) editStartSelect.innerHTML = options;
    if (editEndSelect) editEndSelect.innerHTML = options;
    if (!startSelect.value) startSelect.value = '5';
    if (!endSelect.value) endSelect.value = '4';
};
const populateAcademicYearPresetSelector = () => {
    const select = document.getElementById('academic-year-preset-select');
    if (!select) return;
    const presetLabels = getAcademicYearPresetLabels();
    const existingLabels = academicYears.map((year) => sanitizeAcademicYearLabel(year.label)).filter(Boolean);
    const available = presetLabels.filter((label) => !existingLabels.includes(label)).sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]));
    if (!available.length) {
        select.innerHTML = '<option value="">No new preset years available</option>';
        select.value = '';
        return;
    }
    select.innerHTML = available.map((label) => `<option value="${label}">${label}</option>`).join('');
    select.value = available[0];
};
const enforceSetupGate = () => {
    const activeYear = getActiveAcademicYearRecord();
    const classCount = Array.isArray(activeYear?.classes) ? activeYear.classes.length : 0;
    const isSetupReady = Boolean(activeYear?.label) && classCount > 0;
    document.querySelectorAll('.nav-link').forEach((link) => {
        const target = (link.getAttribute('href') || '').replace('#', '');
        const allowWhenBlocked = target === 'academic-years' || target === 'manage-classes' || target === 'dashboard';
        if (isSetupReady) {
            link.classList.remove('opacity-40', 'pointer-events-none');
            return;
        }
        if (!allowWhenBlocked) {
            link.classList.add('opacity-40', 'pointer-events-none');
        } else {
            link.classList.remove('opacity-40', 'pointer-events-none');
        }
    });
    const statusEl = document.getElementById('dashboard-setup-status');
    if (statusEl && !isSetupReady) statusEl.textContent = 'Complete Academic Year + Classes first';
    return isSetupReady;
};
const getStudentsForActiveYear = () => rawStudents.filter((student) => {
    const studentYear = student.academicYear || currentAcademicYear;
    return studentYear === getActiveAcademicYearLabel();
});
const getClassesForActiveYear = () => {
    const activeYearRecord = getActiveAcademicYearRecord();
    const structuredClasses = Array.isArray(activeYearRecord?.classes) ? activeYearRecord.classes : [];
    const studentClasses = getStudentsForActiveYear().map((student) => student.class).filter(Boolean);
    return sortClassLabels([...new Set([...structuredClasses, ...studentClasses])]);
};
const setAcademicYearBadges = () => {
    const activeYear = getActiveAcademicYearLabel();
    const badgeText = `Academic Year: ${activeYear}`;
    const addBadge = document.getElementById('add-students-year-badge');
    const manageStudentsBadge = document.getElementById('manage-students-year-badge');
    const manageClassesBadge = document.getElementById('manage-classes-year-badge');
    if (addBadge) addBadge.textContent = badgeText;
    if (manageStudentsBadge) manageStudentsBadge.textContent = badgeText;
    if (manageClassesBadge) manageClassesBadge.textContent = badgeText;
};
const syncActiveAcademicYearClasses = async (classNames, { replace = false } = {}) => {
    const normalizedClasses = sortClassLabels([...new Set(classNames.map((name) => name?.toString().trim().toUpperCase()).filter(Boolean))]);
    const activeLabel = getActiveAcademicYearLabel();
    let didChange = false;
    academicYears = academicYears.map((year) => {
        if (year.label !== activeLabel) return year;
        const existingClasses = Array.isArray(year.classes) ? sortClassLabels(year.classes) : [];
        const nextClasses = replace ? normalizedClasses : sortClassLabels([...new Set([...existingClasses, ...normalizedClasses])]);
        if (JSON.stringify(existingClasses) !== JSON.stringify(nextClasses)) {
            didChange = true;
            return { ...year, classes: nextClasses };
        }
        return year;
    });
    if (!didChange) return false;
    classes = getClassesForActiveYear();
    await persistAcademicYears();
    return true;
};
const removeClassFromActiveAcademicYear = async (className) => {
    const normalizedClassName = className?.toString().trim().toUpperCase();
    if (!normalizedClassName) return false;
    const activeLabel = getActiveAcademicYearLabel();
    let didChange = false;
    academicYears = academicYears.map((year) => {
        if (year.label !== activeLabel) return year;
        const existingClasses = Array.isArray(year.classes) ? year.classes : [];
        const nextClasses = existingClasses.filter((name) => name !== normalizedClassName);
        if (nextClasses.length !== existingClasses.length) {
            didChange = true;
            return { ...year, classes: sortClassLabels(nextClasses) };
        }
        return year;
    });
    if (!didChange) return false;
    classes = getClassesForActiveYear();
    await persistAcademicYears();
    return true;
};
const summarizeBackupCounts = (payload = {}) => {
    const collections = payload.collections || {};
    return Object.entries(collections)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.length : 0}`)
        .join(' • ');
};
const validateBackupPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return { valid: false, reason: 'Backup payload is empty.' };
    const collections = payload.collections || {};
    const requiredCollections = ['students', 'staff', 'studentGroups', 'payments', 'auditLogs'];
    for (const key of requiredCollections) {
        if (!Array.isArray(collections[key])) {
            return { valid: false, reason: `Missing or invalid collection: ${key}.` };
        }
    }
    return { valid: true, reason: '' };
};
const buildBackupPayload = async () => {
    const [studentsSnap, staffSnap, groupsSnap, paymentsSnap, auditSnap, configSnap, contentSnap, adminAuthSnap, academicYearsSnap] = await Promise.all([
        getDocs(collection(db, `${BASE_PATH}/students`)),
        getDocs(collection(db, `${BASE_PATH}/staff`)),
        getDocs(collection(db, `${BASE_PATH}/studentGroups`)),
        getDocs(collection(db, `${BASE_PATH}/payments`)),
        getDocs(collection(db, `${BASE_PATH}/auditLogs`)),
        getDoc(doc(db, `${BASE_PATH}/settings`, 'config')),
        getDoc(doc(db, `${BASE_PATH}/settings`, 'content')),
        getDoc(getAdminAuthRef()),
        getDoc(doc(db, `${BASE_PATH}/settings`, 'academicYears')),
    ]);
    return {
        exportedAt: new Date().toISOString(),
        institution: BASE_PATH,
        releaseStage: 'Phase 3',
        collections: {
            students: studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            staff: staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            studentGroups: groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            payments: paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            auditLogs: auditSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        },
        settings: {
            config: configSnap.exists() ? configSnap.data() : {},
            content: contentSnap.exists() ? contentSnap.data() : {},
            adminAuth: adminAuthSnap.exists() ? adminAuthSnap.data() : {},
            academicYears: academicYearsSnap.exists() ? academicYearsSnap.data() : {}
        }
    };
};
const restoreCollectionFromPayload = async (collectionName, records = []) => {
    const existing = await getDocs(collection(db, `${BASE_PATH}/${collectionName}`));
    const operations = [];
    existing.forEach((record) => operations.push((batch) => batch.delete(record.ref)));
    records.forEach((record) => {
        const { id, ...data } = record || {};
        if (!id) return;
        operations.push((batch) => batch.set(doc(db, `${BASE_PATH}/${collectionName}`, id), data));
    });
    await runBatchedWrites(operations);
};
const restoreFromBackupPayload = async (payload) => {
    const collections = payload?.collections || {};
    const settings = payload?.settings || {};
    await Promise.all([
        restoreCollectionFromPayload('students', collections.students || []),
        restoreCollectionFromPayload('staff', collections.staff || []),
        restoreCollectionFromPayload('studentGroups', collections.studentGroups || []),
        restoreCollectionFromPayload('payments', collections.payments || []),
        restoreCollectionFromPayload('auditLogs', collections.auditLogs || [])
    ]);
    await Promise.all([
        setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), settings.config || {}, { merge: false }),
        setDoc(doc(db, `${BASE_PATH}/settings`, 'content'), settings.content || {}, { merge: false }),
        setDoc(
            getAdminAuthRef(),
            buildAdminAuthPayload(
                settings?.adminAuth?.email || normalizeEmail(currentAdminEmail),
                Array.isArray(settings?.adminAuth?.admins) ? settings.adminAuth.admins : []
            ),
            { merge: false }
        ),
        setDoc(doc(db, `${BASE_PATH}/settings`, 'academicYears'), settings.academicYears || {}, { merge: false })
    ]);
};
const logAuditEvent = async ({ category = 'system', action, entityType = '', entityId = '', message = '', metadata = {} }) => {
    try {
        await addDoc(collection(db, `${BASE_PATH}/auditLogs`), {
            category,
            action,
            entityType,
            entityId,
            message,
            metadata,
            academicYear: getActiveAcademicYearLabel(),
            adminEmail: currentAdminEmail || currentAdminRole,
            adminRole: currentAdminRole,
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to write audit log.', error);
    }
};
const renderAdminRoleList = () => {
    const listEl = document.getElementById('admin-role-list');
    const summaryEl = document.getElementById('admin-role-summary');
    if (!listEl || !summaryEl) return;
    const activeCount = adminAccounts.filter((account) => account.isActive).length;
    summaryEl.textContent = 'Single Super Admin Mode';
    const addAdminBtn = document.getElementById('add-admin-role-btn');
    if (addAdminBtn) addAdminBtn.classList.add('hidden');
    const roleSelect = document.getElementById('admin-role-type');
    if (roleSelect) {
        roleSelect.value = 'super_admin';
        roleSelect.disabled = true;
    }
    const activeToggle = document.getElementById('admin-role-active');
    if (activeToggle) {
        activeToggle.checked = true;
        activeToggle.disabled = true;
    }
    listEl.innerHTML = adminAccounts.length ? adminAccounts.map((account) => {
        const meta = getRoleMeta(account.role);
        return `
            <div class="border border-gray-200 rounded-xl p-4 bg-gray-50/70">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div class="font-bold text-gray-900">${escapeHtml(account.name || account.email)}</div>
                        <div class="text-sm text-gray-500 break-all">${escapeHtml(account.email)}</div>
                        <div class="mt-2 inline-flex items-center gap-2 text-xs font-bold px-2.5 py-1 rounded-full border ${meta.badgeClass}">${meta.label}</div>
                        <div class="text-xs text-gray-400 mt-2">Updated: ${escapeHtml(formatDateTime(account.updatedAt))}</div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <span class="px-3 py-2 rounded-lg text-sm font-bold bg-blue-50 text-blue-700">Primary super admin</span>
                    </div>
                </div>
            </div>`;
    }).join('') : '<p class="text-sm text-gray-500 italic">No admin accounts configured yet.</p>';
};
const renderSessionMonitor = () => {
    const startedAt = window.AppSession?.getStartedAt?.();
    const lastActiveAt = window.AppSession?.getLastActiveAt?.();
    const policy = window.AppSession?.getRolePolicy?.('admin') || {
        maxAgeMs: window.AppSession?.SESSION_MAX_AGE_MS || 0,
        idleMs: window.AppSession?.SESSION_IDLE_MAX_AGE_MS || 0
    };
    const absoluteExpiry = startedAt ? new Date(startedAt + (policy.maxAgeMs || 0)).toISOString() : '';
    const idleExpiry = lastActiveAt ? new Date(lastActiveAt + (policy.idleMs || 0)).toISOString() : '';
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('session-monitor-started', formatDateTime(startedAt));
    setText('session-monitor-active', formatDateTime(lastActiveAt));
    setText('session-monitor-absolute', formatDateTime(absoluteExpiry));
    setText('session-monitor-idle', formatDateTime(idleExpiry));
    setText('security-current-admin-email', currentAdminEmail || '--');
    setText('security-current-admin-role', `Role: ${getRoleMeta(currentAdminRole).label}`);
    setText('session-control-last-event', sessionControl?.lastForcedLogoutAt ? `Forced on ${formatDateTime(sessionControl.lastForcedLogoutAt)} by ${sessionControl.forcedBy || 'system'}.` : 'No forced logout recorded yet.');
    setText('dashboard-session-status', window.AppSession?.isFresh?.() ? 'Monitoring' : 'Expired');
    const deviceListEl = document.getElementById('session-device-list');
    if (deviceListEl) {
        const sessions = Object.values(sessionRegistry?.sessions || {})
            .filter((entry) => normalizeEmail(entry?.adminEmail || '') === normalizeEmail(currentAdminEmail))
            .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
        deviceListEl.innerHTML = sessions.length ? sessions.map((entry) => {
            const isCurrent = entry.deviceId === getLocalDeviceId();
            return `
                <div class="bg-white border rounded-lg p-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="font-bold text-gray-900 text-sm">${escapeHtml(entry.deviceLabel || 'Device')}</div>
                        <span class="text-[10px] px-2 py-0.5 rounded-full border ${isCurrent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200'}">${isCurrent ? 'Current device' : 'Active'}</span>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">${escapeHtml(entry.platform || navigator.platform || 'unknown platform')}</div>
                    <div class="text-[11px] text-gray-500 mt-1">Last seen: ${escapeHtml(formatDateTime(entry.lastSeenAt))}</div>
                </div>`;
        }).join('') : '<div class="text-xs text-gray-500">No active admin device sessions found.</div>';
    }
    const buildAccessSessionCard = (entry = {}, theme = 'cyan') => {
        const blocked = entry.isBlocked === true;
        const statusClass = blocked
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200';
        return `<div class="bg-white border rounded-lg p-3">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="font-bold text-gray-900 text-sm truncate">${escapeHtml(entry.userName || entry.userKey || entry.adminEmail || 'User')}</div>
                    <div class="text-xs text-gray-500 mt-1">${escapeHtml(entry.deviceLabel || 'Device')} • ${escapeHtml(entry.platform || 'unknown')}</div>
                    <div class="text-[11px] text-gray-500 mt-1">Last seen: ${escapeHtml(formatDateTime(entry.lastSeenAt))}</div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[10px] px-2 py-0.5 rounded-full border ${statusClass}">${blocked ? 'Blocked' : 'Active'}</span>
                    <button class="w-8 h-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 session-action-more-btn" data-device-id="${escapeHtml(entry.deviceId || '')}" data-theme="${theme}">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>
            <div class="hidden mt-2 pt-2 border-t text-[11px] session-action-menu" data-device-id="${escapeHtml(entry.deviceId || '')}">
                <button class="px-2 py-1 rounded border bg-white hover:bg-gray-50 mr-1 session-action-btn" data-action="force-logout" data-device-id="${escapeHtml(entry.deviceId || '')}">Force Logout</button>
                <button class="px-2 py-1 rounded border bg-white hover:bg-gray-50 session-action-btn" data-action="${blocked ? 'unblock' : 'block'}" data-device-id="${escapeHtml(entry.deviceId || '')}">${blocked ? 'Unblock' : 'Block'}</button>
            </div>
        </div>`;
    };
    const sessions = Object.values(sessionRegistry?.sessions || {});
    const collectionSessionsEl = document.getElementById('collection-session-list');
    if (collectionSessionsEl) {
        const collectionSessions = sessions.filter((entry) => String(entry.role || '').toLowerCase() === 'collection');
        collectionSessionsEl.innerHTML = collectionSessions.length
            ? collectionSessions.map((entry) => buildAccessSessionCard(entry, 'cyan')).join('')
            : '<div class="text-xs text-gray-500">No active collection sessions found.</div>';
    }
    const studentSessionsEl = document.getElementById('student-session-list');
    if (studentSessionsEl) {
        const studentSessions = sessions.filter((entry) => String(entry.role || '').toLowerCase() === 'student');
        studentSessionsEl.innerHTML = studentSessions.length
            ? studentSessions.map((entry) => buildAccessSessionCard(entry, 'indigo')).join('')
            : '<div class="text-xs text-gray-500">No active student sessions found.</div>';
    }
};
const updateSessionRegistryEntry = async (deviceId = '', updates = {}) => {
    if (!deviceId) return;
    const currentEntry = (sessionRegistry?.sessions || {})[deviceId] || {};
    await setDoc(getSessionRegistryRef(), {
        sessions: {
            [deviceId]: {
                ...currentEntry,
                ...updates,
                updatedAt: new Date().toISOString(),
                updatedBy: currentAdminEmail || ''
            }
        }
    }, { merge: true });
};
const updateAdminSessionRegistry = async () => {
    if (!currentAdminEmail || currentAdminRole !== 'super_admin') return;
    const deviceId = getLocalDeviceId();
    const entry = {
        deviceId,
        adminEmail: currentAdminEmail,
        adminRole: currentAdminRole,
        deviceLabel: getDeviceLabel(),
        platform: navigator.platform || '',
        userAgent: navigator.userAgent || '',
        lastSeenAt: new Date().toISOString()
    };
    await setDoc(getSessionRegistryRef(), {
        sessions: { [deviceId]: entry },
        updatedAt: new Date().toISOString()
    }, { merge: true });
};
const startSessionRegistryHeartbeat = () => {
    if (sessionRegistryHeartbeat) clearInterval(sessionRegistryHeartbeat);
    updateAdminSessionRegistry().catch((error) => console.error('Failed to update session registry.', error));
    sessionRegistryHeartbeat = setInterval(() => {
        updateAdminSessionRegistry().catch((error) => console.error('Failed to update session registry.', error));
    }, 60000);
};
const renderAuditLogList = () => {
    const actionFilter = document.getElementById('audit-filter-action')?.value || 'all';
    const term = document.getElementById('audit-search-input')?.value?.trim().toLowerCase() || '';
    const listEl = document.getElementById('audit-log-list');
    const summaryEl = document.getElementById('audit-log-summary');
    if (!listEl || !summaryEl) return;
    const filtered = auditLogs.filter((entry) => {
        const haystack = `${entry.action || ''} ${entry.category || ''} ${entry.message || ''} ${entry.adminEmail || ''} ${entry.entityType || ''}`.toLowerCase();
        return (actionFilter === 'all' || entry.category === actionFilter) && (!term || haystack.includes(term));
    });
    summaryEl.textContent = `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`;
    document.getElementById('dashboard-audit-count').textContent = String(Math.min(auditLogs.length, 99));
    const resolveAuditTarget = (entry = {}) => {
        if (entry.category === 'backup') return 'security-settings';
        if (entry.category === 'security') return 'security-settings';
        if (entry.category === 'website') return (entry.action || '').includes('gallery') ? 'web-gallery' : 'web-notices';
        if (entry.category === 'class') return 'manage-classes';
        if (entry.category === 'group') return 'manage-groups';
        if (entry.category === 'student') return 'manage-students';
        if (entry.category === 'fee') return 'fee-settings';
        return '';
    };
    const humanizeAction = (action = '') => action
        ? action.replace(/\./g, ' • ').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
        : 'General Event';
    listEl.innerHTML = filtered.length ? filtered.slice(0, 100).map((entry) => {
        const target = resolveAuditTarget(entry);
        return `
        <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <div class="font-bold text-slate-900">${escapeHtml(entry.message || entry.action || 'Audit event')}</div>
                    <div class="text-xs text-slate-500 mt-1">${escapeHtml(entry.adminEmail || 'system')} • ${escapeHtml(getRoleMeta(entry.adminRole).label)} • ${escapeHtml(formatDateTime(entry.createdAt))}</div>
                </div>
                <span class="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700">${escapeHtml(entry.category || 'system')}</span>
            </div>
            <div class="text-[11px] text-slate-600 mt-2 font-semibold">Action: ${escapeHtml(humanizeAction(entry.action || ''))}</div>
            ${(entry.entityType || entry.entityId) ? `<div class="text-xs text-slate-500 mt-2">${escapeHtml(entry.entityType || 'entity')}${entry.entityId ? ` • ${escapeHtml(entry.entityId)}` : ''}</div>` : ''}
            ${target ? `<div class="mt-3"><button class="audit-open-target-btn text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded" data-target="${target}">Open Related Section</button></div>` : ''}
        </div>`;
    }).join('') : '<p class="text-sm text-slate-500 italic">No audit entries match the current filters.</p>';
};
const applyRoleAccessUI = () => {
    document.querySelectorAll('.nav-link').forEach((link) => {
        const target = link.getAttribute('href')?.replace('#', '');
        const permission = PAGE_PERMISSIONS[target];
        const allowed = !permission || hasPermission(permission);
        link.classList.toggle('hidden', !allowed);
    });

    document.querySelectorAll('.admin-quick-action').forEach((button) => {
        const target = button.dataset.targetPage || '';
        const permission = PAGE_PERMISSIONS[target];
        const allowed = !permission || hasPermission(permission);
        button.classList.toggle('hidden', !allowed);
    });

    document.getElementById('dashboard-admin-count').textContent = String(adminAccounts.filter((account) => account.isActive).length);
};
const ensureActiveAdminPageAccess = () => {
    const activeLink = document.querySelector('.nav-link.active');
    const activeTarget = activeLink?.getAttribute('href')?.replace('#', '') || 'dashboard';
    const requiredPermission = PAGE_PERMISSIONS[activeTarget];
    if (requiredPermission && !hasPermission(requiredPermission)) {
        activateAdminPage('dashboard', { suppressDeniedAlert: true });
    }
};
const renderDashboard = () => {
    const activeYear = getActiveAcademicYearLabel();
    const activeStaffCount = allStaff.filter((staff) => staff.isActive).length;
    const femaleCount = students.filter((student) => normalizeGenderLabel(student?.gender) === 'Female').length;
    const maleCount = students.filter((student) => normalizeGenderLabel(student?.gender) === 'Male').length;
    const setupChecks = [classes.length > 0, students.length > 0, feeItems.length > 0, adminAccounts.filter((account) => account.isActive).length > 0].filter(Boolean).length;

    document.getElementById('dashboard-active-year').textContent = activeYear;
    document.getElementById('dashboard-active-year-status').textContent = `${academicYears.length || 1} academic year record(s) configured`;
    document.getElementById('dashboard-student-count').textContent = students.filter((student) => normalizeStudentStatus(student.status) === 'Active').length;
    document.getElementById('dashboard-class-count').textContent = classes.length;
    document.getElementById('dashboard-staff-count').textContent = activeStaffCount;
    document.getElementById('dashboard-fee-item-count').textContent = feeItems.length;
    document.getElementById('dashboard-group-count').textContent = studentGroups.length;
    document.getElementById('dashboard-female-count').textContent = femaleCount;
    document.getElementById('dashboard-male-count').textContent = maleCount;
    document.getElementById('dashboard-setup-status').textContent = setupChecks === 4 ? 'Stage 3 workflow ready' : 'Setup pending';
    document.getElementById('academic-year-active-badge').textContent = activeYear;
    document.getElementById('dashboard-admin-count').textContent = String(adminAccounts.filter((account) => account.isActive).length);
    document.getElementById('dashboard-audit-count').textContent = String(Math.min(auditLogs.length, 99));
    renderSessionMonitor();
};

const renderAcademicYears = () => {
    const listEl = document.getElementById('academic-years-list');
    if (academicYears.length === 0) {
        listEl.innerHTML = '<div class="text-center py-8 bg-gray-50 rounded-xl border border-dashed text-gray-500 font-medium">No academic years configured yet.</div>';
        return;
    }

    listEl.innerHTML = academicYears
        .sort((a, b) => (b.startYear || 0) - (a.startYear || 0))
        .map((year) => {
            const isActive = year.label === activeAcademicYear;
            const startMonthLabel = MONTH_LABELS[Number(year.startMonth ?? 5)] || MONTH_LABELS[5];
            const endMonthLabel = MONTH_LABELS[Number(year.endMonth ?? 4)] || MONTH_LABELS[4];
            return `
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                    <div>
                        <div class="flex items-center gap-3 flex-wrap">
                            <span class="text-lg font-extrabold text-gray-900">${year.label}</span>
                            <span class="px-2.5 py-1 rounded-full text-xs font-bold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}">${isActive ? 'Active Working Year' : (year.status || 'planning').toUpperCase()}</span>
                        </div>
                        <div class="text-sm text-gray-500 mt-2">Students in this year are managed under year-first records and class structures.</div>
                        <div class="text-xs text-gray-500 mt-1">Fee/Result Months: ${startMonthLabel} → ${endMonthLabel}</div>
                        <div class="text-xs font-semibold text-indigo-600 mt-2">${(year.classes || []).length} configured class/division record(s)</div>
                    </div>
                    <div class="flex flex-wrap gap-2 items-start">
                        <button class="set-active-year-btn px-4 py-2 rounded-lg font-bold text-sm ${isActive ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}" data-label="${year.label}" ${isActive ? 'disabled' : ''}>Make Active</button>
                        <button class="archive-year-btn px-4 py-2 rounded-lg font-bold text-sm ${year.status === 'archived' ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}" data-label="${year.label}" ${year.status === 'archived' ? 'disabled' : ''}>Archive</button>
                        <div class="relative">
                            <button class="year-menu-toggle w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-label="${year.label}" title="More actions" aria-label="More actions">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="year-menu hidden absolute right-0 mt-2 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                                <button class="year-edit-btn w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-blue-50" data-label="${year.label}">Edit months/status</button>
                                <button class="year-delete-btn w-full text-left px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50" data-label="${year.label}">Delete year</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
};
const openAcademicYearEditPopup = (yearLabel = '') => {
    const targetYear = academicYears.find((year) => year.label === yearLabel);
    if (!targetYear) return;
    document.getElementById('academic-year-edit-target-label').value = yearLabel;
    document.getElementById('academic-year-edit-label').value = yearLabel;
    document.getElementById('academic-year-edit-start-month').value = String(targetYear.startMonth ?? 5);
    document.getElementById('academic-year-edit-end-month').value = String(targetYear.endMonth ?? 4);
    document.getElementById('academic-year-edit-status').value = targetYear.status || (yearLabel === activeAcademicYear ? 'active' : 'planning');
    document.getElementById('academic-year-edit-popup').classList.remove('hidden');
    document.getElementById('academic-year-edit-popup').classList.add('flex');
};
const closeAcademicYearEditPopup = () => {
    document.getElementById('academic-year-edit-popup').classList.add('hidden');
    document.getElementById('academic-year-edit-popup').classList.remove('flex');
};

const persistAcademicYears = async () => {
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'academicYears'), {
        currentYear: activeAcademicYear || currentAcademicYear,
        years: academicYears
    }, { merge: true });
};

const refreshAcademicYearScopedData = () => {
    students = getStudentsForActiveYear();
    classes = getClassesForActiveYear();
    setAcademicYearBadges();
    populateClassDropdowns();
    if (typeof populateResultSelectors === 'function') populateResultSelectors();
    enforceSetupGate();
    renderDashboard();

    if(!document.getElementById('manage-classes-page').classList.contains('hidden')) renderClassList();
    if(!document.getElementById('manage-students-page').classList.contains('hidden')) renderStudentList();
    if(!document.getElementById('manage-groups-page').classList.contains('hidden')) renderStudentGroups();
    if(!document.getElementById('fee-concessions-page').classList.contains('hidden')) renderConcessionsList();
};

const runBatchedWrites = async (operations, chunkSize = 400) => {
    if (!operations.length) return;

    for (let index = 0; index < operations.length; index += chunkSize) {
        const batch = writeBatch(db);
        operations.slice(index, index + chunkSize).forEach((applyOperation) => applyOperation(batch));
        await batch.commit();
    }
};

const buildStudentCleanupOperations = async (studentIds, { deleteStudents = false } = {}) => {
    const uniqueStudentIds = [...new Set(studentIds.filter(Boolean))];
    if (uniqueStudentIds.length === 0) return [];

    const paymentSnaps = await Promise.all(
        uniqueStudentIds.map((studentId) => getDocs(query(collection(db, `${BASE_PATH}/payments`), where("studentId", "==", studentId))))
    );

    const operations = [];

    if (deleteStudents) {
        uniqueStudentIds.forEach((studentId) => {
            operations.push((batch) => batch.delete(doc(db, `${BASE_PATH}/students`, studentId)));
            const student = rawStudents.find((entry) => entry.id === studentId) || {};
            operations.push((batch) => batch.delete(getEnrollmentRef(student.academicYear || currentAcademicYear, studentId)));
        });
    }

    paymentSnaps.forEach((snap) => {
        snap.forEach((paymentDoc) => {
            operations.push((batch) => batch.delete(paymentDoc.ref));
        });
    });

    studentGroups
        .filter((group) => group.memberIds.some((memberId) => uniqueStudentIds.includes(memberId)))
        .forEach((group) => {
            const nextMemberIds = group.memberIds.filter((memberId) => !uniqueStudentIds.includes(memberId));
            if (nextMemberIds.length < 2) {
                operations.push((batch) => batch.delete(doc(db, `${BASE_PATH}/studentGroups`, group.id)));
                return;
            }
            operations.push((batch) => batch.update(doc(db, `${BASE_PATH}/studentGroups`, group.id), { memberIds: nextMemberIds }));
        });

    return operations;
};

const deleteStudentsAndDependencies = async (studentIds) => {
    const operations = await buildStudentCleanupOperations(studentIds, { deleteStudents: true });
    await runBatchedWrites(operations);
};

// Drawer
const drawer = document.getElementById('side-drawer');
const overlay = document.getElementById('drawer-overlay');
const drawerNav = drawer?.querySelector('nav');
const resultExitBtn = document.getElementById('result-exit-btn');
const publicLogoutBtn = document.getElementById('admin-public-btn');
const openedFromCollection = new URLSearchParams(window.location.search).get('from') === 'collection';
let currentResultTabId = 'result-dashboard-tab';
const RESULT_DRAWER_TABS = [
    { tab: 'result-dashboard-tab', label: 'Dashboard', icon: 'fa-chart-line' },
    { tab: 'result-settings-tab', label: 'Settings', icon: 'fa-sliders' },
    { tab: 'result-subjects-tab', label: 'Manage Subjects', icon: 'fa-book' },
    { tab: 'result-grades-tab', label: 'Grade Rules', icon: 'fa-list-check' },
    { tab: 'result-marks-tab', label: 'Marks Entry', icon: 'fa-pen' },
    { tab: 'result-published-tab', label: 'Published', icon: 'fa-check-circle' },
    { tab: 'result-draft-tab', label: 'Draft', icon: 'fa-file-lines' },
    { tab: 'result-block-tab', label: 'Block Classes', icon: 'fa-ban' },
    { tab: 'result-snapshot-tab', label: 'Snapshot Export', icon: 'fa-download' },
    { tab: 'result-promotion-tab', label: 'Class Promotion', icon: 'fa-arrow-up-right-dots' }
];
const syncDrawerForResultManagement = (targetId = '') => {
    if (!drawerNav) return;
    const isResultPage = targetId === 'results';
    drawerNav.querySelectorAll('.drawer-heading, .nav-link').forEach((el) => {
        el.classList.toggle('hidden', isResultPage);
    });
    drawerNav.querySelectorAll('.result-drawer-link').forEach((el) => el.remove());
    if (isResultPage) {
        const allowedTabs = isResultOperatorSession
            ? new Set(['result-marks-tab', 'result-published-tab', 'result-draft-tab'])
            : new Set(RESULT_DRAWER_TABS.map((entry) => entry.tab));
        RESULT_DRAWER_TABS.filter((entry) => allowedTabs.has(entry.tab)).forEach((entry) => {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'result-drawer-link w-full text-left drawer-link flex items-center gap-3 p-3 transition';
            link.dataset.resultTab = entry.tab;
            link.innerHTML = `<i class="fas ${entry.icon} w-5 text-center"></i><span class="text-sm">${entry.label}</span>`;
            link.addEventListener('click', () => {
                switchResultTab(entry.tab);
                toggleDrawer(false);
            });
            drawerNav.appendChild(link);
        });
    }
    if (resultExitBtn) {
        const labelEl = resultExitBtn.querySelector('span');
        if (labelEl) labelEl.textContent = isResultPage ? 'Exit Result Management' : 'Admin Logout';
        resultExitBtn.onclick = isResultPage ? () => {
            if (isResultOperatorSession && openedFromCollection) window.location.href = 'collection.html';
            else activateAdminPage('dashboard', { pushHistory: true });
        } : () => window.logoutAdmin();
    }
    if (publicLogoutBtn) {
        const txt = publicLogoutBtn.querySelector('span');
        if (txt) txt.textContent = 'Logout';
        publicLogoutBtn.onclick = () => window.logoutAdmin();
        if (isResultPage && isResultOperatorSession) {
            publicLogoutBtn.classList.remove('hidden');
            resultExitBtn?.classList.add('hidden');
        } else if (isResultPage) {
            publicLogoutBtn.classList.add('hidden');
            resultExitBtn?.classList.remove('hidden');
        } else {
            publicLogoutBtn.classList.remove('hidden');
            resultExitBtn?.classList.remove('hidden');
        }
    }
};
const updateResultDrawerActiveState = () => {
    drawerNav?.querySelectorAll('.result-drawer-link').forEach((link) => {
        const isActive = link.dataset.resultTab === currentResultTabId;
        link.classList.toggle('bg-indigo-600', isActive);
        link.classList.toggle('text-white', isActive);
        link.classList.toggle('border', !isActive);
    });
};
const toggleDrawer = (open) => {
    if (!drawer || !overlay) return;
    if(open) { overlay.classList.remove('hidden'); setTimeout(()=>overlay.classList.remove('opacity-0'), 10); drawer.classList.remove('-translate-x-full'); }
    else { overlay.classList.add('opacity-0'); drawer.classList.add('-translate-x-full'); setTimeout(()=>overlay.classList.add('hidden'), 300); }
};
document.getElementById('hamburger-btn')?.addEventListener('click', () => toggleDrawer(true));
document.getElementById('close-drawer-btn')?.addEventListener('click', () => toggleDrawer(false));
overlay?.addEventListener('click', () => toggleDrawer(false));

const activateAdminPage = (targetId, options = {}) => {
    const { suppressDeniedAlert = false, pushHistory = true } = options;
    if (targetId === 'web-directory' || targetId === 'web-directory-entries') targetId = 'manage-staff';
    const setupReady = enforceSetupGate();
    if (!setupReady && !['dashboard', 'academic-years', 'manage-classes'].includes(targetId)) {
        if (!suppressDeniedAlert) alert('Complete Academic Year and Class setup first.');
        targetId = 'academic-years';
    }
    const requiredPermission = PAGE_PERMISSIONS[targetId];
    if (requiredPermission && !hasPermission(requiredPermission)) {
        if (!suppressDeniedAlert) alert('Your admin role does not allow access to this page.');
        targetId = 'dashboard';
    }
    document.querySelectorAll('.nav-link').forEach((link) => {
        const href = link.getAttribute('href');
        link.classList.toggle('active', href === `#${targetId}`);
    });
    document.querySelectorAll('.page').forEach((page) => page.classList.add('hidden'));
    document.getElementById(`${targetId}-page`).classList.remove('hidden');

    if(targetId === 'dashboard') renderDashboard();
    if(targetId === 'academic-years') renderAcademicYears();
    if(targetId === 'manage-students') { populateClassDropdowns(); renderStudentList(); }
    if(targetId === 'manage-classes') { populateClassDropdowns(); renderClassList(); }
    if(targetId === 'manage-groups') renderStudentGroups();
    if(targetId === 'results') renderResultManagement();
    if(targetId === 'manage-staff') { renderDirectoryCategories(); renderStaffList(); }
    if(targetId === 'fee-settings') renderFeeItemsManagement();
    if(targetId === 'fee-concessions') { populateClassDropdowns(); renderConcessionsList(); }
    if(targetId === 'web-directory') { renderDirectoryCategories(); }
    if(targetId === 'web-directory-entries') { renderDirectoryEntryForm(); renderDirectoryEntries(); }
    if(targetId === 'security-settings') { renderAdminRoleList(); renderSessionMonitor(); renderAuditLogList(); }
    syncDrawerForResultManagement(targetId);

    if(pushHistory) {
        const nextHash = `#${targetId}`;
        if(window.location.hash !== nextHash) history.pushState({ adminTab: targetId }, '', nextHash);
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    toggleDrawer(false);
};

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        if(e.currentTarget.hasAttribute('target')) { window.open(e.currentTarget.href, '_blank'); return; }
        const targetId = e.currentTarget.getAttribute('href').substring(1);
        activateAdminPage(targetId, { pushHistory: true });
    });
});

document.querySelectorAll('.admin-quick-action').forEach((button) => {
    button.addEventListener('click', () => activateAdminPage(button.dataset.targetPage, { pushHistory: true }));
});

window.addEventListener('hashchange', () => {
    if (isResultOperatorSession) {
        enforceResultOperatorModeUI();
        renderResultManagement();
        syncDrawerForResultManagement('results');
        return;
    }
    const targetId = (window.location.hash || '#dashboard').replace('#', '') || 'dashboard';
    activateAdminPage(targetId, { pushHistory: false, suppressDeniedAlert: true });
});
window.addEventListener('popstate', () => {
    if (isResultOperatorSession) {
        enforceResultOperatorModeUI();
        renderResultManagement();
        syncDrawerForResultManagement('results');
        return;
    }
    const targetId = (window.location.hash || '#dashboard').replace('#', '') || 'dashboard';
    activateAdminPage(targetId, { pushHistory: false, suppressDeniedAlert: true });
});
document.getElementById('admin-public-btn')?.addEventListener('click', () => window.logoutAdmin());
if (window.location.hash === '#results') {
    activateAdminPage('results', { pushHistory: false, suppressDeniedAlert: true });
} else {
    activateAdminPage((window.location.hash || '#dashboard').replace('#', '') || 'dashboard', { pushHistory: false, suppressDeniedAlert: true });
}

// --- 1. STAFF MANAGEMENT ---
const CORE_STAFF_TYPES = ['Teacher', 'Management'];
const getStaffTypeLabel = (type = '') => {
    if (CORE_STAFF_TYPES.includes(type)) return type;
    return getDirectoryCategories().find((category) => category.id === type)?.name || type || 'Staff';
};
const getStaffTypeOptions = () => [
    ...CORE_STAFF_TYPES.map((type) => ({ value: type, label: type })),
    ...getDirectoryCategories().map((category) => ({ value: category.id, label: category.name }))
];
const renderStaffTypeControls = () => {
    const options = getStaffTypeOptions();
    ['st-type', 'e-st-type'].forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
        if (options.some((option) => option.value === previous)) select.value = previous;
    });
    const filter = document.getElementById('staff-filter-type');
    if (filter) {
        const previous = filter.value || 'all';
        filter.innerHTML = '<option value="all">All Types</option>' + options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
        filter.value = options.some((option) => option.value === previous) ? previous : 'all';
    }
};

document.getElementById('add-staff-btn').addEventListener('click', async () => {
    if(!requirePermission('staff.manage')) return;
    const type = document.getElementById('st-type').value, name = document.getElementById('st-name').value.trim(), role = document.getElementById('st-role').value.trim();
    if(!type || !name || !role) return alert("Type, Name and Role are mandatory!");
    if (document.getElementById('st-can-collect').checked && !document.getElementById('st-password').value.trim()) {
        return alert("Collection access നൽകിയാൽ login password നിർബന്ധമാണ്.");
    }
    if(!confirm("പുതിയ സ്റ്റാഫിനെ ചേർക്കട്ടെ?")) return;
    const btn = document.getElementById('add-staff-btn'); btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

    const staffRecord = {
        type, name, role, phone: document.getElementById('st-phone').value.trim(), email: document.getElementById('st-email').value.trim(),
        password: document.getElementById('st-password').value.trim(),
        msr: document.getElementById('st-msr').value.trim(), address: document.getElementById('st-address').value.trim(),
        photo: document.getElementById('st-photo').value.trim(), isActive: document.getElementById('st-active').checked, canCollect: document.getElementById('st-can-collect').checked, canManageResults: document.getElementById('st-can-manage-results').checked,
        showPublic: document.getElementById('st-show-public').checked,
        displayOrder: Math.max(1, Number(document.getElementById('st-display-order').value || 999))
    };
    const staffDoc = await addDoc(collection(db, `${BASE_PATH}/staff`), staffRecord);
    await syncStaffAccessRecord(staffRecord);
    await logAuditEvent({ category: 'security', action: 'staff.create', entityType: 'staff', entityId: staffDoc.id, message: `Staff added: ${name}.` });
    alert("Staff Added Successfully!");
    ['st-name', 'st-role', 'st-phone', 'st-email', 'st-password', 'st-msr', 'st-address', 'st-photo'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('st-display-order').value = '999';
    document.getElementById('st-active').checked = true;
    document.getElementById('st-can-collect').checked = true;
    document.getElementById('st-can-manage-results').checked = false;
    document.getElementById('st-show-public').checked = true;
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus mr-2"></i> Add Staff';
});

const renderStaffList = () => {
    renderStaffTypeControls();
    const actTCont = document.getElementById('active-teachers-list');
    const actMCont = document.getElementById('active-mgmt-list');
    const categoryCont = document.getElementById('active-category-staff-list');
    const inactCont = document.getElementById('inactive-staff-container');
    const typeFilter = document.getElementById('staff-filter-type')?.value || 'all';
    const searchTerm = String(document.getElementById('staff-filter-search')?.value || '').trim().toLowerCase();
    const matchesFilters = (staffMember) => {
        if (typeFilter !== 'all' && staffMember.type !== typeFilter) return false;
        if (!searchTerm) return true;
        const haystack = `${staffMember.name || ''} ${staffMember.role || ''} ${staffMember.phone || ''} ${staffMember.email || ''} ${getStaffTypeLabel(staffMember.type)}`.toLowerCase();
        return haystack.includes(searchTerm);
    };
    const active = allStaff.filter((s) => s.isActive && matchesFilters(s));
    const inactive = allStaff.filter((s) => !s.isActive && matchesFilters(s));
    const sortByDisplayOrder = (list = []) => [...list].sort((a, b) => {
        const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
        if (orderDiff !== 0) return orderDiff;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
    const buildHTML = (list, isAct) => list.map((staffMember) => {
        const safePhoto = sanitizeUrl(staffMember.photo) || 'https://via.placeholder.com/60';
        const typeLabel = getStaffTypeLabel(staffMember.type);
        return `
            <div class="flex flex-col sm:flex-row justify-between p-4 bg-white border border-gray-200 rounded-xl shadow-sm items-start sm:items-center gap-4 transition hover:shadow-md mb-2">
                <div class="flex gap-4 items-center w-full sm:w-auto">
                    <img src="${safePhoto}" class="w-14 h-14 rounded-full object-cover border-2 ${staffMember.type === 'Teacher' ? 'border-blue-200' : staffMember.type === 'Management' ? 'border-purple-200' : 'border-emerald-200'}" alt="${escapeHtml(staffMember.name || 'Staff member')}">
                    <div>
                        <b class="text-gray-900 text-lg">${escapeHtml(staffMember.name || '--')}</b>
                        <div class="text-sm text-gray-500 font-medium mt-0.5"><i class="fas fa-briefcase text-gray-400 mr-1"></i> ${escapeHtml(staffMember.role || '--')}</div>
                        <div class="text-[11px] text-slate-600 bg-slate-50 px-2 py-0.5 rounded mt-1 inline-block font-bold">${escapeHtml(typeLabel)}</div>
                        ${staffMember.email ? `<div class="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded mt-1 inline-block font-mono">Email: ${escapeHtml(staffMember.email)}</div>` : ''}
                        <div class="mt-2 flex flex-wrap gap-2">${staffMember.isActive ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>' : '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Inactive</span>'}${staffMember.showPublic !== false ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Public</span>' : '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Hidden Public</span>'}${staffMember.canCollect ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Collection Access</span>' : '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">No Collection Access</span>'}${staffMember.canManageResults ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">Result Access</span>' : ''}</div>
                    </div>
                </div>
                <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                    <button class="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold flex-1 hover:bg-blue-100 transition staff-action-btn" data-action="edit" data-id="${staffMember.id}"><i class="fas fa-edit"></i> Edit</button>
                    <button class="px-4 py-2 bg-violet-50 text-violet-700 rounded-lg text-sm font-bold flex-1 hover:bg-violet-100 transition staff-action-btn" data-action="credential" data-id="${staffMember.id}"><i class="fas fa-key"></i> Reset Login</button>
                    <button class="px-4 py-2 ${isAct ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'} rounded-lg text-sm font-bold flex-1 transition staff-action-btn" data-action="toggle" data-id="${staffMember.id}" data-next-state="${isAct ? 'false' : 'true'}"><i class="fas ${isAct ? 'fa-ban' : 'fa-check-circle'}"></i> ${isAct ? 'Deactivate' : 'Activate'}</button>
                    <button class="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-bold flex-1 hover:bg-red-100 transition staff-action-btn" data-action="delete" data-id="${staffMember.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    }).join('');
    const activeTeachers = sortByDisplayOrder(active.filter((s) => s.type === 'Teacher'));
    const activeManagement = sortByDisplayOrder(active.filter((s) => s.type === 'Management'));
    actTCont.innerHTML = activeTeachers.length ? buildHTML(activeTeachers, true) : '<p class="text-sm text-gray-500 italic p-2">No active teachers found.</p>';
    actMCont.innerHTML = activeManagement.length ? buildHTML(activeManagement, true) : '<p class="text-sm text-gray-500 italic p-2">No active management found.</p>';
    const categorySections = getDirectoryCategories().map((category) => {
        const rows = sortByDisplayOrder(active.filter((s) => s.type === category.id));
        return `<div class="card p-5 rounded-xl shadow-sm border border-emerald-100"><h2 class="text-xl font-bold mb-4 text-emerald-800 border-b border-emerald-100 pb-2"><i class="fas fa-users mr-2"></i>${escapeHtml(category.name)}</h2>${rows.length ? buildHTML(rows, true) : '<p class="text-sm text-gray-500 italic p-2">No active profiles in this category.</p>'}</div>`;
    }).join('');
    if (categoryCont) categoryCont.innerHTML = categorySections;
    const inactiveSections = getStaffTypeOptions().map((option) => {
        const rows = sortByDisplayOrder(inactive.filter((s) => s.type === option.value));
        return `<h4 class="font-bold text-gray-700 mb-2 border-b pb-1">Inactive ${escapeHtml(option.label)}</h4><div class="mb-4">${rows.length ? buildHTML(rows, false) : '<p class="text-sm text-gray-500 italic">No inactive profiles.</p>'}</div>`;
    }).join('');
    inactCont.innerHTML = inactiveSections;
};

window.toggleStaffStatus = async (id, status) => {
    if(!requirePermission('staff.manage')) return;
    if(!confirm(`അക്കൗണ്ട് ${status ? 'ആക്റ്റീവ്' : 'ഇൻ-ആക്റ്റീവ്'} ആക്കട്ടെ?`)) return;
    const staffRecord = allStaff.find((staffMember) => staffMember.id === id);
    await updateDoc(doc(db, `${BASE_PATH}/staff`, id), { isActive: status });
    if (staffRecord?.email) await syncStaffAccessRecord({ ...staffRecord, isActive: status });
    await logAuditEvent({ category: 'security', action: 'staff.status', entityType: 'staff', entityId: id, message: `Staff account ${status ? 'activated' : 'deactivated'}.` });
};
window.deleteStaff = async (id) => {
    if(!requirePermission('staff.manage')) return;
    if(!confirm("സ്ഥിരമായി ഡിലീറ്റ് ചെയ്യട്ടെ?")) return;
    const staffRecord = allStaff.find((staffMember) => staffMember.id === id);
    await deleteDoc(doc(db, `${BASE_PATH}/staff`, id));
    if (staffRecord?.email) await removeStaffAccessRecord(staffRecord.email);
    await logAuditEvent({ category: 'security', action: 'staff.delete', entityType: 'staff', entityId: id, message: 'Staff record deleted.' });
};

window.openEditStaff = (id) => {
    if(!requirePermission('staff.manage')) return;
    const s = allStaff.find(st => st.id === id); if(!s) return;
    editingStaffId = s.id;
    renderStaffTypeControls();
    document.getElementById('e-st-type').value = s.type||'Teacher'; document.getElementById('e-st-name').value = s.name||'';
    document.getElementById('e-st-role').value = s.role||''; document.getElementById('e-st-phone').value = s.phone||'';
    document.getElementById('e-st-email').value = s.email||''; document.getElementById('e-st-password').value = s.password||'';
    document.getElementById('e-st-msr').value = s.msr||'';
    document.getElementById('e-st-photo').value = s.photo||''; document.getElementById('e-st-addr').value = s.address||'';
    document.getElementById('e-st-display-order').value = Math.max(1, Number(s.displayOrder || 999));
    document.getElementById('e-st-active').checked = s.isActive;
    document.getElementById('e-st-can-collect').checked = s.canCollect !== false;
    document.getElementById('e-st-can-manage-results').checked = s.canManageResults === true;
    document.getElementById('e-st-show-public').checked = s.showPublic !== false;
    document.getElementById('edit-staff-popup').classList.remove('hidden'); document.getElementById('edit-staff-popup').classList.add('flex');
};
document.getElementById('manage-staff-page').addEventListener('click', (e) => {
    const button = e.target.closest('.staff-action-btn');
    if (!button) return;
    const { action, id, nextState } = button.dataset;
    if (action === 'edit') window.openEditStaff(id);
    if (action === 'credential') window.resetStaffCredentials(id);
    if (action === 'toggle') window.toggleStaffStatus(id, nextState === 'true');
    if (action === 'delete') window.deleteStaff(id);
});
document.getElementById('staff-filter-search')?.addEventListener('input', renderStaffList);
document.getElementById('staff-filter-type')?.addEventListener('change', renderStaffList);
document.getElementById('edit-staff-cancel').onclick = () => document.getElementById('edit-staff-popup').classList.add('hidden');
document.getElementById('edit-staff-update').onclick = async () => {
    if(!requirePermission('staff.manage')) return;
    const type = document.getElementById('e-st-type').value, name = document.getElementById('e-st-name').value.trim(), role = document.getElementById('e-st-role').value.trim();
    if(!type || !name || !role) return alert("Type, Name and Role are mandatory!");
    if (document.getElementById('e-st-can-collect').checked && !document.getElementById('e-st-password').value.trim()) {
        return alert("Collection access enabled ആണെങ്കിൽ password നൽകണം.");
    }
    if(!confirm("മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;
    const existingStaff = allStaff.find((staffMember) => staffMember.id === editingStaffId) || {};
    const nextStaffRecord = {
        type, name, role, email: document.getElementById('e-st-email').value.trim(), phone: document.getElementById('e-st-phone').value.trim(),
        password: document.getElementById('e-st-password').value.trim(),
        msr: document.getElementById('e-st-msr').value.trim(), photo: document.getElementById('e-st-photo').value.trim(),
        address: document.getElementById('e-st-addr').value.trim(), isActive: document.getElementById('e-st-active').checked, canCollect: document.getElementById('e-st-can-collect').checked, canManageResults: document.getElementById('e-st-can-manage-results').checked,
        showPublic: document.getElementById('e-st-show-public').checked,
        displayOrder: Math.max(1, Number(document.getElementById('e-st-display-order').value || 999))
    };
    await updateDoc(doc(db, `${BASE_PATH}/staff`, editingStaffId), nextStaffRecord);
    if (existingStaff.email && normalizeEmail(existingStaff.email) !== normalizeEmail(nextStaffRecord.email)) {
        await removeStaffAccessRecord(existingStaff.email);
    }
    await syncStaffAccessRecord(nextStaffRecord);
    await logAuditEvent({ category: 'security', action: 'staff.update', entityType: 'staff', entityId: editingStaffId, message: `Staff updated: ${name}.` });
    document.getElementById('edit-staff-popup').classList.add('hidden');
};

window.resetStaffCredentials = async (id) => {
    if(!requirePermission('staff.manage')) return;
    const staffRecord = allStaff.find((staffMember) => staffMember.id === id);
    if (!staffRecord) return;
    const nextEmail = prompt('New login email for this staff account:', staffRecord.email || '');
    if (nextEmail === null) return;
    const normalizedNextEmail = normalizeEmail(nextEmail);
    if (!normalizedNextEmail) return alert('Valid email is required.');
    const nextPassword = prompt('New login password for this staff account:', staffRecord.password || '');
    if (nextPassword === null) return;
    if (!nextPassword.trim()) return alert('Password cannot be empty.');
    if(!confirm(`${staffRecord.name || 'Staff'}-ന് പുതിയ login credentials save ചെയ്യട്ടേ?`)) return;

    const nextStaffPayload = {
        ...staffRecord,
        email: normalizedNextEmail,
        password: nextPassword.trim()
    };
    await updateDoc(doc(db, `${BASE_PATH}/staff`, id), {
        email: normalizedNextEmail,
        password: nextPassword.trim()
    });
    if (staffRecord.email && normalizeEmail(staffRecord.email) !== normalizedNextEmail) {
        await removeStaffAccessRecord(staffRecord.email);
    }
    await syncStaffAccessRecord(nextStaffPayload);
    await logAuditEvent({
        category: 'security',
        action: 'staff.credentials.rotate',
        entityType: 'staff',
        entityId: id,
        message: `Staff login credentials updated for ${staffRecord.name || normalizedNextEmail}.`
    });
    alert(`New credentials saved.\n\nStaff: ${staffRecord.name || '--'}\nEmail: ${normalizedNextEmail}\nPassword: ${nextPassword.trim()}\n\nShare securely with staff.`);
};

// --- 2. ADD STUDENTS ---
window.downloadCSVTemplate = () => {
    const csvData = "Class,ID_UID,Name,Father_Name,Gender,Status,Mobile,Adm_No,Permanent_Address\n";
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.setAttribute('hidden', ''); a.setAttribute('href', url); a.setAttribute('download', 'student_upload_template.csv');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

const dropZone = document.getElementById('excel-drop-zone'), fileInput = document.getElementById('excel-file-input');
let excelParsedData = [];
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); if(e.dataTransfer.files.length) handleExcelFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', (e) => { if(e.target.files.length) handleExcelFile(e.target.files[0]); });

function handleExcelFile(file) {
    const selectedBulkClass = (document.getElementById('bulk-upload-class')?.value || '').toUpperCase().trim();
    if(!selectedBulkClass) {
        alert('ആദ്യം Target Class select ചെയ്യണം.');
        fileInput.value = '';
        return;
    }
    document.getElementById('excel-file-name').textContent = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result), workbook = XLSX.read(data, {type: 'array'});
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {defval: ""});
            if(rawData.length === 0) return alert("File is empty.");

            const normalizeHeader = (value = '') => value.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
            const aliasMap = {
                uid: ['iduid', 'id', 'uid', 'rollno', 'rollnumber'],
                name: ['name', 'studentname', 'student'],
                father: ['fathername', 'father', 'parent', 'fatherguardian'],
                gender: ['gender', 'sex'],
                status: ['status', 'state'],
                mobile: ['mobile', 'phone', 'mobileno', 'phonenumber'],
                adm: ['admno', 'admissionno', 'admissionnumber', 'adm', 'admn'],
                address: ['permanentaddress', 'address', 'permanent', 'addr']
            };
            excelParsedData = rawData.map(row => {
                const keys = Object.keys(row);
                const getVal = (aliases = []) => {
                    const key = keys.find((col) => aliases.includes(normalizeHeader(col)));
                    return key ? String(row[key] ?? '').trim() : '';
                };
                const rawName = getVal(aliasMap.name);
                return {
                    academicYear: activeAcademicYear || currentAcademicYear,
                    name: rawName ? rawName.toUpperCase().trim() : "",
                    class: selectedBulkClass,
                    status: normalizeStudentStatus(getVal(aliasMap.status)),
                    gender: getVal(aliasMap.gender).toLowerCase().startsWith('f') ? 'Female' : 'Male',
                    uid: getVal(aliasMap.uid),
                    father: getVal(aliasMap.father).toUpperCase().trim(),
                    mobile: getVal(aliasMap.mobile),
                    adm: getVal(aliasMap.adm).toUpperCase().trim(),
                    address: getVal(aliasMap.address).trim()
                };
            }).filter(s => s.name);

            document.getElementById('excel-record-count').textContent = `Found ${excelParsedData.length} valid records`;
            document.getElementById('excel-drop-zone').classList.add('hidden'); document.getElementById('excel-preview-area').classList.remove('hidden');
            document.getElementById('upload-progress-bar').style.display = 'none'; document.getElementById('upload-status-text').textContent = "Ready to upload";
        } catch(err) { console.error(err); alert("Error reading file."); }
    };
    reader.readAsArrayBuffer(file);
}

document.getElementById('cancel-upload-btn').addEventListener('click', () => { fileInput.value = ''; excelParsedData = []; document.getElementById('excel-drop-zone').classList.remove('hidden'); document.getElementById('excel-preview-area').classList.add('hidden'); });

document.getElementById('start-upload-btn').addEventListener('click', async () => {
    if(!requirePermission('students.manage')) return;
    if(excelParsedData.length === 0) return;
    const selectedBulkClass = (document.getElementById('bulk-upload-class')?.value || '').toUpperCase().trim();
    if(!selectedBulkClass) return alert('Target Class select ചെയ്യണം.');
    if(!confirm(`${excelParsedData.length} കുട്ടികളെ ആഡ് ചെയ്യട്ടെ?`)) return;

    const btn = document.getElementById('start-upload-btn'), bar = document.getElementById('upload-progress-bar'), fill = document.getElementById('upload-progress-fill'), status = document.getElementById('upload-status-text');
    const existingKeys = new Set(students.map((student) => `${student.class}::${student.adm || ''}::${student.uid || ''}::${student.name}`));
    const dedupedData = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    excelParsedData.forEach((student) => {
        const key = `${student.class}::${student.adm || ''}::${student.uid || ''}::${student.name}`;
        if (seenKeys.has(key) || existingKeys.has(key)) {
            duplicateCount += 1;
            return;
        }
        seenKeys.add(key);
        dedupedData.push(student);
    });
    if (!dedupedData.length) return alert('All uploaded rows are duplicates of existing or repeated student records.');
    btn.disabled = true; document.getElementById('cancel-upload-btn').disabled = true; bar.style.display = 'block';
    let successCount = 0;
    for(let i=0; i<dedupedData.length; i+=100) {
        const chunk = dedupedData.slice(i, i+100); const batch = writeBatch(db);
        chunk.forEach((s) => {
            const studentRef = doc(collection(db, `${BASE_PATH}/students`));
            batch.set(studentRef, s);
            batch.set(getEnrollmentRef(s.academicYear || currentAcademicYear, studentRef.id), buildEnrollmentPayload(studentRef.id, s), { merge: true });
        });
        await batch.commit(); successCount += chunk.length; fill.style.width = `${(successCount/dedupedData.length)*100}%`; status.textContent = `Uploading ${successCount} / ${dedupedData.length} ...`;
    }
    await syncActiveAcademicYearClasses(dedupedData.map((student) => student.class));
    await logAuditEvent({ category: 'student', action: 'student.import', entityType: 'student', message: `Bulk import added ${successCount} students${duplicateCount ? ` and skipped ${duplicateCount} duplicates` : ''}.`, metadata: { successCount, duplicateCount } });
    status.innerHTML = `<span class="text-green-600 font-bold">✔ Successfully uploaded ${successCount} students${duplicateCount ? ` (skipped ${duplicateCount} duplicates)` : ''}!</span>`;
    btn.disabled = false;
    document.getElementById('cancel-upload-btn').disabled = false;
    alert(`Upload completed.\nAdded: ${successCount}\n${duplicateCount ? `Skipped duplicates: ${duplicateCount}` : 'No duplicates skipped.'}`);
    document.getElementById('cancel-upload-btn').click();
});

document.getElementById('add-manual-btn').addEventListener('click', async () => {
    if(!requirePermission('students.manage')) return;
    const cls = document.getElementById('add-stu-class').value.toUpperCase().trim(), name = document.getElementById('add-stu-name').value.toUpperCase().trim(), gender = document.getElementById('add-stu-gender').value;
    if(!cls || !name || !gender) return alert("Class, Name and Gender are mandatory.");
    if(!confirm("വിദ്യാർത്ഥിയെ ആഡ് ചെയ്യട്ടെ?")) return;

    const nextStudent = { academicYear: activeAcademicYear || currentAcademicYear, class: cls, name: name, gender: gender, status: normalizeStudentStatus(document.getElementById('add-stu-status').value), uid: document.getElementById('add-stu-uid').value.trim(), adm: document.getElementById('add-stu-adm').value.toUpperCase().trim(), mobile: document.getElementById('add-stu-mobile').value.trim(), father: document.getElementById('add-stu-father').value.toUpperCase().trim(), address: document.getElementById('add-stu-address').value.trim() };
    const duplicateStudent = students.find((student) => student.class === cls && student.name === name && (student.adm || '') === nextStudent.adm && (student.uid || '') === nextStudent.uid);
    if (duplicateStudent) return alert('A matching student already exists in this academic year.');
    document.getElementById('add-manual-btn').disabled = true;
    const studentDoc = await addDoc(collection(db, `${BASE_PATH}/students`), nextStudent);
    await syncEnrollmentRecord(studentDoc.id, nextStudent);
    await syncActiveAcademicYearClasses([cls]);
    await logAuditEvent({ category: 'student', action: 'student.create', entityType: 'student', entityId: studentDoc.id, message: `Student added: ${name}.` });
    alert("Student Added!"); ['add-stu-class','add-stu-uid','add-stu-name','add-stu-father','add-stu-mobile','add-stu-adm','add-stu-address'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('add-stu-status').value = 'Active';
    document.getElementById('add-manual-btn').disabled = false;
});


// --- 3. MANAGE STUDENTS ---
const populateClassDropdowns = () => {
    classes = getClassesForActiveYear();
    const opts = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    const dataList = document.getElementById('class-suggestions');
    if (dataList) dataList.innerHTML = opts;

    const filterManage = document.getElementById('filter-manage-class'); const prevManageVal = filterManage.value;
    filterManage.innerHTML = `<option value="all">All Classes</option>` + opts + `<option value="GRADUATED">Graduated</option>`;
    if(prevManageVal === 'all' || prevManageVal === 'GRADUATED' || classes.includes(prevManageVal)) filterManage.value = prevManageVal;

    const filterConc = document.getElementById('filter-conc-class'); const prevConcVal = filterConc.value;
    filterConc.innerHTML = `<option value="">-- Select Class --</option>` + opts; if(classes.includes(prevConcVal)) filterConc.value = prevConcVal;
    const bulkClassSel = document.getElementById('bulk-upload-class');
    if (bulkClassSel) {
        const prevBulkClass = bulkClassSel.value;
        bulkClassSel.innerHTML = `<option value="">-- Select Class --</option>` + opts;
        if (classes.includes(prevBulkClass)) bulkClassSel.value = prevBulkClass;
    }
};

const renderStudentList = () => {
    const fCls = document.getElementById('filter-manage-class').value;
    const fGen = document.getElementById('filter-manage-gender').value;
    const fStatus = document.getElementById('filter-manage-status').value;
    const sortType = document.getElementById('sort-manage-students').value;
    const sTerm = document.getElementById('search-student-input').value.toLowerCase();
    const cont = document.getElementById('student-list-container');
    const emptyState = document.getElementById('student-list-empty-state');

    emptyState.classList.add('hidden'); cont.classList.remove('hidden');

    const fil = students.filter(s => {
        let match = true;
        if(fCls !== 'all') {
            if (fCls === 'GRADUATED') match = match && (normalizeStudentStatus(s.status) === 'Graduated' || String(s.class || '').toUpperCase() === 'GRADUATED');
            else match = match && s.class === fCls;
        }
        if(fGen !== 'all') match = match && s.gender === fGen;
        if(fStatus !== 'all') match = match && normalizeStudentStatus(s.status) === fStatus;
        if(sTerm) match = match && (s.name.toLowerCase().includes(sTerm) || (s.adm && s.adm.toLowerCase().includes(sTerm)));
        return match;
    });

    if(fil.length === 0) { cont.innerHTML = '<p class="text-gray-500 p-4 text-center font-medium">No students found.</p>'; return; }

    const compareByAdmission = (a, b) => {
        const admA = a.adm ? a.adm.toString().trim() : ""; const admB = b.adm ? b.adm.toString().trim() : "";
        if (admA === "" && admB === "") return (a.name || '').localeCompare(b.name || '');
        if (admA === "") return 1; if (admB === "") return -1;
        const numA = parseFloat(admA); const numB = parseFloat(admB);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        return admA.localeCompare(admB, undefined, {numeric: true});
    };
    if (sortType === 'male-first') {
        fil.sort((a, b) => {
            const genderOrder = (a.gender === 'Male' ? 0 : 1) - (b.gender === 'Male' ? 0 : 1);
            if (genderOrder !== 0) return genderOrder;
            return compareByAdmission(a, b);
        });
    } else if (sortType === 'name-asc') {
        fil.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
        fil.sort(compareByAdmission);
    }

    let html = `
    <table class="w-full text-sm text-left whitespace-nowrap">
        <thead class="table-header">
            <tr><th class="p-3 w-16 text-center">Sl. No</th><th class="p-3">Adm.No</th><th class="p-3">Name</th><th class="p-3">Class, Gender & Status</th><th class="p-3">Mobile</th><th class="p-3 text-right">Actions</th></tr>
        </thead><tbody class="divide-y divide-gray-200">`;

    fil.forEach((s, i) => {
        const status = normalizeStudentStatus(s.status);
        html += `
        <tr class="hover:bg-gray-50 bg-white">
            <td class="p-3 text-center font-bold text-gray-400">${i + 1}</td>
            <td class="p-3 font-mono text-gray-500 font-medium">${escapeHtml(s.adm || '-')}</td>
            <td class="p-3 font-bold text-gray-900">${escapeHtml(s.name || '-')}</td>
            <td class="p-3 text-gray-600"><div>${escapeHtml(s.class || '--')} (${escapeHtml(s.gender || '--')})</div><div class="mt-1 inline-flex px-2 py-0.5 rounded-full border text-xs font-bold ${getStudentStatusBadgeClass(status)}">${escapeHtml(status)}</div></td>
            <td class="p-3 text-gray-500">${escapeHtml(s.mobile || '-')}</td>
            <td class="p-3 text-right">
                <button class="edit-student-btn bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-md mr-2" data-id="${s.id}"><i class="fas fa-edit"></i> Edit</button>
                <button class="delete-student-btn bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-md" data-id="${s.id}"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    });
    cont.innerHTML = html + `</tbody></table>`;
};
document.getElementById('filter-manage-class').addEventListener('change', renderStudentList);
document.getElementById('filter-manage-gender').addEventListener('change', renderStudentList);
document.getElementById('filter-manage-status').addEventListener('change', renderStudentList);
document.getElementById('search-student-input').addEventListener('input', renderStudentList);
document.getElementById('sort-manage-students').addEventListener('change', renderStudentList);

document.getElementById('student-list-container').addEventListener('click', e => {
    const delBtn = e.target.closest('.delete-student-btn'), editBtn = e.target.closest('.edit-student-btn');
    if(delBtn) {
        if(!confirm("ഈ വിദ്യാർത്ഥിയെയും അവരുടെ എല്ലാ ഫീസ് വിവരങ്ങളും സ്ഥിരമായി ഡിലീറ്റ് ചെയ്യട്ടെ?")) return;
        deleteStudentsAndDependencies([delBtn.dataset.id]).then(() => logAuditEvent({ category: 'student', action: 'student.delete', entityType: 'student', entityId: delBtn.dataset.id, message: 'Student record deleted with linked cleanup.' })).catch((error) => {
            console.error('Failed to delete student dependencies.', error);
            alert('Failed to delete the student completely. Please try again.');
        });
    }
    if(editBtn) {
        if(!requirePermission('students.manage')) return;
        const st = students.find(s=>s.id === editBtn.dataset.id);
        if(st) {
            editingStudentId = st.id;
            document.getElementById('e-stu-class').value = st.class||''; document.getElementById('e-stu-gender').value = st.gender||'Male';
            document.getElementById('e-stu-name').value = st.name||''; document.getElementById('e-stu-adm').value = st.adm||'';
            document.getElementById('e-stu-mob').value = st.mobile||''; document.getElementById('e-stu-fat').value = st.father||'';
            document.getElementById('e-stu-uid').value = st.uid||''; document.getElementById('e-stu-addr').value = st.address||'';
            document.getElementById('e-stu-status').value = normalizeStudentStatus(st.status);
            document.getElementById('edit-student-popup').classList.remove('hidden'); document.getElementById('edit-student-popup').classList.add('flex');
        }
    }
});
document.getElementById('edit-student-update').addEventListener('click', async () => {
    if(!requirePermission('students.manage')) return;
    if(!confirm("വിദ്യാർത്ഥിയുടെ വിവരങ്ങൾ അപ്ഡേറ്റ് ചെയ്യട്ടെ?")) return;
    const updatedClass = document.getElementById('e-stu-class').value.toUpperCase().trim();
    const updatedPayload = { name: document.getElementById('e-stu-name').value.toUpperCase().trim(), class: updatedClass, gender: document.getElementById('e-stu-gender').value, status: normalizeStudentStatus(document.getElementById('e-stu-status').value), adm: document.getElementById('e-stu-adm').value.toUpperCase().trim(), mobile: document.getElementById('e-stu-mob').value.trim(), father: document.getElementById('e-stu-fat').value.toUpperCase().trim(), uid: document.getElementById('e-stu-uid').value.trim(), address: document.getElementById('e-stu-addr').value.trim() };
    await updateDoc(doc(db, `${BASE_PATH}/students`, editingStudentId), updatedPayload);
    const existingStudent = rawStudents.find((student) => student.id === editingStudentId) || {};
    await syncEnrollmentRecord(editingStudentId, { ...existingStudent, ...updatedPayload });
    await syncActiveAcademicYearClasses([updatedClass]);
    await logAuditEvent({ category: 'student', action: 'student.update', entityType: 'student', entityId: editingStudentId, message: 'Student record updated.' });
    document.getElementById('edit-student-popup').classList.add('hidden');
});
document.getElementById('edit-student-cancel').addEventListener('click', () => document.getElementById('edit-student-popup').classList.add('hidden'));

const getManagedStudentsForExport = () => {
    const fCls = document.getElementById('filter-manage-class').value;
    const fGen = document.getElementById('filter-manage-gender').value;
    const fStatus = document.getElementById('filter-manage-status').value;
    const sortType = document.getElementById('sort-manage-students').value;
    const sTerm = document.getElementById('search-student-input').value.toLowerCase();
    const compareByAdmission = (a, b) => {
        const admA = a.adm ? a.adm.toString().trim() : ""; const admB = b.adm ? b.adm.toString().trim() : "";
        if (admA === "" && admB === "") return (a.name || '').localeCompare(b.name || '');
        if (admA === "") return 1; if (admB === "") return -1;
        const numA = parseFloat(admA); const numB = parseFloat(admB);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        return admA.localeCompare(admB, undefined, {numeric: true});
    };
    const filtered = students.filter((s) => {
        let match = true;
        if(fCls !== 'all') {
            if (fCls === 'GRADUATED') match = match && (normalizeStudentStatus(s.status) === 'Graduated' || String(s.class || '').toUpperCase() === 'GRADUATED');
            else match = match && s.class === fCls;
        }
        if(fGen !== 'all') match = match && s.gender === fGen;
        if(fStatus !== 'all') match = match && normalizeStudentStatus(s.status) === fStatus;
        if(sTerm) match = match && ((s.name || '').toLowerCase().includes(sTerm) || ((s.adm || '').toLowerCase().includes(sTerm)));
        return match;
    });
    if (sortType === 'male-first') {
        filtered.sort((a, b) => {
            const genderOrder = (a.gender === 'Male' ? 0 : 1) - (b.gender === 'Male' ? 0 : 1);
            if (genderOrder !== 0) return genderOrder;
            return compareByAdmission(a, b);
        });
    } else if (sortType === 'name-asc') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
        filtered.sort(compareByAdmission);
    }
    return filtered;
};
const buildStudentExportRows = () => getManagedStudentsForExport().map((student, index) => ({
    'Sl. No': index + 1,
    'Academic Year': student.academicYear || activeAcademicYear || currentAcademicYear,
    'Class': student.class || '',
    'Adm No': student.adm || '',
    'Name': student.name || '',
    'Gender': student.gender || '',
    'Status': normalizeStudentStatus(student.status),
    'Mobile': student.mobile || '',
    'UID': student.uid || '',
    'Father Name': student.father || '',
    'Address': student.address || '',
    'Concession Fee': student.concessionFee ?? ''
}));
const exportStudentsToExcel = () => {
    const exportRows = buildStudentExportRows();
    if (exportRows.length === 0) {
        alert('No students available to export.');
        return;
    }
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    worksheet['!cols'] = [
        { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 10 },
        { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 32 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
    XLSX.writeFile(workbook, `students-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
};
const exportStudentsToCSV = () => {
    const exportRows = buildStudentExportRows();
    if (exportRows.length === 0) return alert('No students available to export.');
    const headers = Object.keys(exportRows[0]);
    const csv = [
        headers.join(','),
        ...exportRows.map((row) => headers.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `students-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
const exportStudentsToPDF = () => {
    const exportRows = buildStudentExportRows();
    if (exportRows.length === 0) return alert('No students available to export.');
    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF({ orientation: 'landscape' });
    docPdf.setFontSize(14);
    docPdf.text('Students Export (Filtered/Sorted)', 14, 14);
    docPdf.autoTable({
        startY: 20,
        head: [['Sl. No', 'Class', 'Adm No', 'Name', 'Gender', 'Status', 'Mobile']],
        body: exportRows.map((row) => [row['Sl. No'], row['Class'], row['Adm No'], row['Name'], row['Gender'], row['Status'], row['Mobile']]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37, 99, 235] }
    });
    docPdf.save(`students-export-${new Date().toISOString().slice(0, 10)}.pdf`);
};

document.getElementById('export-students-excel-btn')?.addEventListener('click', exportStudentsToExcel);
document.getElementById('export-students-csv-btn')?.addEventListener('click', exportStudentsToCSV);
document.getElementById('export-students-pdf-btn')?.addEventListener('click', exportStudentsToPDF);

// --- 4. MANAGE CLASSES ---
const renderClassList = () => {
    const cont = document.getElementById('class-list-container');
    if(classes.length === 0) { cont.innerHTML = '<p class="text-gray-500">No classes found for the active academic year yet.</p>'; return; }
    cont.innerHTML = classes.map(c => `<div class="flex justify-between items-center bg-white shadow-sm border border-gray-200 p-4 rounded-xl"><span class="font-bold text-gray-800 text-lg">${escapeHtml(c)}</span><div><button class="bg-blue-50 text-blue-600 hover:bg-blue-100 p-2 rounded-lg mr-2 edit-class-btn transition" data-class="${escapeHtml(c)}"><i class="fas fa-edit"></i></button><button class="bg-red-50 text-red-600 hover:bg-red-100 p-2 rounded-lg delete-class-btn transition" data-class="${escapeHtml(c)}"><i class="fas fa-trash"></i></button></div></div>`).join('');

    document.getElementById('move-from-class').innerHTML = `<option value="">-- Select --</option>` + classes.map(c=>`<option value="${c}">${c}</option>`).join('');
    document.getElementById('move-target-sel').innerHTML = classes.map(c=>`<option value="${c}">${c}</option>`).join('');
};
document.getElementById('create-class-btn').addEventListener('click', async () => {
    if(!requirePermission('classes.manage')) return;
    const className = document.getElementById('new-class-name-input').value.trim().toUpperCase();
    if(!className) return alert('Enter a class/division name.');
    if(classes.includes(className)) return alert('This class/division already exists in the active academic year.');
    await syncActiveAcademicYearClasses([className]);
    await logAuditEvent({ category: 'class', action: 'class.create', entityType: 'class', entityId: className, message: `Class created: ${className}.` });
    document.getElementById('new-class-name-input').value = '';
    alert('Class/division created successfully.');
});
document.getElementById('generate-default-classes-btn')?.addEventListener('click', async () => {
    if(!requirePermission('classes.manage')) return;
    if(!confirm('Reset active year classes to default ladder (1 to 12)?')) return;
    await syncActiveAcademicYearClasses(getDefaultClassLadder(), { replace: true });
    await logAuditEvent({ category: 'class', action: 'class.default.generate', entityType: 'academicYear', entityId: getActiveAcademicYearLabel(), message: 'Default class ladder generated (1 to 12).' });
});
document.getElementById('create-divisions-btn')?.addEventListener('click', async () => {
    if(!requirePermission('classes.manage')) return;
    const baseClass = document.getElementById('division-base-class-input')?.value || '';
    const divisionCount = document.getElementById('division-count-input')?.value || 3;
    const labels = buildDivisionLabels(baseClass, divisionCount);
    if (!labels.length) return alert('Enter a valid base class for divisions.');
    await syncActiveAcademicYearClasses([...classes, ...labels]);
    await logAuditEvent({ category: 'class', action: 'class.divisions.create', entityType: 'class', entityId: baseClass, message: `Created ${labels.length} division classes for ${baseClass}.`, metadata: { labels } });
});
document.getElementById('class-list-container').addEventListener('click', e => {
    const editBtn = e.target.closest('.edit-class-btn'), delBtn = e.target.closest('.delete-class-btn');
    if(editBtn) {
        if(!requirePermission('students.manage')) return; if(!requirePermission('classes.manage')) return; editingClassName = editBtn.dataset.class; document.getElementById('edit-class-name').value = editingClassName; document.getElementById('edit-class-popup').classList.remove('hidden'); document.getElementById('edit-class-popup').classList.add('flex'); }
    if(delBtn) {
        if(!requirePermission('classes.manage')) return;
        const cName = delBtn.dataset.class;
        if(!confirm(`ക്ലാസ്സ് '${cName}' പൂർണ്ണമായും ഡിലീറ്റ് ചെയ്യട്ടെ? അതിലുള്ള കുട്ടികളും ഡിലീറ്റ് ആകും.`)) return;
        const toDelete = students.filter(s => s.class === cName).map(s => s.id);
        deleteStudentsAndDependencies(toDelete)
            .then(async () => {
                await removeClassFromActiveAcademicYear(cName);
                await logAuditEvent({ category: 'class', action: 'class.delete', entityType: 'class', entityId: cName, message: `Class deleted: ${cName}.`, metadata: { deletedStudents: toDelete.length } });
                alert('Class deleted.');
            })
            .catch((error) => {
                console.error('Failed to delete class dependencies.', error);
                alert('Failed to delete the class completely. Please try again.');
            });
    }
});
document.getElementById('edit-class-cancel').addEventListener('click', () => document.getElementById('edit-class-popup').classList.add('hidden'));
document.getElementById('edit-class-update').addEventListener('click', async () => {
    if(!requirePermission('classes.manage')) return;
    const newName = document.getElementById('edit-class-name').value.trim().toUpperCase();
    if(newName && newName !== editingClassName) {
        if(!confirm(`ക്ലാസ്സിന്റെ പേര് മാറ്റട്ടെ?`)) return;
        const batch = writeBatch(db); students.filter(s => s.class === editingClassName).forEach(s => { batch.update(doc(db, `${BASE_PATH}/students`, s.id), { class: newName }); });
        await batch.commit();
        await syncActiveAcademicYearClasses(classes.map((className) => className === editingClassName ? newName : className), { replace: true });
        await logAuditEvent({ category: 'class', action: 'class.rename', entityType: 'class', entityId: editingClassName, message: `Class renamed from ${editingClassName} to ${newName}.` });
        document.getElementById('edit-class-popup').classList.add('hidden');
    }
});

const moveListCont = document.getElementById('move-student-list-container'), moveBtn = document.getElementById('move-selected-students-btn'), tgtCont = document.getElementById('move-target-container');
let editGroupWorkingMembers = [];
document.getElementById('move-from-class').addEventListener('change', (e) => {
    const cName = e.target.value; moveBtn.disabled = true;
    if(!cName) { moveListCont.classList.add('hidden'); tgtCont.classList.add('hidden'); return; }
    const inClass = students.filter(s => s.class === cName).sort((a,b)=>a.name.localeCompare(b.name));
    moveListCont.classList.remove('hidden'); tgtCont.classList.remove('hidden');
    if(inClass.length === 0) { moveListCont.innerHTML = '<p class="text-sm italic text-gray-500">ഈ ക്ലാസ്സിൽ കുട്ടികൾ ഇല്ല.</p>'; return; }
    let h = `<div class="mb-3 pb-3 border-b border-gray-200"><input type="checkbox" id="move-all" class="mr-2 w-4 h-4 rounded"><label for="move-all" class="font-bold text-gray-800">Select All Students</label></div>`;
    inClass.forEach(s => h += `<div class="flex items-center mb-2"><input type="checkbox" class="move-chk mr-3 w-4 h-4 rounded" value="${s.id}" id="m-${s.id}"><label for="m-${s.id}" class="text-sm font-medium text-gray-700">${s.name} <span class="text-xs text-gray-400 font-mono ml-2">(Adm: ${s.adm||'-'})</span></label></div>`);
    moveListCont.innerHTML = h;
});
moveListCont.addEventListener('change', e => { if(e.target.id === 'move-all') document.querySelectorAll('.move-chk').forEach(c => c.checked = e.target.checked); moveBtn.disabled = document.querySelectorAll('.move-chk:checked').length === 0; });
document.querySelectorAll('input[name="move_dest_type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if(e.target.value === 'existing') { document.getElementById('move-target-sel').classList.remove('hidden'); document.getElementById('move-target-inp').classList.add('hidden'); }
        else { document.getElementById('move-target-sel').classList.add('hidden'); document.getElementById('move-target-inp').classList.remove('hidden'); }
    });
});
moveBtn.addEventListener('click', async () => {
    if(!requirePermission('classes.manage')) return;
    const ids = Array.from(document.querySelectorAll('.move-chk:checked')).map(c=>c.value);
    const isNew = document.querySelector('input[name="move_dest_type"]:checked').value === 'new';
    const targetClass = isNew ? document.getElementById('move-target-inp').value.trim().toUpperCase() : document.getElementById('move-target-sel').value;

    if(!targetClass) return alert("Please specify target class.");
    if(!confirm(`ഈ ${ids.length} വിദ്യാർത്ഥികളെ ${targetClass} എന്ന ക്ലാസ്സിലേക്ക് മാറ്റട്ടെ?`)) return;

    const batch = writeBatch(db); ids.forEach((id) => {
        batch.update(doc(db, `${BASE_PATH}/students`, id), { class: targetClass });
        const student = rawStudents.find((entry) => entry.id === id);
        batch.set(
            getEnrollmentRef(student?.academicYear || currentAcademicYear, id),
            buildEnrollmentPayload(id, { ...(student || {}), class: targetClass }),
            { merge: true }
        );
    });
    await batch.commit();
    await syncActiveAcademicYearClasses([targetClass]);
    await logAuditEvent({ category: 'class', action: 'student.move', entityType: 'student', message: `Moved ${ids.length} students to ${targetClass}.`, metadata: { targetClass, ids } });
    alert('മാറ്റം വിജയകരം.'); document.getElementById('move-from-class').value = ''; moveListCont.classList.add('hidden'); tgtCont.classList.add('hidden');
});

// --- 5. GROUPS ---
const getStudentDisplayLabel = (student) => `${student?.name || '-'} (${student?.class || '--'}${student?.adm ? ` • Adm: ${student.adm}` : ''})`;
const getGroupStudentOptions = (className, gender, excludedIds = []) => students
    .filter((student) => student.class === className && student.gender === gender && !excludedIds.includes(student.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
const findStudentFromTypedGroupValue = (value, className, gender, excludedIds = []) => {
    const normalizedValue = (value || '').trim().toLowerCase();
    if(!normalizedValue) return null;
    return getGroupStudentOptions(className, gender, excludedIds).find((student) => {
        const label = getStudentDisplayLabel(student).toLowerCase();
        return student.id === value || label === normalizedValue || (student.name || '').trim().toLowerCase() === normalizedValue;
    }) || null;
};
const renderGroupStudentDatalist = (idx) => {
    const className = document.querySelector(`.grp-cls[data-idx="${idx}"]`)?.value || '';
    const gender = document.querySelector(`.grp-gen[data-idx="${idx}"]`)?.value || '';
    const datalist = document.getElementById(`grp-stu-options-${idx}`);
    const input = document.getElementById(`grp-stu-${idx}`);
    if(!datalist || !input) return;
    if(!className || !gender) {
        datalist.innerHTML = '';
        input.value = '';
        input.placeholder = 'Select class and gender first...';
        return;
    }
    datalist.innerHTML = getGroupStudentOptions(className, gender)
        .map((student) => `<option value="${escapeHtml(getStudentDisplayLabel(student))}"></option>`)
        .join('');
    input.placeholder = 'Type student name...';
};
const renderStudentGroups = () => {
     document.getElementById('student-groups-list').innerHTML = studentGroups.length === 0 ? '<p class="text-gray-500 italic p-3">No groups created yet.</p>' : studentGroups.map((g) => {
        const memberCards = (g.memberIds || []).map((memberId) => {
            const student = students.find((entry) => entry.id === memberId);
            if(!student) return `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-xs font-bold">Missing student</span>`;
            return `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold">${escapeHtml(student.name || '-')} <span class="ml-1 text-slate-500">(${escapeHtml(student.class || '--')})</span></span>`;
        }).join('');
        return `<div class="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-3"><div class="flex flex-col gap-2"><div class="flex flex-wrap gap-2">${memberCards}</div><span class="text-gray-500 text-sm font-medium"><i class="fas fa-users mr-1"></i> ${(g.memberIds || []).length} Linked Students ${g.fee > 0 ? `<span class="ml-2 text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-bold">₹${g.fee}/month</span>` : ''}</span></div><div class="shrink-0"><button class="text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg text-sm font-bold transition edit-grp mr-2" data-id="${g.id}"><i class="fas fa-edit"></i> Edit</button><button class="text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg text-sm font-bold transition del-grp" data-id="${g.id}"><i class="fas fa-trash"></i></button></div></div>`;
     }).join('');
};
const renderEditGroupMembers = () => {
    const membersNode = document.getElementById('e-grp-members');
    membersNode.innerHTML = editGroupWorkingMembers.length
        ? editGroupWorkingMembers.map((sid) => {
            const s = students.find((st) => st.id === sid);
            if(!s) return '';
            return `<div class="flex items-center justify-between bg-white border border-gray-200 px-2 py-1.5 rounded">
                <span class="text-sm font-medium text-gray-700">${escapeHtml(s.name || '-')} <span class="text-xs text-gray-500">(${escapeHtml(s.class || '--')})</span></span>
                <button class="text-red-600 hover:text-red-800 text-xs font-bold e-grp-remove-member" data-id="${s.id}"><i class="fas fa-times mr-1"></i>Remove</button>
            </div>`;
        }).join('')
        : '<p class="text-sm italic text-gray-500">No members in this group.</p>';
};
const populateEditGroupClassFilter = () => {
    const classFilter = document.getElementById('e-grp-class-filter');
    classFilter.innerHTML = '<option value="">Select Class</option>' + classes.map((c) => `<option value="${c}">${c}</option>`).join('');
};
const populateEditGroupStudentOptions = () => {
    const cls = document.getElementById('e-grp-class-filter').value;
    const gen = document.getElementById('e-grp-gender-filter').value;
    const studentInput = document.getElementById('e-grp-student-select');
    const studentOptions = document.getElementById('e-grp-student-options');
    if(!studentInput || !studentOptions) return;
    if(!cls) {
        studentInput.value = '';
        studentInput.placeholder = 'Select class first...';
        studentOptions.innerHTML = '';
        return;
    }
    studentOptions.innerHTML = getGroupStudentOptions(cls, gen, editGroupWorkingMembers)
        .map((student) => `<option value="${escapeHtml(getStudentDisplayLabel(student))}"></option>`)
        .join('');
    studentInput.placeholder = 'Type student name...';
};
document.getElementById('student-groups-list').addEventListener('click', e => {
    const delBtn = e.target.closest('.del-grp'), editBtn = e.target.closest('.edit-grp');
    if(delBtn) {
        if(!requirePermission('groups.manage')) return;
        if(!confirm("ഈ ഗ്രൂപ്പ് പൂർണ്ണമായും ഡിലീറ്റ് ചെയ്യട്ടെ?")) return;
        deleteDoc(doc(db, `${BASE_PATH}/studentGroups`, delBtn.dataset.id));
        logAuditEvent({ category: 'group', action: 'group.delete', entityType: 'studentGroup', entityId: delBtn.dataset.id, message: 'Student group deleted.' });
    }
    if(editBtn) {
        if(!requirePermission('groups.manage')) return;
        const g = studentGroups.find(gr => gr.id === editBtn.dataset.id);
        if(g) {
            document.getElementById('e-grp-id').value = g.id; document.getElementById('e-grp-fee').value = g.fee || '';
            editGroupWorkingMembers = [...g.memberIds];
            populateEditGroupClassFilter();
            renderEditGroupMembers();
            populateEditGroupStudentOptions();
            document.getElementById('edit-group-popup').classList.remove('hidden'); document.getElementById('edit-group-popup').classList.add('flex');
        }
    }
});
document.getElementById('edit-group-cancel').onclick = () => document.getElementById('edit-group-popup').classList.add('hidden');
document.getElementById('e-grp-class-filter').addEventListener('change', () => { document.getElementById('e-grp-student-select').value = ''; populateEditGroupStudentOptions(); });
document.getElementById('e-grp-gender-filter').addEventListener('change', () => { document.getElementById('e-grp-student-select').value = ''; populateEditGroupStudentOptions(); });
document.getElementById('e-grp-add-member').addEventListener('click', () => {
    const studentInput = document.getElementById('e-grp-student-select');
    const cls = document.getElementById('e-grp-class-filter').value;
    const gen = document.getElementById('e-grp-gender-filter').value;
    const studentId = findStudentFromTypedGroupValue(studentInput.value, cls, gen, editGroupWorkingMembers)?.id || '';
    if(!studentId || editGroupWorkingMembers.includes(studentId)) return alert('Please select a valid student from the suggestions.');
    editGroupWorkingMembers.push(studentId);
    studentInput.value = '';
    renderEditGroupMembers();
    populateEditGroupStudentOptions();
});
document.getElementById('e-grp-members').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.e-grp-remove-member');
    if(!removeBtn) return;
    editGroupWorkingMembers = editGroupWorkingMembers.filter((id) => id !== removeBtn.dataset.id);
    renderEditGroupMembers();
    populateEditGroupStudentOptions();
});
document.getElementById('edit-group-update').onclick = async () => {
    if(!requirePermission('groups.manage')) return;
    const gid = document.getElementById('e-grp-id').value, gfee = parseFloat(document.getElementById('e-grp-fee').value) || 0;
    const newMem = [...editGroupWorkingMembers];
    if(newMem.length < 2 && newMem.length > 0) return alert("Group must have at least 2 members. Add more or delete group.");

    if(!confirm("ഈ ഗ്രൂപ്പിലെ മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;

    if(newMem.length === 0) { await deleteDoc(doc(db, `${BASE_PATH}/studentGroups`, gid)); await logAuditEvent({ category: 'group', action: 'group.delete', entityType: 'studentGroup', entityId: gid, message: 'Student group removed during edit.' }); }
    else { await updateDoc(doc(db, `${BASE_PATH}/studentGroups`, gid), { fee: gfee, memberIds: newMem, updatedAt: Date.now() }); await logAuditEvent({ category: 'group', action: 'group.update', entityType: 'studentGroup', entityId: gid, message: 'Student group updated.' }); }
    document.getElementById('edit-group-popup').classList.add('hidden');
};

document.getElementById('num-of-students-group').addEventListener('input', e => {
    const count = parseInt(e.target.value) || 0; const cont = document.getElementById('group-creation-container'); cont.innerHTML = '';
    document.getElementById('create-group-btn-container').classList.toggle('hidden', count < 2);
    if(count < 2) return;
    const clsOpts = `<option value="">Select Class</option>` + classes.map(c=>`<option value="${c}">${c}</option>`).join('');
    for(let i=0; i<count; i++) {
        cont.innerHTML += `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-4 border-b border-gray-100 mb-2"><select class="grp-cls p-2.5 border rounded-lg bg-gray-50 text-sm font-semibold" data-idx="${i}">${clsOpts}</select><select class="grp-gen p-2.5 border rounded-lg bg-gray-50 text-sm font-semibold" data-idx="${i}"><option value="Male">Male</option><option value="Female">Female</option></select><div class="sm:col-span-3"><input id="grp-stu-${i}" list="grp-stu-options-${i}" class="grp-stu p-2.5 border rounded-lg text-sm font-semibold bg-white w-full" data-idx="${i}" autocomplete="off" placeholder="Select class and gender first..."><datalist id="grp-stu-options-${i}"></datalist><p class="text-xs text-gray-500 mt-1">Type a student name and pick from suggestions.</p></div></div>`;
    }
});
document.getElementById('group-creation-container').addEventListener('change', e => {
    if(e.target.classList.contains('grp-cls') || e.target.classList.contains('grp-gen')) {
        const idx = e.target.dataset.idx;
        const input = document.getElementById(`grp-stu-${idx}`);
        if(input) input.value = '';
        renderGroupStudentDatalist(idx);
    }
});
document.getElementById('create-group-btn').addEventListener('click', async () => {
    if(!requirePermission('groups.manage')) return;
    const selects = Array.from(document.querySelectorAll('.grp-stu')).map((input) => {
        const idx = input.dataset.idx;
        const className = document.querySelector(`.grp-cls[data-idx="${idx}"]`)?.value || '';
        const gender = document.querySelector(`.grp-gen[data-idx="${idx}"]`)?.value || '';
        return findStudentFromTypedGroupValue(input.value, className, gender)?.id || '';
    }).filter(Boolean);
    const fee = parseFloat(document.getElementById('group-monthly-fee').value) || 0;
    if(selects.length < 2 || new Set(selects).size !== selects.length) return alert("Please select unique valid students from the suggestions.");

    if(!confirm("പുതിയ ഗ്രൂപ്പ് ക്രിയേറ്റ് ചെയ്യട്ടെ?")) return;

    const nowTs = Date.now();
    const groupDoc = await addDoc(collection(db, `${BASE_PATH}/studentGroups`), { academicYear: activeAcademicYear || currentAcademicYear, memberIds: selects, fee: fee, createdAt: nowTs, updatedAt: nowTs });
    await logAuditEvent({ category: 'group', action: 'group.create', entityType: 'studentGroup', entityId: groupDoc.id, message: `Student group created with ${selects.length} members.` });
    alert("Group Created Successfully!"); document.getElementById('num-of-students-group').value = ''; document.getElementById('group-monthly-fee').value = ''; document.getElementById('group-creation-container').innerHTML = ''; document.getElementById('create-group-btn-container').classList.add('hidden');
});

// --- 6.1 RESULT MANAGEMENT ---
if (document.getElementById('results-page')) {
const RESULT_EXAMS = ['quarterly', 'halfYearly', 'annual'];
const RESULT_EXAM_LABELS = { quarterly: 'Quarterly', halfYearly: 'Half-Yearly', annual: 'Annual' };
const DEFAULT_GRADE_RULES = [
    { grade: 'A+', min: 90, max: 100 },
    { grade: 'A', min: 80, max: 89.99 },
    { grade: 'B+', min: 70, max: 79.99 },
    { grade: 'B', min: 60, max: 69.99 },
    { grade: 'C', min: 50, max: 59.99 },
    { grade: 'D', min: 35, max: 49.99 },
    { grade: 'F', min: 0, max: 34.99 }
];
let resultCenterSettings = {
    examLabel: '',
    publishAt: '',
    locked: false,
    blockedClasses: [],
    gradeRules: DEFAULT_GRADE_RULES,
    gradeBasis: 'raw',
    gradeScaleTotal: 100,
    classProgressionMap: {},
    posterTemplateUrl: '',
    enableStudentPhotoModule: false,
    allowStudentSelfPhotoUpload: false
};
let examResultsCache = [];

const getResultSchemaForClass = (classLabel, academicYear = getActiveAcademicYearLabel()) =>
    resultSchemas.find((entry) => entry.academicYear === academicYear && entry.classLabel === classLabel);

const calcStatusFromMarks = (marks = {}, schema = null) => {
    if (!schema?.subjects?.length) return 'FAIL';
    const hasFail = schema.subjects.some((subject) => {
        const value = marks[subject.code];
        const raw = String(value ?? '').trim().toUpperCase();
        if (raw === 'A') return true;
        if (raw === 'P') return false;
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric < Number(subject.passMark || 0) : true;
    });
    return hasFail ? 'FAIL' : 'PASS';
};

const calcTotals = (marks = {}, schema = null) => {
    const subjects = schema?.subjects || [];
    let obtained = 0;
    let maximum = 0;
    subjects.forEach((subject) => {
        const raw = String(marks[subject.code] ?? '').trim().toUpperCase();
        maximum += Number(subject.totalMark || 100);
        if (raw === 'P') obtained += Number(subject.passMark || 18);
        else if (raw === 'A') obtained += 0;
        else obtained += Number(raw) || 0;
    });
    const percentage = maximum > 0 ? Number(((obtained / maximum) * 100).toFixed(2)) : 0;
    return { obtained, maximum, percentage, passStatus: calcStatusFromMarks(marks, schema) };
};

const calcGradeFromValue = ({ percentage = 0, raw = 0 } = {}) => {
    const basis = resultCenterSettings.gradeBasis || 'raw';
    const score = basis === 'percentage' ? Number(percentage) : Number(raw);
    const rules = (resultCenterSettings.gradeRules || DEFAULT_GRADE_RULES)
        .map((rule) => ({ ...rule, min: Number(rule.min), max: Number(rule.max) }))
        .filter((rule) => rule.grade && Number.isFinite(rule.min) && Number.isFinite(rule.max));
    const match = rules.find((rule) => score >= rule.min && score <= rule.max);
    return match?.grade || '-';
};

const parseResultSubjects = (raw = '') => raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
        const parts = line.includes(',') ? line.split(',') : line.split('|');
        const [name = '', totalMark = '100', passMark = '35'] = parts.map((part) => part.trim());
        return {
            name,
            code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24),
            totalMark: Number(totalMark) || 100,
            passMark: Number(passMark) || 35
        };
    })
    .filter((subject) => subject.name);

const renderResultDashboardCards = () => {
    const filtered = examResultsCache.filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.published === true);
    const passCount = filtered.filter((item) => item.totals?.passStatus === 'PASS').length;
    const passPct = filtered.length ? Math.round((passCount / filtered.length) * 100) : 0;
    document.getElementById('result-stat-students').textContent = String(students.length);
    document.getElementById('result-stat-classes').textContent = String(classes.length);
    document.getElementById('result-stat-published').textContent = String(filtered.length);
    document.getElementById('result-stat-passpct').textContent = `${passPct}%`;
    const analytics = RESULT_EXAMS.map((exam) => {
        const rows = filtered.filter((item) => item.examType === exam);
        const examPass = rows.filter((item) => item.totals?.passStatus === 'PASS').length;
        const examPct = rows.length ? Math.round((examPass / rows.length) * 100) : 0;
        return `<div class="bg-white border rounded-lg p-3"><div class="text-xs uppercase text-gray-500 font-bold">${exam}</div><div class="text-lg font-extrabold text-indigo-700">${examPct}% Pass</div><div class="text-[11px] text-gray-500">${rows.length} published</div></div>`;
    });
    document.getElementById('result-analytics-list').innerHTML = analytics.join('');
};

const populateResultSelectors = () => {
    classes = getClassesForActiveYear();
    const classOptions = classes.length ? classes : [];
    ['result-class-select', 'marks-class-select', 'published-class-select', 'draft-class-select', 'result-template-class-select', 'result-readiness-class-select'].forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        const optionsHtml = ['<option value="">-- Select Class --</option>', ...classOptions.map((classLabel) => `<option value="${escapeHtml(classLabel)}">${escapeHtml(classLabel)}</option>`)];
        select.innerHTML = optionsHtml.join('');
        if (classOptions.includes(current)) select.value = current;
        else select.value = '';
    });
    const blockedList = document.getElementById('blocked-classes-list');
    blockedList.innerHTML = classOptions.filter(Boolean).map((classLabel) => `
        <label class="flex items-center gap-2 text-sm bg-gray-50 border rounded px-2 py-1">
            <input type="checkbox" class="blocked-class-checkbox" value="${classLabel}" ${resultCenterSettings.blockedClasses?.includes(classLabel) ? 'checked' : ''}>
            <span>${escapeHtml(classLabel)}</span>
        </label>
    `).join('') || '<div class="text-xs text-gray-500">No classes configured.</div>';
};

const renderPublishedSummary = (rows = null) => {
    const summaryEl = document.getElementById('published-summary-strip');
    if (!summaryEl) return;
    const dataset = Array.isArray(rows)
        ? rows
        : examResultsCache.filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.published === true);
    const passCount = dataset.filter((item) => item.totals?.passStatus === 'PASS').length;
    const failCount = dataset.filter((item) => item.totals?.passStatus === 'FAIL').length;
    const passPct = dataset.length ? Math.round((passCount / dataset.length) * 100) : 0;
    summaryEl.innerHTML = `
        <div class="published-summary-card">
            <div class="published-summary-label">Filtered Results</div>
            <div class="published-summary-value">${dataset.length}</div>
        </div>
        <div class="published-summary-card">
            <div class="published-summary-label">Pass / Fail</div>
            <div class="published-summary-value">${passCount} / ${failCount}</div>
        </div>
        <div class="published-summary-card">
            <div class="published-summary-label">Pass Percentage</div>
            <div class="published-summary-value">${passPct}%</div>
        </div>
    `;
};

const runResultReadinessChecklist = () => {
    const classLabel = document.getElementById('result-readiness-class-select')?.value || '';
    const examType = document.getElementById('result-readiness-exam-select')?.value || 'quarterly';
    const statusEl = document.getElementById('result-readiness-status');
    const gridEl = document.getElementById('result-readiness-grid');
    const notesEl = document.getElementById('result-readiness-notes');
    if (!statusEl || !gridEl || !notesEl) return;
    if (!classLabel) {
        statusEl.className = 'result-readiness-pill result-readiness-pending';
        statusEl.textContent = 'Pending';
        gridEl.innerHTML = '';
        notesEl.textContent = 'Select a class and exam to run checklist.';
        return;
    }

    const classStudents = students.filter((student) => student.class === classLabel);
    const rows = examResultsCache.filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.classLabel === classLabel && item.examType === examType);
    const publishedRows = rows.filter((row) => row.published === true);
    const draftRows = rows.filter((row) => row.published !== true);
    const studentIdsWithRows = new Set(rows.map((row) => row.studentId));
    const missingRows = classStudents.filter((student) => !studentIdsWithRows.has(student.id));
    const invalidRows = rows.filter((row) => {
        const marks = row.marks || {};
        const values = Object.values(marks);
        if (!values.length) return true;
        return values.some((value) => {
            const raw = String(value ?? '').trim().toUpperCase();
            if (!raw) return true;
            if (raw === 'A' || raw === 'P') return false;
            return !Number.isFinite(Number(raw));
        });
    });
    const readinessPass = missingRows.length === 0 && invalidRows.length === 0 && draftRows.length === 0 && publishedRows.length > 0;
    statusEl.className = `result-readiness-pill ${readinessPass ? 'result-readiness-pass' : 'result-readiness-fail'}`;
    statusEl.textContent = readinessPass ? 'Ready to Publish' : 'Needs Review';
    gridEl.innerHTML = `
        <div class="result-readiness-item"><div class="result-readiness-label">Class Strength</div><div class="result-readiness-value">${classStudents.length}</div></div>
        <div class="result-readiness-item"><div class="result-readiness-label">Published</div><div class="result-readiness-value">${publishedRows.length}</div></div>
        <div class="result-readiness-item"><div class="result-readiness-label">Draft</div><div class="result-readiness-value">${draftRows.length}</div></div>
        <div class="result-readiness-item"><div class="result-readiness-label">Missing Rows</div><div class="result-readiness-value">${missingRows.length}</div></div>
    `;
    if (readinessPass) {
        notesEl.textContent = `${RESULT_EXAM_LABELS[examType] || examType}: Checklist passed for ${classLabel}. You can proceed with publish/print confidently.`;
        return;
    }
    const notes = [];
    if (!publishedRows.length) notes.push('No published rows available.');
    if (draftRows.length) notes.push(`${draftRows.length} draft row(s) still pending publish.`);
    if (missingRows.length) notes.push(`${missingRows.length} student(s) do not have result rows.`);
    if (invalidRows.length) notes.push(`${invalidRows.length} row(s) contain invalid/blank mark values.`);
    notesEl.textContent = `${RESULT_EXAM_LABELS[examType] || examType}: ${notes.join(' ')}`;
};

const populateMarksStudentSelect = () => {
    const selectedClass = document.getElementById('marks-class-select').value;
    const studentSelect = document.getElementById('marks-student-select');
    const eligible = students.filter((student) => student.class === selectedClass);
    const options = ['<option value="">-- Select Student --</option>', ...eligible.map((student) => `<option value="${student.id}">${escapeHtml(student.name)} (${escapeHtml(student.adm || '-')})</option>`)];
    studentSelect.innerHTML = options.join('');
};

const renderGradeRulesEditor = () => {
    const rows = resultCenterSettings.gradeRules?.length ? resultCenterSettings.gradeRules : DEFAULT_GRADE_RULES;
    const container = document.getElementById('grade-rules-rows');
    container.innerHTML = rows.map((rule, index) => `
        <div class="grid grid-cols-3 gap-2">
            <input class="grade-rule-grade p-2 border rounded" data-index="${index}" placeholder="Grade" value="${escapeHtml(String(rule.grade || ''))}">
            <input type="number" step="0.01" class="grade-rule-min p-2 border rounded" data-index="${index}" placeholder="Min %" value="${escapeHtml(String(rule.min ?? ''))}">
            <input type="number" step="0.01" class="grade-rule-max p-2 border rounded" data-index="${index}" placeholder="Max %" value="${escapeHtml(String(rule.max ?? ''))}">
        </div>
    `).join('');
};

const buildGradeRulesByTotal = (totalMark = 100) => {
    const normalizedTotal = Number(totalMark) === 50 ? 50 : 100;
    if (normalizedTotal === 50) {
        return [
            { grade: 'A+', min: 45, max: 50 },
            { grade: 'A', min: 40, max: 44.99 },
            { grade: 'B+', min: 35, max: 39.99 },
            { grade: 'B', min: 30, max: 34.99 },
            { grade: 'C', min: 25, max: 29.99 },
            { grade: 'D', min: 18, max: 24.99 },
            { grade: 'F', min: 0, max: 17.99 }
        ];
    }
    return [
        { grade: 'A+', min: 90, max: 100 },
        { grade: 'A', min: 80, max: 89.99 },
        { grade: 'B+', min: 70, max: 79.99 },
        { grade: 'B', min: 60, max: 69.99 },
        { grade: 'C', min: 50, max: 59.99 },
        { grade: 'D', min: 35, max: 49.99 },
        { grade: 'F', min: 0, max: 34.99 }
    ];
};

const collectGradeRulesFromEditor = () => {
    const grades = Array.from(document.querySelectorAll('.grade-rule-grade'));
    return grades.map((gradeInput, index) => ({
        grade: gradeInput.value.trim(),
        min: Number(document.querySelector(`.grade-rule-min[data-index="${index}"]`)?.value ?? NaN),
        max: Number(document.querySelector(`.grade-rule-max[data-index="${index}"]`)?.value ?? NaN)
    })).filter((rule) => rule.grade && Number.isFinite(rule.min) && Number.isFinite(rule.max));
};

const renderClassProgressionMap = () => {
    const mapList = document.getElementById('class-progression-map-list');
    const map = resultCenterSettings.classProgressionMap || {};
    if (!classes.length) {
        mapList.innerHTML = '<div class="text-xs text-gray-500">No classes configured.</div>';
        return;
    }
    mapList.innerHTML = classes.map((classLabel) => {
        const selectedNext = map[classLabel] || '';
        const options = [
            '<option value="">-- Select Next --</option>',
            ...classes.filter((candidate) => candidate !== classLabel).map((candidate) => `<option value="${candidate}" ${selectedNext === candidate ? 'selected' : ''}>${candidate}</option>`),
            `<option value="GRADUATED" ${selectedNext === 'GRADUATED' ? 'selected' : ''}>GRADUATED</option>`
        ].join('');
        return `
            <label class="text-xs font-bold bg-gray-50 border rounded p-2">
                <div class="mb-1">${escapeHtml(classLabel)} →</div>
                <select class="progression-next-select w-full p-1.5 border rounded text-xs" data-class="${classLabel}">${options}</select>
            </label>
        `;
    }).join('');
};

const renderResultManagement = () => {
    const settingsTab = document.getElementById('result-settings-tab');
    const settingsBlocks = ['result-publish-settings-block', 'result-lock-settings-block', 'result-poster-settings-block', 'result-copy-prev-year-block']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (settingsTab && settingsBlocks.length && settingsTab.children.length === 0) {
        settingsBlocks.forEach((block) => settingsTab.appendChild(block));
    }
    enforceResultOperatorResultTabs();
    document.getElementById('result-year-badge').textContent = `Academic Year: ${getActiveAcademicYearLabel()}`;
    document.getElementById('result-publish-exam-name').value = resultCenterSettings.examLabel || '';
    document.getElementById('result-publish-at').value = resultCenterSettings.publishAt || '';
    document.getElementById('result-lock-toggle').checked = resultCenterSettings.locked === true;
    document.getElementById('result-poster-template-url').value = resultCenterSettings.posterTemplateUrl || '';
    document.getElementById('result-photo-module-toggle').checked = resultCenterSettings.enableStudentPhotoModule === true;
    document.getElementById('result-self-photo-upload-toggle').checked = resultCenterSettings.allowStudentSelfPhotoUpload === true;
    document.getElementById('grade-total-mark-select').value = String(resultCenterSettings.gradeScaleTotal || 100);
    const targetYearSelect = document.getElementById('promotion-target-year-select');
    const targetCurrent = targetYearSelect.value;
    targetYearSelect.innerHTML = academicYears.map((year) => `<option value="${year.label}">${year.label}</option>`).join('');
    targetYearSelect.value = academicYears.some((year) => year.label === targetCurrent) ? targetCurrent : (academicYears.find((year) => year.label !== getActiveAcademicYearLabel())?.label || getActiveAcademicYearLabel());
    populateResultSelectors();
    populateMarksStudentSelect();
    renderGradeRulesEditor();
    renderClassProgressionMap();
    renderResultDashboardCards();
    runResultReadinessChecklist();
    renderPublishedSummary();

    const classSelect = document.getElementById('result-class-select');
    const selectedClass = classSelect.value;
    const schema = resultSchemas.find((entry) => entry.academicYear === getActiveAcademicYearLabel() && entry.classLabel === selectedClass);
    document.getElementById('result-subjects-input').value = schema?.subjects?.map((subject) => `${subject.name},${subject.totalMark || 100},${subject.passMark || 35}`).join('\n') || '';
    document.getElementById('result-show-quarterly').checked = schema?.examConfigs?.quarterly?.showMarksToStudents === true;
    document.getElementById('result-show-halfyearly').checked = schema?.examConfigs?.halfYearly?.showMarksToStudents === true;
    document.getElementById('result-show-annual').checked = schema?.examConfigs?.annual?.showMarksToStudents === true;

    const listEl = document.getElementById('result-schema-list');
    const rows = resultSchemas
        .filter((entry) => entry.academicYear === getActiveAcademicYearLabel())
        .sort((a, b) => (a.classLabel || '').localeCompare(b.classLabel || ''))
        .map((entry) => `
            <div class="border rounded-xl p-4 bg-gray-50">
                <div class="flex items-center justify-between mb-2">
                    <div class="font-bold text-gray-900">${escapeHtml(entry.classLabel || '--')}</div>
                    <div class="text-[11px] uppercase tracking-wider text-gray-500">${escapeHtml(entry.academicYear || '--')}</div>
                </div>
                <div class="text-xs text-gray-600 mb-2">${(entry.subjects || []).map((subject) => `${escapeHtml(subject.name)} (${subject.passMark}/${subject.totalMark})`).join(', ') || 'No subjects set.'}</div>
                <div class="text-[11px] font-semibold text-indigo-600">Show Marks: Q-${entry.examConfigs?.quarterly?.showMarksToStudents ? 'ON' : 'OFF'} | H-${entry.examConfigs?.halfYearly?.showMarksToStudents ? 'ON' : 'OFF'} | A-${entry.examConfigs?.annual?.showMarksToStudents ? 'ON' : 'OFF'}</div>
            </div>
        `);
    listEl.innerHTML = rows.length ? rows.join('') : '<p class="text-sm text-gray-500 italic">No result schema saved for this academic year.</p>';
};

const switchResultTab = (tabId) => {
    currentResultTabId = tabId;
    document.querySelectorAll('.result-tab-content').forEach((panel) => panel.classList.toggle('hidden', panel.id !== tabId));
    document.querySelectorAll('.result-tab-btn').forEach((button) => {
        const active = button.dataset.tab === tabId;
        button.classList.toggle('bg-indigo-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('bg-white', !active);
        button.classList.toggle('border', !active);
    });
    updateResultDrawerActiveState();
};

document.querySelectorAll('.result-tab-btn').forEach((button) => {
    button.addEventListener('click', () => switchResultTab(button.dataset.tab));
});
document.getElementById('add-grade-rule-row-btn').addEventListener('click', () => {
    resultCenterSettings.gradeRules = [...(resultCenterSettings.gradeRules || DEFAULT_GRADE_RULES), { grade: '', min: 0, max: 0 }];
    renderGradeRulesEditor();
});
document.getElementById('grade-total-mark-select')?.addEventListener('change', () => {
    const totalMark = Number(document.getElementById('grade-total-mark-select').value || 100);
    resultCenterSettings.gradeScaleTotal = totalMark === 50 ? 50 : 100;
    resultCenterSettings.gradeBasis = 'raw';
    resultCenterSettings.gradeRules = buildGradeRulesByTotal(resultCenterSettings.gradeScaleTotal);
    renderGradeRulesEditor();
});
document.getElementById('save-grade-rules-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const rules = collectGradeRulesFromEditor();
    if (!rules.length) return alert('Enter at least one valid grade rule.');
    resultCenterSettings.gradeRules = rules;
    resultCenterSettings.gradeScaleTotal = Number(document.getElementById('grade-total-mark-select').value || 100) === 50 ? 50 : 100;
    resultCenterSettings.gradeBasis = 'raw';
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), {
        academicYear: getActiveAcademicYearLabel(),
        examLabel: resultCenterSettings.examLabel || '',
        publishAt: resultCenterSettings.publishAt || '',
        locked: resultCenterSettings.locked === true,
        blockedClasses: resultCenterSettings.blockedClasses || [],
        gradeBasis: resultCenterSettings.gradeBasis,
        gradeScaleTotal: resultCenterSettings.gradeScaleTotal,
        gradeRules: rules,
        classProgressionMap: resultCenterSettings.classProgressionMap || {},
        updatedAt: new Date().toISOString()
    }, { merge: true });
    alert('Grade rules saved.');
});
document.getElementById('save-class-progression-map-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const nextMap = {};
    document.querySelectorAll('.progression-next-select').forEach((select) => {
        const classLabel = select.dataset.class;
        const nextClass = select.value;
        if (classLabel && nextClass) nextMap[classLabel] = nextClass;
    });
    resultCenterSettings.classProgressionMap = nextMap;
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), {
        academicYear: getActiveAcademicYearLabel(),
        classProgressionMap: nextMap,
        examLabel: resultCenterSettings.examLabel || '',
        publishAt: resultCenterSettings.publishAt || '',
        locked: resultCenterSettings.locked === true,
        blockedClasses: resultCenterSettings.blockedClasses || [],
        gradeBasis: resultCenterSettings.gradeBasis || 'raw',
        gradeScaleTotal: resultCenterSettings.gradeScaleTotal || 100,
        gradeRules: resultCenterSettings.gradeRules || DEFAULT_GRADE_RULES,
        classProgressionMap: resultCenterSettings.classProgressionMap || {},
        updatedAt: new Date().toISOString()
    }, { merge: true });
    alert('Class progression map saved.');
});
document.getElementById('result-class-select').addEventListener('change', renderResultManagement);
document.getElementById('marks-class-select').addEventListener('change', populateMarksStudentSelect);
document.getElementById('save-result-schema-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const classLabel = document.getElementById('result-class-select').value;
    if (!classLabel) return alert('Please add classes first, then configure result schema.');
    const subjects = parseResultSubjects(document.getElementById('result-subjects-input').value);
    if (!subjects.length) return alert('Please provide at least one valid subject.');
    if(!confirm("Result schema സേവ് ചെയ്യട്ടെ?")) return;
    const payload = {
        academicYear: getActiveAcademicYearLabel(),
        classLabel,
        subjects,
        examConfigs: {
            quarterly: { label: 'Quarterly', showMarksToStudents: document.getElementById('result-show-quarterly').checked },
            halfYearly: { label: 'Half-Yearly', showMarksToStudents: document.getElementById('result-show-halfyearly').checked },
            annual: { label: 'Annual', showMarksToStudents: document.getElementById('result-show-annual').checked }
        },
        updatedAt: new Date().toISOString()
    };
    const schemaId = `${payload.academicYear}__${classLabel}`;
    await setDoc(doc(db, `${BASE_PATH}/resultSchemas`, schemaId), payload, { merge: true });
    await logAuditEvent({ category: 'security', action: 'results.schema.save', entityType: 'resultSchema', entityId: schemaId, message: `Result schema saved for ${classLabel}.` });
    alert('Result schema saved successfully.');
});
document.getElementById('result-save-publish-settings-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    resultCenterSettings.examLabel = document.getElementById('result-publish-exam-name').value.trim();
    resultCenterSettings.publishAt = document.getElementById('result-publish-at').value || '';
    resultCenterSettings.locked = document.getElementById('result-lock-toggle').checked;
    const payload = {
        academicYear: getActiveAcademicYearLabel(),
        examLabel: resultCenterSettings.examLabel,
        publishAt: resultCenterSettings.publishAt,
        locked: resultCenterSettings.locked,
        blockedClasses: resultCenterSettings.blockedClasses || [],
        gradeBasis: resultCenterSettings.gradeBasis || 'raw',
        gradeScaleTotal: resultCenterSettings.gradeScaleTotal || 100,
        gradeRules: resultCenterSettings.gradeRules || DEFAULT_GRADE_RULES,
        updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), payload, { merge: true });
    await logAuditEvent({ category: 'security', action: 'results.settings.save', entityType: 'settings', entityId: 'resultCenter', message: 'Result publish settings updated.' });
    alert('Publish settings saved.');
});
document.getElementById('result-save-poster-settings-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    resultCenterSettings.posterTemplateUrl = document.getElementById('result-poster-template-url').value.trim();
    resultCenterSettings.enableStudentPhotoModule = document.getElementById('result-photo-module-toggle').checked;
    resultCenterSettings.allowStudentSelfPhotoUpload = document.getElementById('result-self-photo-upload-toggle').checked;
    if (!resultCenterSettings.enableStudentPhotoModule) {
        resultCenterSettings.allowStudentSelfPhotoUpload = false;
        document.getElementById('result-self-photo-upload-toggle').checked = false;
    }
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), {
        academicYear: getActiveAcademicYearLabel(),
        posterTemplateUrl: resultCenterSettings.posterTemplateUrl || '',
        enableStudentPhotoModule: resultCenterSettings.enableStudentPhotoModule === true,
        allowStudentSelfPhotoUpload: resultCenterSettings.allowStudentSelfPhotoUpload === true,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    await logAuditEvent({ category: 'security', action: 'results.poster.settings.save', entityType: 'settings', entityId: 'resultCenter', message: 'Result poster/photo settings updated.' });
    alert('Poster and photo settings saved.');
});
document.getElementById('result-photo-module-toggle')?.addEventListener('change', (event) => {
    if (!event.target.checked) {
        document.getElementById('result-self-photo-upload-toggle').checked = false;
    }
});
document.getElementById('result-self-photo-upload-toggle')?.addEventListener('change', (event) => {
    if (event.target.checked) {
        document.getElementById('result-photo-module-toggle').checked = true;
    }
});
document.getElementById('result-download-template-guide-btn')?.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('Poster Template Guide (1080 x 1350)', 120, 90);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(70, 170, 260, 260); // photo placeholder
    ctx.fillStyle = '#64748b';
    ctx.font = '28px Arial';
    ctx.fillText('Student Photo', 90, 315);
    ctx.strokeRect(360, 200, 640, 90); // name
    ctx.fillText('Student Name', 390, 255);
    ctx.strokeRect(360, 320, 300, 70); // class
    ctx.fillText('Class - 6', 390, 365);
    ctx.strokeRect(680, 320, 320, 70); // rank
    ctx.fillText('Rank #1', 720, 365);
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = 'poster_template_guide_1080x1350.png';
    anchor.click();
});

document.getElementById('save-blocked-classes-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const blockedClasses = Array.from(document.querySelectorAll('.blocked-class-checkbox:checked')).map((checkbox) => checkbox.value);
    resultCenterSettings.blockedClasses = blockedClasses;
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), {
        academicYear: getActiveAcademicYearLabel(),
        blockedClasses,
        examLabel: resultCenterSettings.examLabel || '',
        publishAt: resultCenterSettings.publishAt || '',
        locked: resultCenterSettings.locked === true,
        gradeBasis: resultCenterSettings.gradeBasis || 'raw',
        gradeScaleTotal: resultCenterSettings.gradeScaleTotal || 100,
        gradeRules: resultCenterSettings.gradeRules || DEFAULT_GRADE_RULES,
        classProgressionMap: resultCenterSettings.classProgressionMap || {},
        updatedAt: new Date().toISOString()
    }, { merge: true });
    alert('Blocked classes updated.');
});

const downloadJsonFile = (name, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

document.getElementById('export-snapshot-all-btn').addEventListener('click', () => {
    const year = getActiveAcademicYearLabel();
    const payload = {
        academicYear: year,
        exportedAt: new Date().toISOString(),
        settings: resultCenterSettings,
        schemas: resultSchemas.filter((schema) => schema.academicYear === year),
        results: examResultsCache.filter((row) => row.academicYear === year && row.published === true)
    };
    downloadJsonFile('snapshot.json', payload);
});

document.getElementById('export-snapshot-classwise-btn').addEventListener('click', () => {
    const year = getActiveAcademicYearLabel();
    const rows = examResultsCache.filter((row) => row.academicYear === year && row.published === true);
    const byClass = rows.reduce((acc, row) => {
        const key = row.classLabel || 'UNKNOWN';
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
    }, {});
    Object.entries(byClass).forEach(([classLabel, classRows]) => {
        downloadJsonFile(`snapshot_${classLabel.replace(/\s+/g, '_')}.json`, {
            academicYear: year,
            classLabel,
            exportedAt: new Date().toISOString(),
            settings: resultCenterSettings,
            schema: getResultSchemaForClass(classLabel, year),
            results: classRows
        });
    });
});

document.getElementById('result-copy-prev-year-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const currentYear = getActiveAcademicYearLabel();
    const [start, end] = currentYear.split('-').map((val) => Number(val));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return alert('Active academic year format should be YYYY-YYYY.');
    const previousYear = `${start - 1}-${end - 1}`;
    const previousSchemas = resultSchemas.filter((schema) => schema.academicYear === previousYear);
    if (!previousSchemas.length) return alert(`No schemas found in previous year (${previousYear}).`);
    if (!confirm(`Copy ${previousSchemas.length} class schema(s) from ${previousYear} to ${currentYear}?`)) return;
    await Promise.all(previousSchemas.map((schema) => {
        const docId = `${currentYear}__${schema.classLabel}`;
        return setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), {
            academicYear: currentYear,
            classLabel: schema.classLabel,
            subjects: schema.subjects || [],
            examConfigs: schema.examConfigs || {},
            copiedFromYear: previousYear,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    }));
    alert(`Copied schemas from ${previousYear} successfully.`);
});

document.getElementById('result-download-template-btn').addEventListener('click', () => {
    const normalizedClass = (document.getElementById('result-template-class-select').value || '').trim().toUpperCase();
    if (!normalizedClass) return alert('Select a class from template dropdown.');
    const schema = getResultSchemaForClass(normalizedClass);
    if (!schema?.subjects?.length) return alert('No subjects configured for this class.');
    const classStudents = students.filter((student) => student.class === normalizedClass);
    if (!classStudents.length) return alert('No students found in this class.');
    const subjectHeaders = schema.subjects.map((subject) => `${subject.name} [${subject.code}]`);
    const header = ['studentId', 'studentName', 'classLabel', 'examType', 'workingDays', 'presentDays', ...subjectHeaders].join(',');
    const lines = classStudents.map((student) => {
        const emptyMarks = subjectHeaders.map(() => '').join(',');
        return `${student.id},"${(student.name || '').replace(/"/g, '""')}",${normalizedClass},quarterly,,,${emptyMarks}`;
    });
    const csv = `${header}\n${lines.join('\n')}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `result_bulk_template_${normalizedClass.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
});

const buildMarksSubjectInputs = (schema, existingData = {}) => {
    const container = document.getElementById('marks-subject-inputs');
    if (!schema?.subjects?.length) {
        container.innerHTML = '<div class="text-sm text-red-600">No subjects configured for this class.</div>';
        return;
    }
    container.innerHTML = schema.subjects.map((subject) => `
        <div class="border rounded p-2 bg-gray-50">
            <div class="text-xs font-bold text-gray-700 mb-1">${escapeHtml(subject.name)} (${subject.passMark}/${subject.totalMark})</div>
            <input class="marks-value-input w-full p-2 border rounded text-sm" data-code="${subject.code}" placeholder="Mark / A / P" value="${escapeHtml(String(existingData.marks?.[subject.code] ?? ''))}">
        </div>
    `).join('');
};

const loadMarksEntry = () => {
    const classLabel = document.getElementById('marks-class-select').value;
    const studentId = document.getElementById('marks-student-select').value;
    const examType = document.getElementById('marks-exam-select').value;
    if (!classLabel || !studentId) return alert('Select class and student.');
    const schema = getResultSchemaForClass(classLabel);
    const existing = examResultsCache.find((row) => row.academicYear === getActiveAcademicYearLabel() && row.classLabel === classLabel && row.studentId === studentId && row.examType === examType) || {};
    buildMarksSubjectInputs(schema, existing);
    document.getElementById('marks-working-days').value = existing.attendance?.workingDays ?? '';
    document.getElementById('marks-present-days').value = existing.attendance?.presentDays ?? '';
    document.getElementById('marks-entry-container').classList.remove('hidden');
};
document.getElementById('marks-load-btn').addEventListener('click', loadMarksEntry);

const saveMarksEntry = async (publish = false) => {
    if(!requirePermission('results.manage')) return;
    const classLabel = document.getElementById('marks-class-select').value;
    const studentId = document.getElementById('marks-student-select').value;
    const examType = document.getElementById('marks-exam-select').value;
    const schema = getResultSchemaForClass(classLabel);
    if (!schema?.subjects?.length) return alert('Configure subjects first.');

    const marks = {};
    document.querySelectorAll('.marks-value-input').forEach((input) => { marks[input.dataset.code] = input.value.trim(); });
    const grades = {};
    (schema.subjects || []).forEach((subject) => {
        const raw = String(marks[subject.code] ?? '').trim().toUpperCase();
        if (raw === 'A') grades[subject.code] = 'ABS';
        else if (raw === 'P') grades[subject.code] = 'P';
        else {
            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) grades[subject.code] = '-';
            else {
                const percent = (numeric / Number(subject.totalMark || 100)) * 100;
                grades[subject.code] = calcGradeFromValue({ percentage: percent, raw: numeric });
            }
        }
    });
    const totals = calcTotals(marks, schema);
    const payload = {
        academicYear: getActiveAcademicYearLabel(),
        classLabel,
        studentId,
        examType,
        marks,
        grades,
        attendance: {
            workingDays: Number(document.getElementById('marks-working-days').value) || 0,
            presentDays: Number(document.getElementById('marks-present-days').value) || 0
        },
        totals,
        published: publish === true,
        showMarksToStudents: schema.examConfigs?.[examType]?.showMarksToStudents === true,
        updatedAt: new Date().toISOString()
    };
    const docId = `${payload.academicYear}__${classLabel}__${studentId}__${examType}`;
    await setDoc(doc(db, `${BASE_PATH}/examResults`, docId), payload, { merge: true });
    alert(publish ? 'Result published.' : 'Draft saved.');
};
document.getElementById('marks-save-draft-btn').addEventListener('click', () => saveMarksEntry(false));
document.getElementById('marks-publish-btn').addEventListener('click', () => saveMarksEntry(true));

document.getElementById('result-bulk-upload-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const file = document.getElementById('result-bulk-file').files?.[0];
    if (!file) return alert('Choose a file first.');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (!rows.length) return alert('No rows found.');
    let count = 0;
    for (const row of rows) {
        const studentId = String(row.studentId || '').trim();
        const classLabel = String(row.classLabel || '').trim().toUpperCase();
        const examType = String(row.examType || '').trim() || 'quarterly';
        if (!studentId || !classLabel) continue;
        const schema = getResultSchemaForClass(classLabel);
        if (!schema) continue;
        const docId = `${getActiveAcademicYearLabel()}__${classLabel}__${studentId}__${examType}`;
        const marks = {};
        const grades = {};
        const rowKeys = Object.keys(row);
        (schema.subjects || []).forEach((subject) => {
            const markKey = rowKeys.find((key) => {
                const normalizedKey = key.toString().trim().toUpperCase();
                return normalizedKey.includes(`[${subject.code}]`)
                    || normalizedKey === subject.code
                    || normalizedKey === subject.name.toUpperCase();
            });
            const raw = String(markKey ? row[markKey] : '').trim();
            marks[subject.code] = raw;
            const upper = raw.toUpperCase();
            if (upper === 'A') grades[subject.code] = 'ABS';
            else if (upper === 'P') grades[subject.code] = 'P';
            else {
                const numeric = Number(raw);
                grades[subject.code] = Number.isFinite(numeric)
                    ? calcGradeFromValue({ percentage: (numeric / Number(subject.totalMark || 100)) * 100, raw: numeric })
                    : '-';
            }
        });
        const payload = {
            academicYear: getActiveAcademicYearLabel(),
            classLabel,
            studentId,
            examType,
            marks,
            grades,
            attendance: { workingDays: Number(row.workingDays) || 0, presentDays: Number(row.presentDays) || 0 },
            totals: calcTotals(marks, schema),
            published: true,
            showMarksToStudents: schema.examConfigs?.[examType]?.showMarksToStudents === true,
            updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, `${BASE_PATH}/examResults`, docId), payload, { merge: true });
        count += 1;
    }
    alert(`${count} row(s) processed and published.`);
});

const renderPublishedResults = () => {
    const classLabel = document.getElementById('published-class-select').value;
    const examType = document.getElementById('published-exam-select').value;
    const rows = examResultsCache
        .filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.classLabel === classLabel && item.examType === examType && item.published === true)
        .sort((a, b) => (b.totals?.obtained || 0) - (a.totals?.obtained || 0))
        .map((item, index) => ({ ...item, rank: index + 1 }));
    const tableEl = document.getElementById('published-results-table');
    if (!rows.length) {
        tableEl.innerHTML = '<div class="text-sm text-gray-500">No published results for this filter.</div>';
        renderPublishedSummary([]);
        return;
    }
    tableEl.innerHTML = `
        <table class="w-full text-sm border-collapse">
            <thead><tr class="bg-gray-50 border-b"><th class="p-2 text-left"><input type="checkbox" id="published-select-all"></th><th class="p-2 text-left">Rank</th><th class="p-2 text-left">Student</th><th class="p-2 text-left">Total</th><th class="p-2 text-left">Status</th><th class="p-2 text-left">Action</th></tr></thead>
            <tbody>${rows.map((row) => {
                const student = students.find((item) => item.id === row.studentId);
                return `<tr class="border-b">
                    <td class="p-2"><input type="checkbox" class="published-row-check" value="${row.id}"></td>
                    <td class="p-2 font-bold">${row.rank}</td>
                    <td class="p-2">${escapeHtml(student?.name || row.studentId)}</td>
                    <td class="p-2">${escapeHtml(String(row.totals?.obtained || 0))}/${escapeHtml(String(row.totals?.maximum || 0))}</td>
                    <td class="p-2 font-bold ${row.totals?.passStatus === 'PASS' ? 'text-emerald-700' : 'text-red-700'}">${escapeHtml(row.totals?.passStatus || '--')}</td>
                    <td class="p-2"><button class="published-edit-btn text-indigo-700 font-bold mr-2" data-id="${row.id}" data-student="${row.studentId}" data-class="${row.classLabel}" data-exam="${row.examType}">Edit</button><button class="published-del-btn text-red-700 font-bold" data-id="${row.id}">Delete</button></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    document.getElementById('published-select-all')?.addEventListener('change', (event) => {
        document.querySelectorAll('.published-row-check').forEach((checkbox) => { checkbox.checked = event.target.checked; });
    });
    renderPublishedSummary(rows);
};
const renderDraftResults = () => {
    const classLabel = document.getElementById('draft-class-select').value;
    const examType = document.getElementById('draft-exam-select').value;
    const rows = examResultsCache
        .filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.classLabel === classLabel && item.examType === examType && item.published !== true)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const tableEl = document.getElementById('draft-results-table');
    if (!rows.length) {
        tableEl.innerHTML = '<div class="text-sm text-gray-500">No draft results for this filter.</div>';
        return;
    }
    tableEl.innerHTML = `
        <table class="w-full text-sm border-collapse">
            <thead><tr class="bg-gray-50 border-b"><th class="p-2 text-left"><input type="checkbox" id="draft-select-all"></th><th class="p-2 text-left">Student</th><th class="p-2 text-left">Total</th><th class="p-2 text-left">Updated</th><th class="p-2 text-left">Action</th></tr></thead>
            <tbody>${rows.map((row) => {
                const student = students.find((item) => item.id === row.studentId);
                return `<tr class="border-b">
                    <td class="p-2"><input type="checkbox" class="draft-row-check" value="${row.id}"></td>
                    <td class="p-2">${escapeHtml(student?.name || row.studentId)}</td>
                    <td class="p-2">${escapeHtml(String(row.totals?.obtained || 0))}/${escapeHtml(String(row.totals?.maximum || 0))}</td>
                    <td class="p-2">${escapeHtml(formatDateTime(row.updatedAt || ''))}</td>
                    <td class="p-2"><button class="draft-edit-btn text-indigo-700 font-bold mr-2" data-id="${row.id}" data-student="${row.studentId}" data-class="${row.classLabel}" data-exam="${row.examType}">Edit</button><button class="draft-publish-btn text-emerald-700 font-bold mr-2" data-id="${row.id}">Publish</button><button class="draft-del-btn text-red-700 font-bold" data-id="${row.id}">Delete</button></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    document.getElementById('draft-select-all')?.addEventListener('change', (event) => {
        document.querySelectorAll('.draft-row-check').forEach((checkbox) => { checkbox.checked = event.target.checked; });
    });
};
document.getElementById('published-load-btn').addEventListener('click', renderPublishedResults);
document.getElementById('draft-load-btn').addEventListener('click', renderDraftResults);
document.getElementById('result-run-readiness-btn')?.addEventListener('click', runResultReadinessChecklist);
document.getElementById('result-readiness-class-select')?.addEventListener('change', runResultReadinessChecklist);
document.getElementById('result-readiness-exam-select')?.addEventListener('change', runResultReadinessChecklist);
document.getElementById('published-results-table').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.published-edit-btn');
    if (editBtn) {
        switchResultTab('result-marks-tab');
        document.getElementById('marks-class-select').value = editBtn.dataset.class;
        populateMarksStudentSelect();
        document.getElementById('marks-student-select').value = editBtn.dataset.student;
        document.getElementById('marks-exam-select').value = editBtn.dataset.exam;
        loadMarksEntry();
        return;
    }
    const delBtn = event.target.closest('.published-del-btn');
    if (delBtn && confirm('Delete this published result?')) {
        await deleteDoc(doc(db, `${BASE_PATH}/examResults`, delBtn.dataset.id));
    }
});
document.getElementById('published-bulk-delete-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const selectedIds = Array.from(document.querySelectorAll('.published-row-check:checked')).map((checkbox) => checkbox.value);
    if (!selectedIds.length) return alert('Select at least one result.');
    if (!confirm(`Delete ${selectedIds.length} selected results?`)) return;
    await Promise.all(selectedIds.map((id) => deleteDoc(doc(db, `${BASE_PATH}/examResults`, id))));
});
document.getElementById('draft-results-table').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.draft-edit-btn');
    if (editBtn) {
        switchResultTab('result-marks-tab');
        document.getElementById('marks-class-select').value = editBtn.dataset.class;
        populateMarksStudentSelect();
        document.getElementById('marks-student-select').value = editBtn.dataset.student;
        document.getElementById('marks-exam-select').value = editBtn.dataset.exam;
        loadMarksEntry();
        return;
    }
    const publishBtn = event.target.closest('.draft-publish-btn');
    if (publishBtn) {
        await updateDoc(doc(db, `${BASE_PATH}/examResults`, publishBtn.dataset.id), { published: true, updatedAt: new Date().toISOString() });
        return;
    }
    const delBtn = event.target.closest('.draft-del-btn');
    if (delBtn && confirm('Delete this draft result?')) {
        await deleteDoc(doc(db, `${BASE_PATH}/examResults`, delBtn.dataset.id));
    }
});
document.getElementById('draft-bulk-publish-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const selectedIds = Array.from(document.querySelectorAll('.draft-row-check:checked')).map((checkbox) => checkbox.value);
    if (!selectedIds.length) return alert('Select at least one draft result.');
    await Promise.all(selectedIds.map((id) => updateDoc(doc(db, `${BASE_PATH}/examResults`, id), { published: true, updatedAt: new Date().toISOString() })));
    alert(`${selectedIds.length} draft result(s) published.`);
});
document.getElementById('draft-bulk-delete-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const selectedIds = Array.from(document.querySelectorAll('.draft-row-check:checked')).map((checkbox) => checkbox.value);
    if (!selectedIds.length) return alert('Select at least one draft result.');
    if (!confirm(`Delete ${selectedIds.length} selected draft results?`)) return;
    await Promise.all(selectedIds.map((id) => deleteDoc(doc(db, `${BASE_PATH}/examResults`, id))));
});

const buildPublishedResultPrintableHtml = () => {
    const classLabel = document.getElementById('published-class-select').value;
    const examType = document.getElementById('published-exam-select').value;
    const schema = getResultSchemaForClass(classLabel);
    const subjects = schema?.subjects || [];
    const rows = examResultsCache
        .filter((item) => item.academicYear === getActiveAcademicYearLabel() && item.classLabel === classLabel && item.examType === examType && item.published === true)
        .sort((a, b) => (b.totals?.obtained || 0) - (a.totals?.obtained || 0))
        .map((item, index) => ({ ...item, rank: index + 1, student: students.find((student) => student.id === item.studentId) }));
    if (!rows.length) return '';

    const thSubjects = subjects.map((subject) => `<th>${escapeHtml(subject.name)} (${escapeHtml(String(subject.totalMark || 100))})</th>`).join('');
    const bodyRows = rows.map((row) => {
        const subjectMarks = subjects.map((subject) => `<td>${escapeHtml(String(row.marks?.[subject.code] ?? '-'))}</td>`).join('');
        return `<tr>
            <td>${escapeHtml(row.student?.name || row.studentId)}</td>
            ${subjectMarks}
            <td>${escapeHtml(String(row.totals?.obtained ?? 0))}/${escapeHtml(String(row.totals?.maximum ?? 0))}</td>
            <td>${escapeHtml(String(row.rank))}</td>
            <td>${escapeHtml(String(row.attendance?.presentDays ?? 0))}/${escapeHtml(String(row.attendance?.workingDays ?? 0))}</td>
            <td>${escapeHtml(row.totals?.passStatus || '--')}</td>
        </tr>`;
    }).join('');

    return `
        <div class="page">
            <h2>${escapeHtml(document.getElementById('app-name-header')?.textContent || 'Institution')}</h2>
            <div>Academic Year: ${escapeHtml(getActiveAcademicYearLabel())}</div>
            <div>Exam: ${escapeHtml(examType)} | Class: ${escapeHtml(classLabel)}</div>
            <table>
                <thead>
                    <tr>
                        <th>Student Name</th>
                        ${thSubjects}
                        <th>Total</th>
                        <th>Rank</th>
                        <th>Attendance</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
    `;
};
document.getElementById('published-download-pdf-btn').addEventListener('click', () => {
    const content = buildPublishedResultPrintableHtml();
    if (!content) return alert('No published rows available for PDF.');
    const popup = window.open('', '_blank');
    if (!popup) return alert('Popup blocked. Please allow popups and retry.');
    popup.document.write(`
        <html>
        <head>
            <title>Published Results</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .page { page-break-after: always; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
                th, td { border: 1px solid #333; padding: 6px; text-align: left; }
                th { background: #f2f2f2; }
            </style>
        </head>
        <body>${content}</body>
        </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
});

document.getElementById('run-auto-promotion-btn').addEventListener('click', async () => {
    if(!requirePermission('results.manage')) return;
    const targetYear = sanitizeAcademicYearLabel(document.getElementById('promotion-target-year-select').value || '');
    if (targetYear === getActiveAcademicYearLabel()) return alert('Select a different target academic year for promotion.');
    const progressionMap = resultCenterSettings.classProgressionMap || {};
    const annualRows = examResultsCache.filter((row) => row.academicYear === getActiveAcademicYearLabel() && row.examType === 'annual' && row.published === true);
    if (!annualRows.length) return alert('No annual published results found.');
    const operations = [];
    annualRows.forEach((row) => {
        if (row.totals?.passStatus !== 'PASS') return;
        const student = students.find((item) => item.id === row.studentId);
        if (!student) return;
        const toClass = progressionMap[student.class] || '';
        if (!toClass) return;
        const isGraduated = toClass === 'GRADUATED';
        operations.push(updateDoc(doc(db, `${BASE_PATH}/students`, student.id), {
            class: isGraduated ? student.class : toClass,
            academicYear: targetYear,
            status: isGraduated ? 'Graduated' : (student.status || 'Active')
        }));
        operations.push(setDoc(
            getEnrollmentRef(targetYear, student.id),
            buildEnrollmentPayload(student.id, {
                ...student,
                class: isGraduated ? student.class : toClass,
                academicYear: targetYear,
                status: isGraduated ? 'Graduated' : (student.status || 'Active')
            }),
            { merge: true }
        ));
        const promotionId = `${getActiveAcademicYearLabel()}__${student.id}`;
        operations.push(setDoc(doc(db, `${BASE_PATH}/promotionDecisions`, promotionId), {
            academicYear: getActiveAcademicYearLabel(),
            studentId: student.id,
            fromClass: student.class,
            toClass: isGraduated ? 'GRADUATED' : toClass,
            targetAcademicYear: targetYear,
            basedOnExam: 'annual',
            decision: isGraduated ? 'GRADUATED' : 'PROMOTED',
            finalizedAt: new Date().toISOString()
        }, { merge: true }));
    });
    if (!operations.length) return alert('No promotable students found.');
    await Promise.all(operations);
    alert('Auto promotion completed for annual PASS students.');
});

}
// --- 6. FEE CONCESSIONS ---
const renderConcessionsList = () => {
    const fCls = document.getElementById('filter-conc-class').value, sTerm = document.getElementById('search-conc-input').value.toLowerCase();
    const cont = document.getElementById('conc-list-container'), emptyState = document.getElementById('conc-list-empty'), actCont = document.getElementById('active-concessions-list');

    const withConc = students.filter(s => s.concessionFee !== undefined && s.concessionFee !== null);
    actCont.innerHTML = withConc.length ? withConc.map(s => `<div class="bg-white p-3 rounded-lg shadow-sm border border-green-200 flex justify-between items-center gap-2"><div class="truncate"><div class="font-bold text-sm truncate text-gray-800">${escapeHtml(s.name || '-')}</div><div class="text-xs text-gray-500">${escapeHtml(s.class || '--')}</div></div><div class="flex items-center gap-1 shrink-0"><span class="bg-green-100 text-green-800 font-bold px-2 py-1 rounded text-sm border border-green-300">₹${escapeHtml(String(s.concessionFee))}</span><button class="bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded text-xs hover:bg-blue-100 concession-open-btn" data-id="${s.id}">Edit</button><button class="bg-red-50 text-red-700 font-bold px-2 py-1 rounded text-xs hover:bg-red-100 concession-delete-btn" data-id="${s.id}">Delete</button></div></div>`).join('') : '<p class="text-sm text-gray-500 col-span-full italic">No active concessions.</p>';

    if(!fCls && !sTerm) { emptyState.classList.remove('hidden'); cont.classList.add('hidden'); return; }
    emptyState.classList.add('hidden'); cont.classList.remove('hidden');

    const fil = students.filter(s => { let match = true; if(fCls) match = match && s.class === fCls; if(sTerm) match = match && (s.name.toLowerCase().includes(sTerm) || (s.adm && s.adm.toLowerCase().includes(sTerm))); return match; });

    if(fil.length === 0) { cont.innerHTML = '<p class="text-gray-500 p-2">കുട്ടികളെ കണ്ടെത്താനായില്ല.</p>'; return; }
    cont.innerHTML = fil.map(s => `<div class="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm gap-2"><div class="font-medium text-gray-800">${escapeHtml(s.name || '-')} <span class="text-xs text-gray-500 ml-2">${escapeHtml(s.class || '--')} (Adm: ${escapeHtml(s.adm||'-')})</span></div><div class="flex gap-2 shrink-0"><button class="bg-blue-50 text-blue-700 font-bold px-3 py-1.5 rounded-lg text-sm transition hover:shadow-md concession-open-btn" data-id="${s.id}">${s.concessionFee!==undefined?'Edit':'Set Concession'}</button>${s.concessionFee!==undefined?`<button class="bg-red-50 text-red-700 font-bold px-3 py-1.5 rounded-lg text-sm transition hover:shadow-md concession-delete-btn" data-id="${s.id}">Delete</button>`:''}</div></div>`).join('');
};
document.getElementById('filter-conc-class').addEventListener('change', renderConcessionsList);
document.getElementById('search-conc-input').addEventListener('input', renderConcessionsList);

document.getElementById('fee-concessions-page').addEventListener('click', (e) => {
    const btn = e.target.closest('.concession-open-btn');
    const delBtn = e.target.closest('.concession-delete-btn');
    if (btn) window.openConcModal(btn.dataset.id);
    if (delBtn) window.deleteConcession(delBtn.dataset.id);
});

window.openConcModal = (id) => {
    const s = students.find(st=>st.id===id); if(!s) return;
    document.getElementById('conc-student-id').value = s.id;
    document.getElementById('conc-student-name').textContent = `${s.name} (${s.class})`;
    document.getElementById('conc-fee-amount').value = s.concessionFee !== undefined ? s.concessionFee : '';
    document.getElementById('conc-remove').classList.toggle('hidden', s.concessionFee === undefined);
    document.getElementById('concession-popup').classList.remove('hidden'); document.getElementById('concession-popup').classList.add('flex');
};
document.getElementById('conc-cancel').onclick = () => document.getElementById('concession-popup').classList.add('hidden');
document.getElementById('conc-save').onclick = async () => {
    if(!requirePermission('concessions.manage')) return;
    const amt = parseFloat(document.getElementById('conc-fee-amount').value);
    if(isNaN(amt) || amt < 0) return alert("Enter valid amount");
    if(!confirm("ഈ കൺസെഷൻ ഡാറ്റാബേസിൽ സേവ് ചെയ്യട്ടെ?")) return;
    const studentId = document.getElementById('conc-student-id').value;
    await updateDoc(doc(db, `${BASE_PATH}/students`, studentId), { concessionFee: amt, concessionAppliedAt: Date.now(), concessionUpdatedAt: Date.now() });
    await logAuditEvent({ category: 'fee', action: 'concession.save', entityType: 'student', entityId: studentId, message: `Concession saved: ₹${amt}.` });
    document.getElementById('concession-popup').classList.add('hidden');
};
document.getElementById('conc-remove').onclick = async () => {
    const studentId = document.getElementById('conc-student-id').value;
    await window.deleteConcession(studentId);
    document.getElementById('concession-popup').classList.add('hidden');
};
window.deleteConcession = async (studentId) => {
    if(!requirePermission('concessions.manage')) return;
    if(!confirm("ഈ വിദ്യാർത്ഥിയുടെ കൺസെഷൻ ഒഴിവാക്കട്ടെ?")) return;
    await updateDoc(doc(db, `${BASE_PATH}/students`, studentId), { concessionFee: null, concessionUpdatedAt: Date.now() });
    await logAuditEvent({ category: 'fee', action: 'concession.remove', entityType: 'student', entityId: studentId, message: 'Concession removed.' });
};

// --- 7. FEE SETTINGS (Auto 12 Months Generation added in init) ---
document.getElementById('adv-fee-scope').addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('scope-global-container').classList.toggle('hidden', val !== 'global');
    document.getElementById('scope-class-wise-container').classList.toggle('hidden', val !== 'class-wise');
    document.getElementById('scope-specific-container').classList.toggle('hidden', val !== 'specific');
    if(val === 'class-wise') document.getElementById('class-wise-inputs').innerHTML = classes.map(c => `<div><label class="block text-xs font-bold text-gray-600 mb-1">${c}</label><input type="number" data-class="${c}" class="cw-input w-full p-2 border rounded text-sm font-medium" placeholder="₹"></div>`).join('');
    if(val === 'specific') document.getElementById('adv-fee-specific-class').innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
});

document.getElementById('add-adv-fee-btn').addEventListener('click', () => {
    if(!requirePermission('fees.manage')) return;
    const name = document.getElementById('adv-fee-name').value.trim(), scope = document.getElementById('adv-fee-scope').value, isMandatory = document.getElementById('adv-fee-receipt-req').checked;
    if(!name) return alert("Fee Item Name is mandatory.");
    let feeData = { key: `custom-${Date.now()}`, name: name, type: 'custom', isVisible: true, scope: scope, isReceiptMandatory: isMandatory, academicYear: getActiveAcademicYearLabel() };

    if(scope === 'global') {
        const amt = parseFloat(document.getElementById('adv-fee-global-amt').value); if(isNaN(amt)) return alert("Enter valid global amount"); feeData.amount = amt;
    } else if(scope === 'class-wise') {
        let classAmounts = {}; document.querySelectorAll('.cw-input').forEach(inp => { const amt = parseFloat(inp.value); if(!isNaN(amt)) classAmounts[inp.dataset.class] = amt; });
        if(Object.keys(classAmounts).length === 0) return alert("Enter amount for at least one class"); feeData.classValues = classAmounts;
    } else if(scope === 'specific') {
        const targetCls = document.getElementById('adv-fee-specific-class').value, amt = parseFloat(document.getElementById('adv-fee-specific-amt').value);
        if(!targetCls || isNaN(amt)) return alert("Select class and enter valid amount"); feeData.targetClass = targetCls; feeData.amount = amt;
    }
    if(!confirm("പുതിയ ഫീ ഐറ്റം ആഡ് ചെയ്യട്ടെ?")) return;
    setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {feeItems: [...feeItems, feeData]}, {merge:true});
    logAuditEvent({ category: 'fee', action: 'fee.create', entityType: 'feeItem', entityId: feeData.key, message: `Fee item created: ${name}.` });
    document.getElementById('adv-fee-name').value = ''; document.getElementById('adv-fee-global-amt').value = ''; alert("Advanced Fee Created!");
});

document.getElementById('save-fee-config-btn').addEventListener('click', async () => {
    if(!requirePermission('fees.manage')) return;
    if(!confirm("ഡിഫോൾട്ട് ഫീസ് സെറ്റിംഗ്സ് സേവ് ചെയ്യട്ടെ?")) return;
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {
        defaultFee: parseInt(document.getElementById('default-fee-input').value),
        feeStatusTitle: document.getElementById('fee-status-title-input').value,
        defaultReceiptMandatory: document.getElementById('default-fee-receipt-req').checked
    }, {merge: true});
    await logAuditEvent({ category: 'fee', action: 'fee.config.save', entityType: 'settings', entityId: 'config', message: 'Default fee configuration updated.' });
    alert("Fee Configuration Saved!");
});

const renderFeeItemsManagement = () => {
    const cont = document.getElementById('fee-items-management-container');
    const activeYear = getActiveAcademicYearLabel();
    const scopedFeeItems = feeItems.filter((item) => (item.academicYear || activeYear) === activeYear);
    const monthlyItems = scopedFeeItems
        .filter((item) => (item.type || 'month') === 'month')
        .sort((a, b) => {
            const aMonth = (a.name || '').split('(')[0].trim().toLowerCase();
            const bMonth = (b.name || '').split('(')[0].trim().toLowerCase();
            const aIndex = MONTH_SEQUENCE.indexOf(aMonth);
            const bIndex = MONTH_SEQUENCE.indexOf(bMonth);
            if (aIndex === -1 && bIndex === -1) return (a.name || '').localeCompare(b.name || '');
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });
    const customItems = scopedFeeItems.filter((item) => item.type === 'custom');

    const renderItemCard = (item) => {
        let detailsHtml = '';
        if(item.type === 'custom') detailsHtml = `<div class="text-xs text-gray-500 mt-1">Scope: <span class="font-semibold text-blue-600 uppercase">${item.scope || 'GLOBAL'}</span> | Receipt Mandatory: <span class="font-semibold ${item.isReceiptMandatory ? 'text-red-500':'text-gray-400'}">${item.isReceiptMandatory ? 'YES':'NO'}</span></div>`;
        const handleHtml = item.type === 'custom'
            ? `<span class="drag-handle mr-4 text-gray-500 text-lg bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-2 py-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder"><i class="fas fa-grip-lines"></i></span>`
            : `<span class="mr-4 text-[10px] font-bold uppercase text-gray-400">Fixed</span>`;
        return `<div class="flex items-center bg-white border border-gray-200 p-4 rounded-xl shadow-sm drag-item transition hover:shadow-md" data-key="${item.key}">${handleHtml}<div class="flex-grow"><span class="font-bold text-gray-800 text-lg">${item.name}</span>${detailsHtml}</div>${item.type==='custom' ? `<button class="text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-sm font-bold transition edit-fee mr-2" data-key="${item.key}"><i class="fas fa-edit"></i></button><button class="text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-bold transition del-fee" data-key="${item.key}"><i class="fas fa-trash"></i></button>` : `<span class="px-3 py-1 bg-gray-100 text-gray-500 rounded-lg text-xs font-bold uppercase tracking-wider">Default Month</span>`}</div>`;
    };

    cont.innerHTML = `
        <div class="mb-4">
            <h4 class="text-sm font-bold text-blue-700 mb-2 uppercase tracking-wider">Default Months (${escapeHtml(activeYear)})</h4>
            <div id="fee-items-monthly-list" class="space-y-3">${monthlyItems.map(renderItemCard).join('') || '<p class="text-xs text-gray-500 italic">Monthly defaults are not available.</p>'}</div>
        </div>
        <div>
            <h4 class="text-sm font-bold text-emerald-700 mb-2 uppercase tracking-wider">Other Fee Items (${escapeHtml(activeYear)})</h4>
            <div id="fee-items-custom-list" class="space-y-3">${customItems.map(renderItemCard).join('') || '<p class="text-xs text-gray-500 italic">No custom fee items added yet.</p>'}</div>
        </div>
    `;

    const persistFeeOrder = async () => {
        const orderedKeys = [
            ...Array.from(cont.querySelectorAll('#fee-items-monthly-list .drag-item')).map((el) => el.dataset.key),
            ...Array.from(cont.querySelectorAll('#fee-items-custom-list .drag-item')).map((el) => el.dataset.key)
        ];
        const orderedItems = orderedKeys.map((key) => feeItems.find((item) => item.key === key)).filter(Boolean);
        const remainingItems = feeItems.filter((item) => !orderedKeys.includes(item.key));
        const nextItems = [...orderedItems, ...remainingItems];
        if (orderedItems.length === 0) return;
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), { feeItems: nextItems }, { merge: true });
    };

    const monthlyList = document.getElementById('fee-items-monthly-list');
    const customList = document.getElementById('fee-items-custom-list');
    const sortableOptions = {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 8,
        fallbackTolerance: 6,
        forceFallback: true,
        onEnd: persistFeeOrder
    };
    if (customList && customItems.length > 1) new Sortable(customList, sortableOptions);
};

document.getElementById('fee-items-management-container').addEventListener('click', e => {
    const delBtn = e.target.closest('.del-fee'), editBtn = e.target.closest('.edit-fee');
    if(delBtn) {
        if(!confirm("ഈ ഫീ ഐറ്റം ഡിലീറ്റ് ചെയ്യട്ടെ?")) return;
        setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {feeItems: feeItems.filter(i => i.key !== delBtn.dataset.key)}, {merge:true});
    }
    if(editBtn) {
        if(!requirePermission('fees.manage')) return;
        const item = feeItems.find(i => i.key === editBtn.dataset.key); if(!item) return;
        document.getElementById('e-fee-key').value = item.key; document.getElementById('e-fee-name').value = item.name;
        document.getElementById('e-fee-scope').value = item.scope || 'global';
        document.getElementById('e-fee-receipt-req').checked = item.isReceiptMandatory || false;

        document.getElementById('e-scope-global-container').classList.add('hidden'); document.getElementById('e-scope-class-wise-container').classList.add('hidden'); document.getElementById('e-scope-specific-container').classList.add('hidden');

        if(item.scope === 'global' || !item.scope) {
            document.getElementById('e-scope-global-container').classList.remove('hidden'); document.getElementById('e-fee-global-amt').value = item.amount || '';
        } else if(item.scope === 'class-wise') {
            document.getElementById('e-scope-class-wise-container').classList.remove('hidden');
            document.getElementById('e-class-wise-inputs').innerHTML = classes.map(c => `<div><label class="block text-xs font-bold text-gray-600 mb-1">${c}</label><input type="number" data-class="${c}" class="e-cw-input w-full p-2 border rounded text-sm font-medium" value="${item.classValues && item.classValues[c] ? item.classValues[c] : ''}"></div>`).join('');
        } else if(item.scope === 'specific') {
            document.getElementById('e-scope-specific-container').classList.remove('hidden');
            document.getElementById('e-fee-specific-class').innerHTML = classes.map(c => `<option value="${c}" ${item.targetClass===c?'selected':''}>${c}</option>`).join('');
            document.getElementById('e-fee-specific-amt').value = item.amount || '';
        }
        document.getElementById('edit-fee-popup').classList.remove('hidden'); document.getElementById('edit-fee-popup').classList.add('flex');
    }
});

document.getElementById('e-fee-scope').addEventListener('change', (e) => {
    const val = e.target.value;
    document.getElementById('e-scope-global-container').classList.toggle('hidden', val !== 'global');
    document.getElementById('e-scope-class-wise-container').classList.toggle('hidden', val !== 'class-wise');
    document.getElementById('e-scope-specific-container').classList.toggle('hidden', val !== 'specific');
    if(val === 'class-wise') document.getElementById('e-class-wise-inputs').innerHTML = classes.map(c => `<div><label class="block text-xs font-bold text-gray-600 mb-1">${c}</label><input type="number" data-class="${c}" class="e-cw-input w-full p-2 border rounded text-sm font-medium"></div>`).join('');
    if(val === 'specific') document.getElementById('e-fee-specific-class').innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
});

document.getElementById('e-fee-cancel').onclick = () => document.getElementById('edit-fee-popup').classList.add('hidden');
document.getElementById('e-fee-update').onclick = () => {
    if(!requirePermission('fees.manage')) return;
    const key = document.getElementById('e-fee-key').value, name = document.getElementById('e-fee-name').value.trim(), scope = document.getElementById('e-fee-scope').value;
    if(!name) return alert("Name is mandatory.");

    if(!confirm("ഈ ഫീ ഐറ്റത്തിൽ വരുത്തിയ മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;

    let updatedFee = { key, name, type: 'custom', isVisible: true, scope, isReceiptMandatory: document.getElementById('e-fee-receipt-req').checked, academicYear: getActiveAcademicYearLabel() };

    if(scope === 'global') {
        const amt = parseFloat(document.getElementById('e-fee-global-amt').value); if(isNaN(amt)) return alert("Enter valid amount"); updatedFee.amount = amt;
    } else if(scope === 'class-wise') {
        let classAmounts = {}; document.querySelectorAll('.e-cw-input').forEach(inp => { const amt = parseFloat(inp.value); if(!isNaN(amt)) classAmounts[inp.dataset.class] = amt; });
        if(Object.keys(classAmounts).length === 0) return alert("Enter amount for at least one class"); updatedFee.classValues = classAmounts;
    } else if(scope === 'specific') {
        const targetCls = document.getElementById('e-fee-specific-class').value, amt = parseFloat(document.getElementById('e-fee-specific-amt').value);
        if(!targetCls || isNaN(amt)) return alert("Select class and enter valid amount"); updatedFee.targetClass = targetCls; updatedFee.amount = amt;
    }

    const newFees = feeItems.map(f => f.key === key ? updatedFee : f);
    setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {feeItems: newFees}, {merge:true});
    logAuditEvent({ category: 'fee', action: 'fee.update', entityType: 'feeItem', entityId: key, message: `Fee item updated: ${name}.` });
    document.getElementById('edit-fee-popup').classList.add('hidden');
};

// --- 8. WEBSITE BASIC INFO ---
document.getElementById('save-web-info-btn').addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    if(!confirm("വെബ്സൈറ്റ് വിവരങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;
    const btn = document.getElementById('save-web-info-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';
    btn.disabled = true;

    try {
        const getInputValue = (id, transform = (value) => value) => {
            const element = document.getElementById(id);
            if (!element) return '';
            return transform(String(element.value ?? ''));
        };

        await setDoc(doc(db, `${BASE_PATH}/settings`, 'config'), {
            appName: getInputValue('app-name-input'),
            appSubtitle: getInputValue('app-subtitle-input'),
            logoUrl: getInputValue('web-logo'),
            contactPhone: getInputValue('web-phone'),
            contactEmail: getInputValue('web-email'),
            socialWhatsapp: getInputValue('web-wa'),
            socialFacebook: getInputValue('web-fb'),
            socialInstagram: getInputValue('web-ig'),
            socialTelegram: getInputValue('web-tg'),
            socialYouTube: getInputValue('web-yt'),
            regNo: getInputValue('web-regno', (value) => value.trim()),
            place: getInputValue('web-place', (value) => value.trim()),
            paymentAccountName: getInputValue('pay-account-name', (value) => value.trim()),
            paymentUpiNumber: getInputValue('pay-upi-number', (value) => value.trim()),
            paymentUpiId: getInputValue('pay-upi-id', (value) => value.trim()),
            paymentBankName: '',
            paymentAccountNumber: '',
            paymentIfsc: '',
            paymentBranch: '',
            paymentUpiName: ''
        }, {merge: true});
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'content'), { description: getInputValue('web-about') }, {merge: true});
        await logAuditEvent({ category: 'website', action: 'website.info.save', entityType: 'settings', entityId: 'config', message: 'Website basic information updated.' });
        alert("Basic Info Updated!");
    } catch (error) {
        console.error('Failed to save website basic info.', error);
        alert(`Save failed: ${error?.message || 'Please check Firestore rules and admin permissions.'}`);
    } finally {
        btn.innerHTML = '<i class="fas fa-save mr-2"></i> Save Info';
        btn.disabled = false;
    }
});

// --- 9 & 10. NOTICES & GALLERY ---
const updateWebContent = async () => { await setDoc(doc(db, `${BASE_PATH}/settings`, 'content'), webContent, {merge: true}); }
const expandedNoticeIndexes = new Set();
const normalizeNoticePayload = (notice = {}, previous = {}) => {
    const now = Date.now();
    const wasPinned = previous.pinned === true;
    const isPinned = notice.pinned === true;
    return {
        id: previous.id || notice.id || `notice-${now}-${Math.random().toString(36).slice(2, 8)}`,
        heading: String(notice.heading || '').trim(),
        text: String(notice.text || '').trim(),
        date: String(notice.date || '').trim(),
        pinned: isPinned,
        createdAt: previous.createdAt || notice.createdAt || now,
        updatedAt: now,
        pinnedAt: isPinned ? (wasPinned ? (previous.pinnedAt || notice.pinnedAt || now) : now) : ''
    };
};
const renderWebNotices = () => {
    const list = document.getElementById('web-notices-list');
    list.innerHTML = webContent.notices.length === 0
        ? '<p class="text-sm italic text-gray-500 p-2">No active notices.</p>'
        : webContent.notices.map((notice, i) => {
            const n = normalizeNoticePayload(notice);
            return `
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4 bg-white border border-gray-200 rounded-xl shadow-sm text-sm transition hover:shadow-md">
                <div class="text-gray-800 font-medium min-w-0 w-full break-words whitespace-pre-wrap">
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                        <span class="inline-flex bg-blue-100 text-blue-800 px-3 py-1 rounded-lg font-bold font-mono">${escapeHtml(n.date || '--')}</span>
                        ${n.pinned ? '<span class="inline-flex bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-bold text-xs"><i class="fas fa-thumbtack mr-1"></i>Pinned</span>' : ''}
                    </div>
                    <div class="font-extrabold text-gray-900 mb-1">${escapeHtml(n.heading || 'Notice')}</div>
                    <div class="break-words ${expandedNoticeIndexes.has(i) ? '' : 'overflow-hidden'}" style="${expandedNoticeIndexes.has(i) ? '' : 'max-height: 6em;'}">${escapeHtml(n.text || '')}</div>
                    ${(n.text || '').length > 160 ? `<button class="text-xs font-bold text-blue-700 mt-2 notice-toggle-btn" data-index="${i}">${expandedNoticeIndexes.has(i) ? 'Collapse' : 'Expand'}</button>` : ''}
                </div>
                <div class="flex items-center shrink-0">
                    <button class="text-blue-500 bg-blue-50 hover:bg-blue-100 w-8 h-8 rounded-lg flex items-center justify-center transition inline-flex mr-2 notice-action-btn" data-action="edit" data-index="${i}"><i class="fas fa-edit"></i></button>
                    <button class="text-red-500 bg-red-50 hover:bg-red-100 w-8 h-8 rounded-lg flex items-center justify-center transition inline-flex notice-action-btn" data-action="delete" data-index="${i}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
        }).join('');
};
document.getElementById('add-notice-btn').onclick = () => {
    if(!requirePermission('website.manage')) return;
    const heading = document.getElementById('new-notice-head').value.trim();
    const txt = document.getElementById('new-notice-txt').value.trim();
    const dt = document.getElementById('new-notice-dt').value;
    const pinned = document.getElementById('new-notice-pin').checked;
    if(heading && txt && dt) {
        if(!confirm("പുതിയ അറിയിപ്പ് പ്രസിദ്ധീകരിക്കട്ടെ?")) return;
        expandedNoticeIndexes.clear();
        webContent.notices.push(normalizeNoticePayload({ heading, text: txt, date: dt, pinned }));
        updateWebContent();
        logAuditEvent({ category: 'website', action: 'notice.create', entityType: 'notice', message: 'Website notice published.' });
        document.getElementById('new-notice-head').value = '';
        document.getElementById('new-notice-txt').value = '';
        document.getElementById('new-notice-pin').checked = false;
    }
};
window.deleteNotice = (idx) => { if(!requirePermission('website.manage')) return; if(!confirm("അറിയിപ്പ് ഡിലീറ്റ് ചെയ്യട്ടെ?")) return; expandedNoticeIndexes.clear(); webContent.notices.splice(idx, 1); updateWebContent(); logAuditEvent({ category: 'website', action: 'notice.delete', entityType: 'notice', entityId: String(idx), message: 'Website notice deleted.' }); };
window.editNotice = (idx) => {
    if(!requirePermission('website.manage')) return;
    const n = normalizeNoticePayload(webContent.notices[idx] || {}); document.getElementById('e-not-idx').value = idx;
    document.getElementById('e-not-head').value = n.heading;
    document.getElementById('e-not-txt').value = n.text;
    document.getElementById('e-not-dt').value = n.date;
    document.getElementById('e-not-pin').checked = n.pinned;
    document.getElementById('edit-notice-popup').classList.remove('hidden'); document.getElementById('edit-notice-popup').classList.add('flex');
};
document.getElementById('e-not-cancel').onclick = () => document.getElementById('edit-notice-popup').classList.add('hidden');
document.getElementById('e-not-save').onclick = () => {
    if(!requirePermission('website.manage')) return;
    const idx = document.getElementById('e-not-idx').value;
    const heading = document.getElementById('e-not-head').value.trim();
    const txt = document.getElementById('e-not-txt').value.trim();
    const dt = document.getElementById('e-not-dt').value;
    const pinned = document.getElementById('e-not-pin').checked;
    if(heading && txt && dt) {
        if(!confirm("അറിയിപ്പിലെ മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;
        expandedNoticeIndexes.clear();
        webContent.notices[idx] = normalizeNoticePayload({ heading, text: txt, date: dt, pinned }, webContent.notices[idx] || {});
        updateWebContent();
        logAuditEvent({ category: 'website', action: 'notice.update', entityType: 'notice', entityId: String(idx), message: 'Website notice updated.' });
        document.getElementById('edit-notice-popup').classList.add('hidden');
    }
};

const renderWebGallery = () => { document.getElementById('web-gallery-list').innerHTML = webContent.gallery.length === 0 ? '<p class="col-span-full text-sm italic text-gray-500 p-2">Gallery is empty.</p>' : webContent.gallery.map((url, i) => { const safeUrl = sanitizeUrl(url) || 'https://via.placeholder.com/320x180?text=Image'; return `<div class="relative rounded-xl overflow-hidden shadow-sm border border-gray-200"><img src="${safeUrl}" class="w-full h-32 object-cover" alt="Gallery image ${i + 1}"><div class="absolute top-2 right-2 flex items-center gap-2"><button class="bg-blue-500 hover:bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg transition transform hover:scale-110 gallery-action-btn" data-action="edit" data-index="${i}" aria-label="Edit image"><i class="fas fa-edit"></i></button><button class="bg-red-500 hover:bg-red-600 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg transition transform hover:scale-110 gallery-action-btn" data-action="delete" data-index="${i}" aria-label="Delete image"><i class="fas fa-trash"></i></button></div></div>`; }).join(''); };
document.getElementById('add-gal-btn').onclick = () => {
    if(!requirePermission('website.manage')) return;
    const url = document.getElementById('new-gal-url').value;
    if(url) {
        if(!confirm("ഗാലറിയിലേക്ക് ചിത്രം ആഡ് ചെയ്യട്ടെ?")) return;
        webContent.gallery.push(url); updateWebContent(); logAuditEvent({ category: 'website', action: 'gallery.create', entityType: 'gallery', message: 'Gallery image added.' }); document.getElementById('new-gal-url').value='';
    }
};
window.deleteGal = (idx) => { if(!requirePermission('website.manage')) return; if(!confirm("ചിത്രം ഡിലീറ്റ് ചെയ്യട്ടെ?")) return; webContent.gallery.splice(idx, 1); updateWebContent(); logAuditEvent({ category: 'website', action: 'gallery.delete', entityType: 'gallery', entityId: String(idx), message: 'Gallery image deleted.' }); };
window.editGal = (idx) => {
    if(!requirePermission('website.manage')) return;
    const newUrl = prompt("Edit Image URL:", webContent.gallery[idx]);
    if(newUrl && newUrl.trim()) {
        if(!confirm("മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?")) return;
        webContent.gallery[idx] = newUrl.trim(); updateWebContent(); logAuditEvent({ category: 'website', action: 'gallery.update', entityType: 'gallery', entityId: String(idx), message: 'Gallery image updated.' });
    }
};

document.getElementById('web-notices-page').addEventListener('click', (e) => {
    const button = e.target.closest('.notice-action-btn');
    const toggleBtn = e.target.closest('.notice-toggle-btn');
    if (toggleBtn) {
        const idx = Number(toggleBtn.dataset.index);
        if (expandedNoticeIndexes.has(idx)) expandedNoticeIndexes.delete(idx);
        else expandedNoticeIndexes.add(idx);
        renderWebNotices();
        return;
    }
    if (!button) return;
    if (button.dataset.action === 'edit') window.editNotice(Number(button.dataset.index));
    if (button.dataset.action === 'delete') window.deleteNotice(Number(button.dataset.index));
});
document.getElementById('web-gallery-page').addEventListener('click', (e) => {
    const button = e.target.closest('.gallery-action-btn');
    if (!button) return;
    if (button.dataset.action === 'edit') window.editGal(Number(button.dataset.index));
    if (button.dataset.action === 'delete') window.deleteGal(Number(button.dataset.index));
});

// --- 10B. DYNAMIC DIRECTORY CATEGORIES ---
const normalizeDirectoryField = (field = {}) => ({
    id: String(field.id || `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    label: String(field.label || '').trim(),
    key: String(field.key || String(field.label || '').trim().toLowerCase().replace(/[^\w]+/g, '_')),
    type: String(field.type || 'text').trim(),
    required: field.required === true,
    order: Math.max(1, Number(field.order) || 1),
    locked: field.locked === true
});
const DIRECTORY_CORE_FIELDS = [
    { id: 'core_name', label: 'Name', key: 'name', type: 'text', required: true, order: 1, locked: true },
    { id: 'core_role', label: 'Role', key: 'role', type: 'text', required: false, order: 2, locked: true },
    { id: 'core_photo', label: 'Photo', key: 'photo', type: 'text', required: false, order: 3, locked: true },
    { id: 'core_phone', label: 'Phone Number', key: 'phone', type: 'phone', required: false, order: 4, locked: true },
    { id: 'core_address', label: 'Address', key: 'address', type: 'textarea', required: false, order: 5, locked: true }
];
const ensureDefaultDirectoryFields = (fields = []) => {
    const incoming = (Array.isArray(fields) ? fields : []).map(normalizeDirectoryField);
    const byKey = new Map(incoming.map((field) => [field.key, field]));
    const merged = DIRECTORY_CORE_FIELDS.map((core) => normalizeDirectoryField({
        ...core,
        ...(byKey.get(core.key) || {}),
        required: core.key === 'name' ? true : Boolean(byKey.get(core.key)?.required || false),
        locked: true
    }));
    incoming.forEach((field) => {
        if (!DIRECTORY_CORE_FIELDS.some((core) => core.key === field.key)) merged.push(field);
    });
    return merged.sort((a, b) => a.order - b.order);
};
const normalizeDirectoryCategory = (category = {}) => ({
    id: String(category.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    name: String(category.name || '').trim(),
    order: Math.max(1, Number(category.order) || 1),
    showPublic: category.showPublic !== false,
    fields: ensureDefaultDirectoryFields(category.fields || [])
});
const normalizeCategoryAuthConfig = (payload = {}) => ({
    categories: payload && typeof payload.categories === 'object' && payload.categories !== null ? payload.categories : {}
});
const normalizePageAccessConfig = (payload = {}) => ({
    categories: payload && typeof payload.categories === 'object' && payload.categories !== null ? payload.categories : {},
    overrides: payload && typeof payload.overrides === 'object' && payload.overrides !== null ? payload.overrides : {}
});
const hashCredentialValue = async (rawValue = '') => {
    const value = String(rawValue || '');
    if (!value) return '';
    if (!(window.crypto?.subtle)) return value;
    const encoded = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const getCategoryAuthItem = (categoryId = '') => {
    const raw = categoryAuthConfig?.categories?.[categoryId] || {};
    return {
        enabled: raw.enabled === true,
        mode: raw.mode === 'mapped' ? 'mapped' : 'manual',
        targetPage: raw.targetPage === 'student' ? 'student' : 'collection',
        usernameField: String(raw.usernameField || ''),
        passwordField: String(raw.passwordField || '')
    };
};
const getPageAccessCategoryItem = (categoryId = '') => {
    const raw = pageAccessConfig?.categories?.[categoryId] || {};
    return {
        collection: raw.collection === true,
        student: raw.student === true
    };
};
const updateCategoryAuthConfig = async (nextConfig = {}) => {
    categoryAuthConfig = normalizeCategoryAuthConfig(nextConfig);
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig'), categoryAuthConfig, { merge: false });
};
const updatePageAccessConfig = async (nextConfig = {}) => {
    pageAccessConfig = normalizePageAccessConfig(nextConfig);
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), pageAccessConfig, { merge: false });
};
const getDirectoryCategories = () => (Array.isArray(webContent.directoryCategories) ? webContent.directoryCategories : []).map(normalizeDirectoryCategory).sort((a, b) => a.order - b.order);
const renderDirectoryCategoryOptions = () => {
    const categories = getDirectoryCategories();
    const optionHtml = categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)} (#${category.order})</option>`).join('');
    const selects = ['dir-field-category', 'dir-entry-category', 'dir-auth-category', 'dir-access-category', 'dir-override-category'];
    selects.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const prev = el.value;
        el.innerHTML = optionHtml || '<option value="">No categories</option>';
        el.value = categories.some((category) => category.id === prev) ? prev : (categories[0]?.id || '');
    });
};
const renderDirectoryAuthConfig = () => {
    const categoryId = document.getElementById('dir-auth-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const fieldOptions = (category?.fields || []).map((field) => `<option value="${field.key}">${escapeHtml(field.label)} (${escapeHtml(field.key)})</option>`).join('');
    const usernameFieldSel = document.getElementById('dir-auth-username-field');
    const passwordFieldSel = document.getElementById('dir-auth-password-field');
    if (usernameFieldSel) usernameFieldSel.innerHTML = `<option value="">-- Select Username Field --</option>${fieldOptions}`;
    if (passwordFieldSel) passwordFieldSel.innerHTML = `<option value="">-- Select Password Field --</option>${fieldOptions}`;
    const authConfig = getCategoryAuthItem(categoryId);
    const enabledEl = document.getElementById('dir-auth-enabled');
    const modeEl = document.getElementById('dir-auth-mode');
    const targetPageEl = document.getElementById('dir-auth-target-page');
    if (enabledEl) enabledEl.checked = authConfig.enabled;
    if (modeEl) modeEl.value = authConfig.mode;
    if (targetPageEl) targetPageEl.value = authConfig.targetPage;
    if (usernameFieldSel) usernameFieldSel.value = authConfig.usernameField;
    if (passwordFieldSel) passwordFieldSel.value = authConfig.passwordField;
};
const renderDirectoryAccessConfig = () => {
    const categoryId = document.getElementById('dir-access-category')?.value || '';
    const access = getPageAccessCategoryItem(categoryId);
    const collectionEl = document.getElementById('dir-access-collection');
    const studentEl = document.getElementById('dir-access-student');
    if (collectionEl) collectionEl.checked = access.collection;
    if (studentEl) studentEl.checked = access.student;
};
const renderOverrideEntryOptions = () => {
    const categoryId = document.getElementById('dir-override-category')?.value || '';
    const select = document.getElementById('dir-override-entry');
    if (!select) return;
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const rows = publicDirectoryEntries.filter((entry) => entry.categoryId === categoryId);
    const sortedFields = [...(category?.fields || [])].sort((a, b) => a.order - b.order);
    const displayField = sortedFields[0]?.key || '';
    select.innerHTML = rows.length
        ? rows.map((entry) => `<option value="${entry.id}">${escapeHtml(String(entry.values?.[displayField] || entry.id))}</option>`).join('')
        : '<option value="">No entries</option>';
    const selectedEntryId = select.value;
    const override = pageAccessConfig?.overrides?.[selectedEntryId] || {};
    document.getElementById('dir-override-blocked').checked = override.blocked === true;
    document.getElementById('dir-override-collection').checked = override.collection === true;
    document.getElementById('dir-override-student').checked = override.student === true;
};
const renderDirectoryFields = () => {
    const categoryId = document.getElementById('dir-field-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const list = document.getElementById('dir-fields-list');
    if (!list) return;
    if (!category) {
        list.innerHTML = '<p class="text-sm text-gray-500 italic">Select a category to manage fields.</p>';
        return;
    }
    list.innerHTML = category.fields.length
        ? category.fields.map((field) => `<div class="border border-indigo-100 rounded-xl p-3 bg-white shadow-sm flex items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="text-sm font-bold text-gray-800 truncate">${escapeHtml(field.label)}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">${field.locked ? 'Core Field' : 'Custom Field'}</div>
            </div>
            <button class="w-8 h-8 rounded-full border border-gray-200 hover:bg-gray-100 text-gray-600 dir-field-more-btn" data-category-id="${category.id}" data-field-id="${field.id}" title="Edit field">
                <i class="fas fa-ellipsis-v"></i>
            </button>
        </div>`).join('')
        : '<p class="text-sm text-gray-500 italic">No fields added yet.</p>';
};
const renderDirectoryEntryForm = () => {
    const categoryId = document.getElementById('dir-entry-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const form = document.getElementById('dir-entry-form');
    if (!form) return;
    if (!category) {
        form.innerHTML = '<p class="text-sm text-gray-500 italic">Select a category first.</p>';
        return;
    }
    const sortedFields = [...category.fields].sort((a, b) => a.order - b.order);
    const authConfig = getCategoryAuthItem(categoryId);
    const fieldsHtml = sortedFields.map((field) => {
        const base = `data-dir-field="${field.key}"`;
        if (field.type === 'textarea') {
            return `<label class="text-sm font-semibold text-gray-700">${escapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}<textarea ${base} class="w-full mt-1 p-2 border rounded-lg" rows="3"></textarea></label>`;
        }
        return `<label class="text-sm font-semibold text-gray-700">${escapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}<input ${base} type="${escapeHtml(field.type || 'text')}" class="w-full mt-1 p-2 border rounded-lg"></label>`;
    }).join('');
    const manualAuthHtml = authConfig.enabled && authConfig.mode === 'manual'
        ? `<label class="text-sm font-semibold text-gray-700">Username <span class="text-red-500">*</span><input data-dir-manual-username type="text" class="w-full mt-1 p-2 border rounded-lg"></label>
           <label class="text-sm font-semibold text-gray-700">Password <span class="text-red-500">*</span><input data-dir-manual-password type="password" class="w-full mt-1 p-2 border rounded-lg"></label>`
        : '';
    form.innerHTML = (fieldsHtml || '<p class="text-sm text-gray-500 italic">Add fields for this category first.</p>') + manualAuthHtml;
};
const renderDirectoryEntries = () => {
    const categoryId = document.getElementById('dir-entry-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const list = document.getElementById('dir-entries-list');
    if (!list) return;
    if (!category) {
        list.innerHTML = '';
        return;
    }
    const rows = publicDirectoryEntries
        .filter((entry) => entry.categoryId === categoryId)
        .sort((a, b) => {
            const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
            if (orderDiff !== 0) return orderDiff;
            return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        });
    list.innerHTML = rows.length
        ? `<h3 class="text-sm font-bold text-cyan-800 border-b border-cyan-200 pb-2 mb-2">Active ${escapeHtml(category.name || 'Category')}</h3>` + rows.map((entry) => {
            const displayName = String(entry.values?.name || 'Profile');
            const photoUrl = sanitizeUrl(String(entry.values?.photo || entry.values?.image || ''));
            const avatar = photoUrl
                ? `<img src="${photoUrl}" alt="${escapeHtml(displayName)}" class="w-14 h-14 rounded-full object-cover border-2 border-cyan-100">`
                : `<div class="w-14 h-14 rounded-full bg-cyan-100 text-cyan-700 font-bold flex items-center justify-center">${escapeHtml(displayName.charAt(0).toUpperCase())}</div>`;
            return `<div class="border border-cyan-200 rounded-2xl p-4 bg-white shadow-sm hover:shadow-md transition">
                <div class="flex justify-between items-center gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        ${avatar}
                        <div class="min-w-0">
                            <div class="text-base font-bold text-gray-900 truncate">${escapeHtml(displayName)}</div>
                            <div class="text-[11px] text-gray-500 mt-0.5">Entry ID: ${escapeHtml(entry.id || '--')}</div>
                        </div>
                    </div>
                    <button class="w-9 h-9 rounded-full border border-gray-200 hover:bg-gray-100 text-gray-600 dir-entry-more-btn" data-id="${entry.id}" title="Entry actions">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 italic">No entries added for this category.</p>';
};
const renderDirectoryCategories = () => {
    const categories = getDirectoryCategories();
    const list = document.getElementById('dir-categories-list');
    if (!list) return;
    list.innerHTML = categories.length
        ? categories.map((category) => `<div class="border border-emerald-200 rounded-2xl p-4 bg-white shadow-sm hover:shadow-md transition space-y-3">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <div class="text-xs font-bold uppercase tracking-widest text-emerald-600">Category Profile</div>
                    <div class="text-[11px] text-gray-500 mt-1">ID: ${escapeHtml(category.id || '--')}</div>
                </div>
                <span class="text-[11px] px-2.5 py-1 rounded-full border ${category.showPublic ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'}">${category.showPublic ? 'Public' : 'Hidden'}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-[2fr_auto_auto] gap-3 items-center">
                <input type="text" class="p-2 border rounded dir-cat-inline-name" data-id="${category.id}" value="${escapeHtml(category.name)}">
                <input type="number" min="1" class="p-2 border rounded w-full md:w-24 dir-cat-inline-order" data-id="${category.id}" value="${Number(category.order || 1)}">
                <label class="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" class="w-4 h-4 dir-cat-inline-public" data-id="${category.id}" ${category.showPublic ? 'checked' : ''}> Public</label>
            </div>
            <div class="flex justify-between items-center border-t pt-3">
                <div class="text-xs font-semibold text-gray-600">${category.fields.length} configured fields</div>
                <div class="flex flex-wrap gap-2">
                    <button class="px-3 py-1.5 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-bold dir-cat-inline-save-btn" data-id="${category.id}"><i class="fas fa-save mr-1"></i>Save</button>
                    <button class="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-700 border border-red-200 font-bold dir-cat-delete-btn" data-id="${category.id}"><i class="fas fa-trash mr-1"></i>Delete</button>
                </div>
            </div>
        </div>`).join('')
        : '<p class="text-sm text-gray-500 italic">No categories created yet.</p>';
    renderDirectoryCategoryOptions();
    renderDirectoryFields();
    renderDirectoryEntryForm();
    renderDirectoryEntries();
    renderDirectoryAuthConfig();
    renderDirectoryAccessConfig();
    renderOverrideEntryOptions();
    renderStaffTypeControls();
    if(!document.getElementById('manage-staff-page')?.classList.contains('hidden')) renderStaffList();
};
const updateDirectoryCategories = async (categories = []) => {
    webContent.directoryCategories = categories.map(normalizeDirectoryCategory);
    await updateWebContent();
    renderDirectoryCategories();
};
document.getElementById('dir-cat-add-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const name = document.getElementById('dir-cat-name')?.value?.trim() || '';
    const order = Number(document.getElementById('dir-cat-order')?.value || 1);
    const showPublic = document.getElementById('dir-cat-public')?.checked !== false;
    if (!name) return alert('Enter a category name.');
    const categories = getDirectoryCategories();
    categories.push(normalizeDirectoryCategory({ name, order, showPublic, fields: [] }));
    await updateDirectoryCategories(categories);
    document.getElementById('dir-cat-name').value = '';
});
document.getElementById('dir-categories-list')?.addEventListener('click', async (event) => {
    const saveBtn = event.target.closest('.dir-cat-inline-save-btn');
    const deleteBtn = event.target.closest('.dir-cat-delete-btn');
    const categories = getDirectoryCategories();
    if (saveBtn) {
        const category = categories.find((item) => item.id === saveBtn.dataset.id);
        if (!category) return;
        const name = String(document.querySelector(`.dir-cat-inline-name[data-id="${category.id}"]`)?.value || '').trim();
        const order = Number(document.querySelector(`.dir-cat-inline-order[data-id="${category.id}"]`)?.value || category.order || 1);
        const showPublic = document.querySelector(`.dir-cat-inline-public[data-id="${category.id}"]`)?.checked !== false;
        if (!name) return alert('Category name is required.');
        const next = categories.map((item) => item.id === category.id ? normalizeDirectoryCategory({ ...item, name, order, showPublic }) : item);
        await updateDirectoryCategories(next);
        return;
    }
    if (deleteBtn) {
        if (!confirm('Delete this category and its entries?')) return;
        const targetId = deleteBtn.dataset.id;
        const next = categories.filter((item) => item.id !== targetId);
        await updateDirectoryCategories(next);
        const deleteTargets = publicDirectoryEntries.filter((entry) => entry.categoryId === targetId);
        const reassignedStaff = allStaff.filter((staffMember) => staffMember.type === targetId);
        await Promise.all([
            ...deleteTargets.map((entry) => deleteDoc(doc(db, `${BASE_PATH}/publicDirectory`, entry.id))),
            ...reassignedStaff.map((staffMember) => updateDoc(doc(db, `${BASE_PATH}/staff`, staffMember.id), { type: 'Management' }))
        ]);
    }
});
document.getElementById('dir-field-category')?.addEventListener('change', () => { renderDirectoryFields(); });
document.getElementById('dir-entry-category')?.addEventListener('change', () => { renderDirectoryEntryForm(); renderDirectoryEntries(); });
document.getElementById('dir-field-add-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const categoryId = document.getElementById('dir-field-category')?.value || '';
    const label = document.getElementById('dir-field-label')?.value?.trim() || '';
    const type = document.getElementById('dir-field-type')?.value || 'text';
    const order = Number(document.getElementById('dir-field-order')?.value || 1);
    const required = document.getElementById('dir-field-required')?.checked === true;
    if (!categoryId || !label) return alert('Select category and enter field label.');
    const categories = getDirectoryCategories();
    const targetCategory = categories.find((item) => item.id === categoryId);
    if (!targetCategory) return alert('Category not found.');
    const draftField = normalizeDirectoryField({ label, type, order, required });
    if (targetCategory.fields.some((field) => field.key === draftField.key)) {
        return alert('Field key already exists in this category.');
    }
    const next = categories.map((category) => category.id === categoryId
        ? { ...category, fields: ensureDefaultDirectoryFields([...category.fields, draftField]) }
        : category);
    await updateDirectoryCategories(next);
    document.getElementById('dir-field-label').value = '';
});
document.getElementById('dir-fields-list')?.addEventListener('click', (event) => {
    const moreBtn = event.target.closest('.dir-field-more-btn');
    if (!moreBtn) return;
    const categories = getDirectoryCategories();
    const category = categories.find((item) => item.id === moreBtn.dataset.categoryId);
    const field = category?.fields.find((item) => item.id === moreBtn.dataset.fieldId);
    if (!category || !field) return;
    document.getElementById('dir-field-edit-category-id').value = category.id;
    document.getElementById('dir-field-edit-field-id').value = field.id;
    document.getElementById('dir-field-edit-label').value = field.label || '';
    document.getElementById('dir-field-edit-key').value = field.key || '';
    document.getElementById('dir-field-edit-type').value = field.type || 'text';
    document.getElementById('dir-field-edit-order').value = Number(field.order || 1);
    document.getElementById('dir-field-edit-required').checked = field.required === true;
    document.getElementById('dir-field-edit-key').readOnly = field.locked === true;
    document.getElementById('dir-field-edit-required').disabled = field.key === 'name';
    document.getElementById('dir-field-edit-delete').disabled = field.locked === true;
    document.getElementById('dir-field-edit-popup')?.classList.remove('hidden');
    document.getElementById('dir-field-edit-popup')?.classList.add('flex');
});
document.getElementById('dir-field-edit-cancel')?.addEventListener('click', () => {
    document.getElementById('dir-field-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-field-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-field-edit-save')?.addEventListener('click', async () => {
    const categoryId = document.getElementById('dir-field-edit-category-id')?.value || '';
    const fieldId = document.getElementById('dir-field-edit-field-id')?.value || '';
    const categories = getDirectoryCategories();
    const category = categories.find((item) => item.id === categoryId);
    const field = category?.fields.find((item) => item.id === fieldId);
    if (!category || !field) return;
    const label = String(document.getElementById('dir-field-edit-label')?.value || '').trim();
    const key = String(document.getElementById('dir-field-edit-key')?.value || '').trim().toLowerCase();
    const type = String(document.getElementById('dir-field-edit-type')?.value || 'text').trim();
    const order = Number(document.getElementById('dir-field-edit-order')?.value || field.order || 1);
    const required = document.getElementById('dir-field-edit-required')?.checked === true;
    if (!label) return alert('Field label is required.');
    if (!key) return alert('Field key is required.');
    if (field.locked && key !== field.key) return alert('Core field key cannot be changed.');
    if (category.fields.some((item) => item.id !== field.id && item.key === key)) return alert('Field key must be unique.');
    const next = categories.map((item) => item.id === category.id ? {
        ...item,
        fields: ensureDefaultDirectoryFields(item.fields.map((row) => row.id === field.id
            ? normalizeDirectoryField({ ...row, label, key, type, order, required: row.key === 'name' ? true : required, locked: row.locked === true })
            : row))
    } : item);
    await updateDirectoryCategories(next);
    document.getElementById('dir-field-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-field-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-field-edit-delete')?.addEventListener('click', async () => {
    const categoryId = document.getElementById('dir-field-edit-category-id')?.value || '';
    const fieldId = document.getElementById('dir-field-edit-field-id')?.value || '';
    const categories = getDirectoryCategories();
    const category = categories.find((item) => item.id === categoryId);
    const field = category?.fields.find((item) => item.id === fieldId);
    if (!category || !field) return;
    if (field.locked) return alert('Core fields cannot be deleted.');
    if (!confirm('Delete this field from category?')) return;
    const next = categories.map((item) => item.id === category.id ? { ...item, fields: item.fields.filter((row) => row.id !== fieldId) } : item);
    await updateDirectoryCategories(next);
    document.getElementById('dir-field-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-field-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-entry-save-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const categoryId = document.getElementById('dir-entry-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    if (!category) return alert('Select category.');
    const authConfig = getCategoryAuthItem(categoryId);
    const values = {};
    let missingRequired = false;
    category.fields.forEach((field) => {
        const input = document.querySelector(`[data-dir-field="${field.key}"]`);
        const value = String(input?.value || '').trim();
        values[field.key] = value;
        if (field.required && !value) missingRequired = true;
    });
    if (missingRequired) return alert('Please fill all required fields.');
    let authMeta = {};
    if (authConfig.enabled) {
        if (authConfig.mode === 'manual') {
            const username = String(document.querySelector('[data-dir-manual-username]')?.value || '').trim();
            const password = String(document.querySelector('[data-dir-manual-password]')?.value || '').trim();
            if (!username || !password) return alert('Manual mode requires username and password.');
            authMeta = {
                username: username.toLowerCase(),
                usernameRaw: username,
                passwordHash: await hashCredentialValue(password)
            };
        } else {
            const username = String(values?.[authConfig.usernameField] || '').trim();
            const password = String(values?.[authConfig.passwordField] || '').trim();
            if (!username || !password) return alert('Mapped mode requires valid username/password field values.');
            authMeta = {
                username: username.toLowerCase(),
                usernameRaw: username,
                passwordHash: await hashCredentialValue(password)
            };
        }
    }
    await addDoc(collection(db, `${BASE_PATH}/publicDirectory`), {
        categoryId,
        values,
        displayOrder: Math.max(1, Number(document.getElementById('dir-entry-order')?.value || 999)),
        authMeta,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
    document.getElementById('dir-entry-order').value = '999';
    renderDirectoryEntryForm();
});
document.getElementById('dir-entries-list')?.addEventListener('click', (event) => {
    const moreBtn = event.target.closest('.dir-entry-more-btn');
    if (!moreBtn) return;
    const categoryId = document.getElementById('dir-entry-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    const entry = publicDirectoryEntries.find((item) => item.id === moreBtn.dataset.id);
    if (!category || !entry) return;
    document.getElementById('dir-entry-edit-id').value = entry.id;
    document.getElementById('dir-entry-edit-order').value = Math.max(1, Number(entry.displayOrder || 999));
    const host = document.getElementById('dir-entry-edit-form');
    host.innerHTML = category.fields.map((field) => {
        const value = String(entry.values?.[field.key] ?? '');
        if (field.type === 'textarea') {
            return `<label class="text-sm font-semibold text-gray-700 md:col-span-2">${escapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}<textarea class="w-full mt-1 p-2 border rounded-lg dir-entry-popup-field" rows="3" data-key="${field.key}" data-type="${field.type}">${escapeHtml(value)}</textarea></label>`;
        }
        return `<label class="text-sm font-semibold text-gray-700">${escapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}<input type="${escapeHtml(field.type || 'text')}" class="w-full mt-1 p-2 border rounded-lg dir-entry-popup-field" data-key="${field.key}" data-type="${field.type}" value="${escapeHtml(value)}"></label>`;
    }).join('');
    document.getElementById('dir-entry-edit-popup')?.classList.remove('hidden');
    document.getElementById('dir-entry-edit-popup')?.classList.add('flex');
});
document.getElementById('dir-entry-edit-cancel')?.addEventListener('click', () => {
    document.getElementById('dir-entry-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-entry-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-entry-edit-save')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const entryId = document.getElementById('dir-entry-edit-id')?.value || '';
    const categoryId = document.getElementById('dir-entry-category')?.value || '';
    const category = getDirectoryCategories().find((item) => item.id === categoryId);
    if (!entryId || !category) return;
    const authConfig = getCategoryAuthItem(categoryId);
    const values = {};
    let missingRequired = false;
    category.fields.forEach((field) => {
        const input = document.querySelector(`.dir-entry-popup-field[data-key="${field.key}"]`);
        const value = String(input?.value || '').trim();
        values[field.key] = value;
        if (field.required && !value) missingRequired = true;
    });
    if (missingRequired) return alert('Please fill all required fields.');
    const targetEntry = publicDirectoryEntries.find((entry) => entry.id === entryId) || {};
    let authMeta = targetEntry.authMeta && typeof targetEntry.authMeta === 'object' ? targetEntry.authMeta : {};
    if (authConfig.enabled && authConfig.mode === 'mapped') {
        const username = String(values?.[authConfig.usernameField] || '').trim();
        const password = String(values?.[authConfig.passwordField] || '').trim();
        if (!username || !password) return alert('Mapped mode requires valid username/password field values.');
        authMeta = { username: username.toLowerCase(), usernameRaw: username, passwordHash: await hashCredentialValue(password) };
    }
    await updateDoc(doc(db, `${BASE_PATH}/publicDirectory`, entryId), {
        values,
        displayOrder: Math.max(1, Number(document.getElementById('dir-entry-edit-order')?.value || 999)),
        authMeta,
        updatedAt: Date.now()
    });
    document.getElementById('dir-entry-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-entry-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-entry-edit-delete')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const entryId = document.getElementById('dir-entry-edit-id')?.value || '';
    if (!entryId) return;
    if (!confirm('Delete this entry?')) return;
    await deleteDoc(doc(db, `${BASE_PATH}/publicDirectory`, entryId));
    document.getElementById('dir-entry-edit-popup')?.classList.add('hidden');
    document.getElementById('dir-entry-edit-popup')?.classList.remove('flex');
});
document.getElementById('dir-auth-category')?.addEventListener('change', renderDirectoryAuthConfig);
document.getElementById('dir-access-category')?.addEventListener('change', renderDirectoryAccessConfig);
document.getElementById('dir-override-category')?.addEventListener('change', renderOverrideEntryOptions);
document.getElementById('dir-override-entry')?.addEventListener('change', renderOverrideEntryOptions);
document.getElementById('dir-auth-save-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const categoryId = document.getElementById('dir-auth-category')?.value || '';
    if (!categoryId) return alert('Select category.');
    const enabled = document.getElementById('dir-auth-enabled').checked;
    const mode = document.getElementById('dir-auth-mode').value === 'mapped' ? 'mapped' : 'manual';
    const targetPage = document.getElementById('dir-auth-target-page').value === 'student' ? 'student' : 'collection';
    const usernameField = document.getElementById('dir-auth-username-field').value;
    const passwordField = document.getElementById('dir-auth-password-field').value;
    if (enabled && mode === 'mapped' && (!usernameField || !passwordField)) {
        return alert('Mapped mode requires username/password field selection.');
    }
    const next = {
        ...categoryAuthConfig,
        categories: {
            ...(categoryAuthConfig.categories || {}),
            [categoryId]: { enabled, mode, targetPage, usernameField, passwordField }
        }
    };
    await updateCategoryAuthConfig(next);
    await logAuditEvent({ category: 'security', action: 'category.auth.save', entityType: 'categoryAuth', entityId: categoryId, message: 'Category login setup updated.' });
    alert('Category login setup saved.');
});
document.getElementById('dir-access-save-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const categoryId = document.getElementById('dir-access-category')?.value || '';
    if (!categoryId) return alert('Select category.');
    const collection = document.getElementById('dir-access-collection').checked;
    const student = document.getElementById('dir-access-student').checked;
    const next = {
        ...pageAccessConfig,
        categories: {
            ...(pageAccessConfig.categories || {}),
            [categoryId]: { collection, student }
        }
    };
    await updatePageAccessConfig(next);
    await logAuditEvent({ category: 'security', action: 'page.access.category.save', entityType: 'pageAccess', entityId: categoryId, message: 'Category default page access updated.' });
    alert('Category page access saved.');
});
document.getElementById('dir-override-save-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const entryId = document.getElementById('dir-override-entry')?.value || '';
    if (!entryId) return alert('Select an entry.');
    const blocked = document.getElementById('dir-override-blocked').checked;
    const collection = document.getElementById('dir-override-collection').checked;
    const student = document.getElementById('dir-override-student').checked;
    const next = {
        ...pageAccessConfig,
        overrides: {
            ...(pageAccessConfig.overrides || {}),
            [entryId]: { blocked, collection, student }
        }
    };
    await updatePageAccessConfig(next);
    await logAuditEvent({ category: 'security', action: 'page.access.override.save', entityType: 'pageAccessOverride', entityId: entryId, message: 'Entry level page access override saved.' });
    alert('Override saved.');
});
document.getElementById('dir-override-clear-btn')?.addEventListener('click', async () => {
    if(!requirePermission('website.manage')) return;
    const entryId = document.getElementById('dir-override-entry')?.value || '';
    if (!entryId) return alert('Select an entry.');
    const nextOverrides = { ...(pageAccessConfig.overrides || {}) };
    delete nextOverrides[entryId];
    await updatePageAccessConfig({ ...pageAccessConfig, overrides: nextOverrides });
    renderOverrideEntryOptions();
    await logAuditEvent({ category: 'security', action: 'page.access.override.clear', entityType: 'pageAccessOverride', entityId: entryId, message: 'Entry level page access override cleared.' });
    alert('Override cleared.');
});

// --- 11. SECURITY SETTINGS ---
document.getElementById('save-admin-auth-btn').addEventListener('click', async () => {
    if(!requirePermission('security.manage')) return;
    const currentAccount = getCurrentAdminAccount();
    if (!currentAccount?.email) return alert('Current admin account is not available.');
    if(!confirm('Sync the current signed-in account as the primary legacy admin email?')) return;
    const nextAdmins = normalizeAdminAccounts(adminAccounts, currentAccount.email);
    await setDoc(getAdminAuthRef(), buildAdminAuthPayload(currentAccount.email, nextAdmins), {merge: true});
    await logAuditEvent({ category: 'security', action: 'admin.legacy.sync', entityType: 'settings', entityId: 'adminAuth', message: `Legacy admin email synced to ${currentAccount.email}.` });
    alert('Legacy admin email synced successfully.');
});
document.getElementById('update-admin-credentials-btn')?.addEventListener('click', async () => {
    if(!requirePermission('security.manage')) return;
    const currentPassword = document.getElementById('admin-cred-current-password')?.value?.trim() || '';
    const requestedEmail = document.getElementById('admin-cred-new-email')?.value?.trim() || '';
    const requestedPassword = document.getElementById('admin-cred-new-password')?.value || '';
    if (!currentPassword) return alert('Current password is required.');
    if (!requestedEmail && !requestedPassword) return alert('Enter a new email or a new password.');
    if (requestedPassword && requestedPassword.length < 6) return alert('New password must be at least 6 characters.');
    const authUser = auth.currentUser;
    if (!authUser?.email) return alert('Authenticated admin account not found. Please log in again.');

    const oldEmail = normalizeEmail(authUser.email);
    const nextEmail = normalizeEmail(requestedEmail || oldEmail);
    const changedEmail = nextEmail !== oldEmail;
    const changedPassword = Boolean(requestedPassword);
    if(!confirm(`Update current admin login credentials?\n${changedEmail ? `Email: ${oldEmail} -> ${nextEmail}` : 'Email: No change'}\n${changedPassword ? 'Password: Will be updated' : 'Password: No change'}`)) return;

    try {
        const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
        await reauthenticateWithCredential(authUser, credential);
        if (changedEmail) await updateEmail(authUser, nextEmail);
        if (changedPassword) await updatePassword(authUser, requestedPassword);

        if (changedEmail) {
            const adminRef = getAdminAuthRef();
            const adminSnap = await getDoc(adminRef);
            const adminData = adminSnap.exists() ? adminSnap.data() : {};
            const legacyEmail = normalizeEmail(adminData.email || oldEmail);
            const sourceAdmins = SINGLE_ADMIN_MODE
                ? normalizeAdminAccounts([], legacyEmail)
                : normalizeAdminAccounts(adminData.admins || [], legacyEmail);
            let hasUpdatedCurrent = false;
            const nextAdmins = sourceAdmins.map((account) => {
                if (normalizeEmail(account.email) !== oldEmail) return account;
                hasUpdatedCurrent = true;
                return { ...account, email: nextEmail, updatedAt: new Date().toISOString(), isActive: true };
            });
            if (!hasUpdatedCurrent) {
                nextAdmins.push({
                    name: authUser.displayName || 'Admin',
                    email: nextEmail,
                    role: currentAdminRole || 'super_admin',
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
            const nextLegacyEmail = legacyEmail === oldEmail ? nextEmail : legacyEmail;
            await setDoc(adminRef, buildAdminAuthPayload(nextLegacyEmail, nextAdmins), { merge: true });
            currentAdminEmail = nextEmail;
        }

        await logAuditEvent({
            category: 'security',
            action: 'admin.credentials.update',
            entityType: 'admin',
            entityId: currentAdminEmail || oldEmail,
            message: `Current admin login updated (${changedEmail ? 'email' : ''}${changedEmail && changedPassword ? ' + ' : ''}${changedPassword ? 'password' : ''}).`
        });
        ['admin-cred-current-password', 'admin-cred-new-email', 'admin-cred-new-password'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        renderSessionMonitor();
        alert('Admin login credentials updated successfully.');
    } catch (error) {
        console.error('Failed to update admin login credentials.', error);
        alert(`Credential update failed: ${error?.message || 'Please verify current password and try again.'}`);
    }
});
document.getElementById('add-admin-role-btn')?.addEventListener('click', async () => {
    if(!requirePermission('security.manage')) return;
    alert('Only one Super Admin is allowed. Use "Update Current Admin Login" to change email/password.');
});
document.getElementById('admin-role-list')?.addEventListener('click', async (e) => {
    if(!requirePermission('security.manage')) return;
    const trigger = e.target.closest('.admin-role-toggle-btn, .admin-role-delete-btn');
    if (!trigger) return;
    alert('Only one Super Admin is allowed in this setup.');
});
document.getElementById('refresh-session-monitor-btn').addEventListener('click', renderSessionMonitor);
document.getElementById('security-settings-page')?.addEventListener('click', async (event) => {
    const moreBtn = event.target.closest('.session-action-more-btn');
    if (moreBtn) {
        const deviceId = moreBtn.dataset.deviceId || '';
        document.querySelectorAll('.session-action-menu').forEach((menu) => {
            if (menu.dataset.deviceId !== deviceId) menu.classList.add('hidden');
        });
        const menu = document.querySelector(`.session-action-menu[data-device-id="${deviceId}"]`);
        if (menu) menu.classList.toggle('hidden');
        return;
    }
    const actionBtn = event.target.closest('.session-action-btn');
    if (!actionBtn) return;
    if(!requirePermission('security.manage')) return;
    const deviceId = actionBtn.dataset.deviceId || '';
    const action = actionBtn.dataset.action || '';
    if (!deviceId || !action) return;
    if (action === 'force-logout') {
        await updateSessionRegistryEntry(deviceId, { forcedLogoutAt: new Date().toISOString(), forceLogout: true });
    }
    if (action === 'block') {
        await updateSessionRegistryEntry(deviceId, { isBlocked: true, forceLogout: true, forcedLogoutAt: new Date().toISOString() });
    }
    if (action === 'unblock') {
        await updateSessionRegistryEntry(deviceId, { isBlocked: false });
    }
    renderSessionMonitor();
});
document.getElementById('logout-current-admin-btn').addEventListener('click', () => window.logoutAdmin());
document.getElementById('force-logout-btn').addEventListener('click', async () => {
    if(!requirePermission('security.manage')) return;
    if(!confirm('Force all staff/admin sessions to sign in again? This will also affect your current session.')) return;
    const payload = { lastForcedLogoutAt: new Date().toISOString(), forcedBy: currentAdminEmail, message: 'A security action ended your session. Please sign in again.' };
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'sessionControl'), payload, { merge: true });
    await logAuditEvent({ category: 'security', action: 'session.force_logout', entityType: 'settings', entityId: 'sessionControl', message: 'Global force logout triggered for staff/admin sessions.' });
});
document.getElementById('backup-export-btn').addEventListener('click', async () => {
    if(!requirePermission('backup.export')) return;
    const payload = await buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fee-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await logAuditEvent({ category: 'backup', action: 'backup.export', entityType: 'backup', message: 'JSON backup exported from admin panel.' });
});
document.getElementById('restore-file-input').addEventListener('change', async (e) => {
    if(!requirePermission('backup.restore')) return;
    const file = e.target.files?.[0];
    const runRestoreBtn = document.getElementById('run-restore-btn');
    if (!file) return;
    const textPayload = await file.text();
    try {
        const parsedPayload = JSON.parse(textPayload);
        const validation = validateBackupPayload(parsedPayload);
        if (!validation.valid) {
            pendingRestorePayload = null;
            document.getElementById('restore-preview').classList.add('hidden');
            if (runRestoreBtn) runRestoreBtn.disabled = true;
            return alert(`Invalid backup file: ${validation.reason}`);
        }

        pendingRestorePayload = parsedPayload;
        document.getElementById('restore-preview').classList.remove('hidden');
        document.getElementById('restore-preview-meta').textContent = `Backup date: ${formatDateTime(pendingRestorePayload.exportedAt)} • Source: ${pendingRestorePayload.institution || BASE_PATH}`;
        document.getElementById('restore-preview-counts').textContent = summarizeBackupCounts(pendingRestorePayload);
        if (runRestoreBtn) runRestoreBtn.disabled = false;
    } catch (error) {
        console.error(error);
        pendingRestorePayload = null;
        document.getElementById('restore-preview').classList.add('hidden');
        if (runRestoreBtn) runRestoreBtn.disabled = true;
        alert('Invalid backup file. Please choose a valid JSON export.');
    }
});
const runRestoreBtn = document.getElementById('run-restore-btn');
if (runRestoreBtn) runRestoreBtn.disabled = true;

document.getElementById('run-restore-btn').addEventListener('click', async () => {
    if(!requirePermission('backup.restore')) return;
    if (!pendingRestorePayload) return alert('Select a backup file first.');
    const validation = validateBackupPayload(pendingRestorePayload);
    if (!validation.valid) return alert(`Selected backup is invalid: ${validation.reason}`);
    if(!confirm('This will replace current data with the selected backup snapshot. Continue?')) return;
    await restoreFromBackupPayload(pendingRestorePayload);
    await logAuditEvent({ category: 'backup', action: 'backup.restore', entityType: 'backup', message: 'Backup restore completed from selected JSON payload.', metadata: { exportedAt: pendingRestorePayload.exportedAt || '' } });
    pendingRestorePayload = null;
    document.getElementById('restore-preview').classList.add('hidden');
    document.getElementById('restore-file-input').value = '';
    const runRestoreBtn = document.getElementById('run-restore-btn');
    if (runRestoreBtn) runRestoreBtn.disabled = true;
    alert('Backup restore completed.');
});
document.getElementById('audit-filter-action').addEventListener('change', renderAuditLogList);
document.getElementById('audit-search-input').addEventListener('input', renderAuditLogList);
document.getElementById('audit-log-list').addEventListener('click', (event) => {
    const targetBtn = event.target.closest('.audit-open-target-btn');
    if (!targetBtn) return;
    const target = targetBtn.dataset.target;
    if (!target) return;
    activateAdminPage(target, { suppressDeniedAlert: false });
});

document.getElementById('add-academic-year-btn').addEventListener('click', async () => {
    if(!requirePermission('academic-years.manage')) return;
    const labelRaw = document.getElementById('academic-year-preset-select')?.value || '';
    const status = document.getElementById('academic-year-status').value;
    const startMonth = Number(document.getElementById('academic-year-start-month')?.value ?? 5);
    const endMonth = Number(document.getElementById('academic-year-end-month')?.value ?? 4);
    const label = sanitizeAcademicYearLabel(labelRaw);
    const [startYear = 0, endYear = 0] = label.split('-').map(Number);

    if (!label || !startYear || !endYear) return alert('Select a valid academic year from the dropdown.');
    const existing = academicYears.find((year) => year.label === label);
    if (existing) return alert('This academic year is already configured. Use the 3-dot menu in the year card to edit it.');
    academicYears.push({
        label,
        startYear: Number(startYear),
        endYear: Number(endYear),
        startMonth: Number.isFinite(startMonth) ? startMonth : 5,
        endMonth: Number.isFinite(endMonth) ? endMonth : 4,
        status,
        classes: getDefaultClassLadder()
    });

    if (status === 'active' || !activeAcademicYear) activeAcademicYear = label;
    await persistAcademicYears();
    await logAuditEvent({ category: 'security', action: 'academic-year.create', entityType: 'academicYear', entityId: label, message: `Academic year created: ${label}.` });
    populateAcademicYearPresetSelector();
    document.getElementById('academic-year-status').value = 'active';
    const startMonthSelect = document.getElementById('academic-year-start-month');
    const endMonthSelect = document.getElementById('academic-year-end-month');
    if (startMonthSelect) startMonthSelect.value = '5';
    if (endMonthSelect) endMonthSelect.value = '4';
});
document.getElementById('academic-year-preset-select')?.addEventListener('change', (event) => {
    const selectedLabel = sanitizeAcademicYearLabel(event.target.value || '');
    const selectedYear = academicYears.find((year) => year.label === selectedLabel);
    const startMonthSelect = document.getElementById('academic-year-start-month');
    const endMonthSelect = document.getElementById('academic-year-end-month');
    const statusSelect = document.getElementById('academic-year-status');
    if (startMonthSelect) startMonthSelect.value = String(selectedYear?.startMonth ?? 5);
    if (endMonthSelect) endMonthSelect.value = String(selectedYear?.endMonth ?? 4);
    if (statusSelect) statusSelect.value = selectedYear?.status || (selectedLabel === getActiveAcademicYearLabel() ? 'active' : 'planning');
});

document.getElementById('academic-years-list').addEventListener('click', async (e) => {
    const activateBtn = e.target.closest('.set-active-year-btn');
    const archiveBtn = e.target.closest('.archive-year-btn');
    const menuToggleBtn = e.target.closest('.year-menu-toggle');
    const editBtn = e.target.closest('.year-edit-btn');
    const deleteBtn = e.target.closest('.year-delete-btn');

    if (menuToggleBtn) {
        const holder = menuToggleBtn.closest('.relative');
        document.querySelectorAll('#academic-years-list .year-menu').forEach((menu) => {
            if (!holder || menu !== holder.querySelector('.year-menu')) menu.classList.add('hidden');
        });
        holder?.querySelector('.year-menu')?.classList.toggle('hidden');
        return;
    }

    if (editBtn) {
        if(!requirePermission('academic-years.manage')) return;
        openAcademicYearEditPopup(editBtn.dataset.label || '');
        return;
    }

    if (deleteBtn) {
        if(!requirePermission('academic-years.manage')) return;
        const label = deleteBtn.dataset.label;
        if (label === activeAcademicYear) return alert('Active academic year cannot be deleted.');
        const studentsInYear = rawStudents.filter((student) => (student.academicYear || '') === label).length;
        if (studentsInYear > 0) return alert('Cannot delete academic year with student records. Archive it instead.');
        if (!confirm(`Delete academic year ${label}? This cannot be undone.`)) return;
        academicYears = academicYears.filter((year) => year.label !== label);
        await persistAcademicYears();
        await logAuditEvent({ category: 'security', action: 'academic-year.delete', entityType: 'academicYear', entityId: label, message: `Academic year deleted: ${label}.` });
        return;
    }

    if (activateBtn) {
        if(!requirePermission('academic-years.manage')) return;
        activeAcademicYear = activateBtn.dataset.label;
        academicYears = academicYears.map((year) => ({
            ...year,
            status: year.label === activeAcademicYear ? 'active' : (year.status === 'active' ? 'planning' : year.status)
        }));
        await persistAcademicYears();
        await logAuditEvent({ category: 'security', action: 'academic-year.activate', entityType: 'academicYear', entityId: activeAcademicYear, message: `Academic year activated: ${activeAcademicYear}.` });
        return;
    }

    if (archiveBtn) {
        if(!requirePermission('academic-years.manage')) return;
        const label = archiveBtn.dataset.label;
        if (label === activeAcademicYear) return alert('Set another academic year as active before archiving this one.');
        academicYears = academicYears.map((year) => year.label === label ? { ...year, status: 'archived' } : year);
        await persistAcademicYears();
        await logAuditEvent({ category: 'security', action: 'academic-year.archive', entityType: 'academicYear', entityId: label, message: `Academic year archived: ${label}.` });
    }
});
document.getElementById('academic-year-edit-cancel')?.addEventListener('click', closeAcademicYearEditPopup);
document.getElementById('academic-year-edit-save')?.addEventListener('click', async () => {
    if(!requirePermission('academic-years.manage')) return;
    const label = document.getElementById('academic-year-edit-target-label')?.value || '';
    if (!label) return;
    const normalizedStatus = String(document.getElementById('academic-year-edit-status')?.value || 'planning').trim().toLowerCase();
    const startMonth = Number(document.getElementById('academic-year-edit-start-month')?.value ?? 5);
    const endMonth = Number(document.getElementById('academic-year-edit-end-month')?.value ?? 4);
    if (!['active', 'planning', 'archived'].includes(normalizedStatus)) return alert('Status must be active, planning, or archived.');
    if (!Number.isInteger(startMonth) || startMonth < 0 || startMonth > 11 || !Number.isInteger(endMonth) || endMonth < 0 || endMonth > 11) return alert('Start/End month must be between 0 and 11.');
    if (label === activeAcademicYear && normalizedStatus === 'archived') return alert('Active year cannot be archived. Activate another year first.');

    academicYears = academicYears.map((year) => year.label === label ? { ...year, status: normalizedStatus, startMonth, endMonth } : year);
    if (normalizedStatus === 'active') {
        activeAcademicYear = label;
        academicYears = academicYears.map((year) => ({
            ...year,
            status: year.label === activeAcademicYear ? 'active' : (year.status === 'active' ? 'planning' : year.status)
        }));
    }
    await persistAcademicYears();
    await logAuditEvent({ category: 'security', action: 'academic-year.update', entityType: 'academicYear', entityId: label, message: `Academic year updated: ${label}.` });
    closeAcademicYearEditPopup();
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('#academic-years-list .relative')) {
        document.querySelectorAll('#academic-years-list .year-menu').forEach((menu) => menu.classList.add('hidden'));
    }
});
populateAcademicMonthSelectors();
populateAcademicYearPresetSelector();

// --- AUTH & FIREBASE INIT ---
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const requestedTab = (window.location.hash || '#dashboard').replace('#', '') || 'dashboard';
    if (requestedTab === 'results') {
        window.location.replace('result.html?from=admin');
        return;
    }
    window.AppSession?.touchSession();

    try {
        const adminRef = getAdminAuthRef();
        const snap = await getDoc(adminRef);
        currentAdminEmail = normalizeEmail(user.email || '');
        const legacyEmail = normalizeEmail(snap.exists() ? snap.data().email : 'admin@institute.com');
        const availableAdmins = SINGLE_ADMIN_MODE ? normalizeAdminAccounts([], legacyEmail) : normalizeAdminAccounts(snap.exists() ? snap.data().admins || [] : [], legacyEmail);
        const matchingAdmin = availableAdmins.find((account) => account.email === currentAdminEmail && account.isActive);
        const wantsResultsTab = false;

        if (!matchingAdmin) {
            if (!wantsResultsTab) {
                alert("അനധികൃത പ്രവേശനം! നിങ്ങൾക്കീ പേജിൽ പ്രവേശിക്കാൻ അനുമതിയില്ല.");
                await window.AppSession?.clearAll({ purgeClientData: true });
                await signOut(auth);
                window.location.href = 'index.html';
                return;
            }
            const staffSnap = await getDocs(query(collection(db, `${BASE_PATH}/staff`), where('email', '==', currentAdminEmail)));
            const staffRow = staffSnap.docs[0]?.data() || null;
            if (!staffRow || staffRow.isActive === false || staffRow.canManageResults !== true) {
                alert("Result page access denied. Ask admin to enable your staff/collection access.");
                await window.AppSession?.clearAll({ purgeClientData: true });
                await signOut(auth);
                window.location.href = 'index.html';
                return;
            }
            isResultOperatorSession = true;
            currentAdminRole = 'result_operator';
            window.AppSession?.startStaff(staffRow.name || 'Result Operator', currentAdminEmail);
        } else {
            currentAdminRole = matchingAdmin.role || 'super_admin';
            window.AppSession?.startAdmin();
        }

        document.getElementById('auth-loader').style.display = 'none';
        document.getElementById('admin-app').style.display = 'block';
        applyRoleAccessUI();
        ensureActiveAdminPageAccess();
        enforceResultOperatorModeUI();
        renderSessionMonitor();

        if (!snap.exists()) {
            const seedAdmins = availableAdmins.length ? availableAdmins : [{ name: 'Master Admin', email: currentAdminEmail || 'admin@institute.com', role: 'super_admin', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
            await setDoc(adminRef, buildAdminAuthPayload(currentAdminEmail || 'admin@institute.com', seedAdmins), { merge: true });
        }

        const configRef = doc(db, `${BASE_PATH}/settings`, 'config');
        const academicYearsRef = doc(db, `${BASE_PATH}/settings`, 'academicYears');
        const sessionControlRef = doc(db, `${BASE_PATH}/settings`, 'sessionControl');
        const sessionRegistryRef = getSessionRegistryRef();

        onSnapshot(adminRef, (adminSnap) => {
            const adminData = adminSnap.exists() ? adminSnap.data() : {};
            adminAccounts = SINGLE_ADMIN_MODE ? normalizeAdminAccounts([], normalizeEmail(adminData.email || currentAdminEmail)) : normalizeAdminAccounts(adminData.admins || [], normalizeEmail(adminData.email || currentAdminEmail));
            const currentAccount = adminAccounts.find((account) => account.email === currentAdminEmail && account.isActive);
            if (!currentAccount) {
                if (isResultOperatorSession) {
                    currentAdminRole = 'result_operator';
                    applyRoleAccessUI();
                    ensureActiveAdminPageAccess();
                    enforceResultOperatorModeUI();
                    return;
                }
                alert('Your admin access was removed or disabled. Please sign in again.');
                window.logoutAdmin();
                return;
            }
            currentAdminRole = currentAccount.role || 'super_admin';
            const canAccessAdminPanel = currentAdminRole === 'super_admin' || currentAdminRole === 'result_operator' || hasPermission('results.manage');
            if (!canAccessAdminPanel) {
                if (!hasRedirectedNonSuperAdmin) {
                    hasRedirectedNonSuperAdmin = true;
                    alert('Admin panel access is restricted. Redirecting to Collection panel.');
                    window.location.href = 'collection.html';
                }
                return;
            }
            applyRoleAccessUI();
            ensureActiveAdminPageAccess();
            renderAdminRoleList();
            renderDashboard();
            startSessionRegistryHeartbeat();
        });
        onSnapshot(sessionControlRef, (sessionSnap) => {
            sessionControl = sessionSnap.exists() ? sessionSnap.data() : {};
            renderSessionMonitor();
            const startedAt = window.AppSession?.getStartedAt?.() || 0;
            const forcedAt = sessionControl?.lastForcedLogoutAt ? new Date(sessionControl.lastForcedLogoutAt).getTime() : 0;
            if (forcedAt && startedAt && forcedAt > startedAt) {
                alert(sessionControl.message || 'An administrator ended this session. Please sign in again.');
                window.logoutAdmin();
            }
        });
        onSnapshot(sessionRegistryRef, (sessionRegistrySnap) => {
            sessionRegistry = sessionRegistrySnap.exists() ? sessionRegistrySnap.data() : { sessions: {} };
            renderSessionMonitor();
        });
        onSnapshot(collection(db, `${BASE_PATH}/auditLogs`), (auditSnap) => {
            auditLogs = auditSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            renderAuditLogList();
            renderDashboard();
        });

        onSnapshot(academicYearsRef, async (academicSnap) => {
            if (!academicSnap.exists()) {
                academicYears = [{
                    label: currentAcademicYear,
                    startYear: parseInt(currentAcademicYear.split('-')[0], 10),
                    endYear: parseInt(currentAcademicYear.split('-')[1], 10),
                    startMonth: 5,
                    endMonth: 4,
                    status: 'active',
                    classes: getDefaultClassLadder()
                }];
                activeAcademicYear = currentAcademicYear;
                await persistAcademicYears();
                renderAcademicYears();
                refreshAcademicYearScopedData();
                return;
            }

            const data = academicSnap.data();
            academicYears = Array.isArray(data.years) && data.years.length ? data.years : [{
                label: currentAcademicYear,
                startYear: parseInt(currentAcademicYear.split('-')[0], 10),
                endYear: parseInt(currentAcademicYear.split('-')[1], 10),
                startMonth: 5,
                endMonth: 4,
                status: 'active',
                classes: getDefaultClassLadder()
            }];
            academicYears = academicYears.map((year) => ({
                ...year,
                label: sanitizeAcademicYearLabel(year.label || `${year.startYear}-${year.endYear}`),
                startMonth: Number.isFinite(Number(year.startMonth)) ? Number(year.startMonth) : 5,
                endMonth: Number.isFinite(Number(year.endMonth)) ? Number(year.endMonth) : 4,
                classes: (() => {
                    const normalized = sortClassLabels(Array.isArray(year.classes) ? year.classes.map((name) => name?.toString().trim().toUpperCase()).filter(Boolean) : []);
                    return normalized.length ? normalized : getDefaultClassLadder();
                })()
            }));
            activeAcademicYear = sanitizeAcademicYearLabel(data.currentYear || academicYears.find((year) => year.status === 'active')?.label || currentAcademicYear);
            populateAcademicYearPresetSelector();
            const yearSelect = document.getElementById('academic-year-preset-select');
            const statusSelect = document.getElementById('academic-year-status');
            const startMonthSelect = document.getElementById('academic-year-start-month');
            const endMonthSelect = document.getElementById('academic-year-end-month');
            if (yearSelect) yearSelect.value = activeAcademicYear;
            const activeYearRecord = academicYears.find((year) => year.label === activeAcademicYear) || {};
            if (statusSelect) statusSelect.value = activeYearRecord.status || 'active';
            if (startMonthSelect) startMonthSelect.value = String(activeYearRecord.startMonth ?? 5);
            if (endMonthSelect) endMonthSelect.value = String(activeYearRecord.endMonth ?? 4);
            renderAcademicYears();
            refreshAcademicYearScopedData();
        });

        onSnapshot(configRef, (docSnap) => {
            const d = docSnap.exists() ? docSnap.data() : {};

            // --- AUTO GENERATE 12 MONTHS ---
            let existingItems = d.feeItems || [];
            const activeYearLabel = getActiveAcademicYearLabel();
            const activeYearRecord = getActiveAcademicYearRecord();
            const suffix = activeYearLabel.replace(/[^0-9]/g, '').substring(2);
            const months = getAcademicMonthSequence(activeYearRecord).map((monthIndex) => MONTH_LABELS[monthIndex]);

            let isUpdated = false;
            months.forEach(m => {
                const key = `${m.toLowerCase().substring(0,3)}-${suffix}`;
                if (!existingItems.find(i => i.key === key)) {
                    existingItems.push({ key: key, name: `${m} (${activeYearLabel})`, type: 'month', isVisible: true, academicYear: activeYearLabel });
                    isUpdated = true;
                }
            });

            if (isUpdated) {
                setDoc(configRef, { feeItems: existingItems, appName: d.appName || 'Fee Tracker Pro', defaultFee: d.defaultFee || 200 }, {merge: true});
            }

            document.getElementById('app-name-header').textContent = d.appName || 'Admin Dashboard';
            document.getElementById('footer-inst-name').textContent = d.appName || 'Institution Name';
            renderVersionInfo();
            document.getElementById('app-subtitle-header').textContent = d.appSubtitle || 'Institute Management';
            const effectiveLogoUrl = rememberInstitutionLogo(d.logoUrl || '') || 'assets/images/logo.png';
            ['admin-header-logo', 'admin-loader-logo'].forEach((id) => {
                const logoEl = document.getElementById(id);
                if (!logoEl) return;
                logoEl.src = effectiveLogoUrl;
                logoEl.onerror = () => {
                    logoEl.onerror = null;
                    logoEl.src = 'assets/images/logo.png';
                };
            });
            const setValueIfExists = (id, value = '') => {
                const element = document.getElementById(id);
                if (element) element.value = value;
            };
            setValueIfExists('app-name-input', d.appName || ''); setValueIfExists('app-subtitle-input', d.appSubtitle || '');
            setValueIfExists('web-logo', d.logoUrl || ''); setValueIfExists('web-phone', d.contactPhone || '');
            setValueIfExists('web-email', d.contactEmail || ''); setValueIfExists('web-wa', d.socialWhatsapp || '');
            setValueIfExists('web-fb', d.socialFacebook || ''); setValueIfExists('web-ig', d.socialInstagram || '');
            setValueIfExists('web-tg', d.socialTelegram || ''); setValueIfExists('web-yt', d.socialYouTube || '');
            setValueIfExists('web-regno', d.regNo || ''); setValueIfExists('web-place', d.place || '');
            setValueIfExists('pay-account-name', d.paymentAccountName || '');
            setValueIfExists('pay-upi-number', d.paymentUpiNumber || '');
            setValueIfExists('pay-upi-id', d.paymentUpiId || '');
            document.getElementById('default-fee-input').value = d.defaultFee || 200; document.getElementById('fee-status-title-input').value = d.feeStatusTitle || '';
            document.getElementById('default-fee-receipt-req').checked = d.defaultReceiptMandatory || false;

            feeItems = existingItems;
            renderDashboard();
            if(!document.getElementById('fee-settings-page').classList.contains('hidden')) renderFeeItemsManagement();
        });

        onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), (snap) => {
            webContent = snap.exists() ? Object.assign({ notices: [], gallery: [], directoryCategories: [] }, snap.data()) : { notices: [], gallery: [], directoryCategories: [] };
            document.getElementById('web-about').value = webContent.description || '';
            renderWebNotices(); renderWebGallery();
            renderDirectoryCategories();
        });
        onSnapshot(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig'), (snap) => {
            categoryAuthConfig = normalizeCategoryAuthConfig(snap.exists() ? snap.data() : {});
            renderDirectoryAuthConfig();
        });
        onSnapshot(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), (snap) => {
            pageAccessConfig = normalizePageAccessConfig(snap.exists() ? snap.data() : {});
            renderDirectoryAccessConfig();
            renderOverrideEntryOptions();
        });
        onSnapshot(collection(db, `${BASE_PATH}/publicDirectory`), (snap) => {
            publicDirectoryEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            renderDirectoryEntries();
        });

        onSnapshot(collection(db, `${BASE_PATH}/students`), (snap) => {
            rawStudents = snap.docs.map(d => ({id: d.id, ...d.data()}));
            refreshAcademicYearScopedData();
        });

        onSnapshot(collection(db, `${BASE_PATH}/staff`), async (snap) => {
            allStaff = snap.docs.map(d => ({id: d.id, ...d.data()}));
            await rebuildStaffAccessIndex(allStaff);
            renderDashboard();
            if(!document.getElementById('manage-staff-page').classList.contains('hidden')) renderStaffList();
        });

        onSnapshot(collection(db, `${BASE_PATH}/studentGroups`), (snap) => {
            studentGroups = snap.docs
                .map(d => ({id: d.id, ...d.data()}))
                .filter((group) => (group.academicYear || currentAcademicYear) === (activeAcademicYear || currentAcademicYear));
            renderDashboard();
            if(!document.getElementById('manage-groups-page').classList.contains('hidden')) renderStudentGroups();
        });

        onSnapshot(collection(db, `${BASE_PATH}/payments`), (snap) => {
            allPayments = snap.docs.map(d => ({id: d.id, ...d.data()}));
        });

        // Result module fully moved to standalone result.html/result-page.js.

    } catch (error) {
        console.error("Auth Error:", error);
        alert("സുരക്ഷാ പരിശോധനയിൽ പിഴവ് സംഭവിച്ചു.");
        window.location.href = 'index.html';
    }
});

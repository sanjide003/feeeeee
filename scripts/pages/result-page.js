import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDocs, writeBatch, setDoc, query, where, getDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE, STAFF_ACCESS_COLLECTION } from '../../config/app-config.js';
import { BASE_PATH, applyInstitutionBranding, escapeHtml } from '../shared/app-common.js';

// --- Global Variables ---
let isCurrentAdmin = false;
let hasResultAccess = false;
let currentUserKey = ''; // Holds loginId (Username) or email

let students = [];
let classes = [];
let resultSchemas = [];
let examResultsCache = [];
let resultCenterSettings = { publishAt: '', examLabel: '', locked: false };
let institutionConfig = {};
let currentAcademicYear = '';
let availableAcademicYears = [];
let allStaff = [];
window.addEventListener('load', () => {
    const loader = document.getElementById('loading-screen');
    if (!loader) return;
    loader.style.opacity = '0';
    setTimeout(() => { loader.style.display = 'none'; }, 300);
});

let editingExamId = null;
let roleScope = 'staff';
let resultPageFatalError = false;
const reportFatalResultError = (error, context = 'runtime') => {
    console.error(`Result page fatal error (${context})`, error);
    resultPageFatalError = true;
    const fatalEl = document.getElementById('result-fatal-error');
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
    if (fatalEl) fatalEl.classList.remove('hidden');
};
const withSafeUi = (fn, context = 'ui') => (...args) => {
    try { return fn(...args); } catch (error) { reportFatalResultError(error, context); return null; }
};
const debounce = (fn, wait = 120) => {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};
const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const normalizeSchemaSubjects = (subjects = []) => {
    if (!Array.isArray(subjects)) return [];
    return subjects
        .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry?.name || '').trim()))
        .filter(Boolean);
};
const normalizeResultSchema = (schema = {}) => ({
    ...schema,
    subjects: normalizeSchemaSubjects(schema.subjects || [])
});
const normalizeSubjectRow = (row = {}, index = 0) => {
    const name = String(row?.name || '').trim();
    if (!name) return null;
    const maxMarks = Number(row?.maxMarks ?? row?.totalMarks ?? row?.max ?? 100);
    const passMarks = Number(row?.passMarks ?? row?.pass ?? 35);
    return {
        id: String(row?.id || name || `subject_${index + 1}`).trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || `subject_${index + 1}`,
        name,
        maxMarks: Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : 100,
        passMarks: Number.isFinite(passMarks) && passMarks >= 0 ? passMarks : 0
    };
};
const getSchemaSubjectRows = (schema = {}, examKey = '') => {
    const subjectRows = Array.isArray(schema.subjectRows) && schema.subjectRows.length
        ? schema.subjectRows.map((row, index) => normalizeSubjectRow(row, index)).filter(Boolean)
        : normalizeSchemaSubjects(schema.subjects || []).map((name, index) => normalizeSubjectRow({ name, maxMarks: schema.maxMarks || 100, passMarks: schema.passMarks || 35 }, index)).filter(Boolean);
    if (!examKey || !schema.examConfigs?.[examKey]?.subjects?.length) return subjectRows;
    const allowed = new Set(schema.examConfigs[examKey].subjects.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
    return subjectRows.filter((subject) => allowed.has(subject.id.toLowerCase()) || allowed.has(subject.name.toLowerCase()));
};
const makeExamKey = (label = '') => String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `exam_${Date.now()}`;
const DEFAULT_EXAM_DEFS = [
    { key: 'quarterly', label: 'Quarterly' },
    { key: 'halfYearly', label: 'Half-Yearly' },
    { key: 'annual', label: 'Annual' }
];
const isDefaultExamKey = (key = '') => DEFAULT_EXAM_DEFS.some((exam) => exam.key === key);
const getCustomExamConfigs = (configs = {}) => Object.fromEntries(Object.entries(configs || {}).filter(([key, config]) => !isDefaultExamKey(key) && config?.disabled !== true));
const makeExamValue = (schemaId = '', examKey = '') => `${schemaId}::${examKey}`;
const parseExamValue = (value = '') => {
    const [schemaId, examKey] = String(value || '').split('::');
    return { schemaId: schemaId || '', examKey: examKey || '' };
};
const getSchemaForClass = (year = currentAcademicYear, classLabel = '') => resultSchemas.find((schema) => schema.classLabel === classLabel && (!year || schema.academicYear === year || !schema.academicYear));
const getExamOptionsForClass = (classLabel = '', year = currentAcademicYear) => {
    const schema = getSchemaForClass(year, classLabel);
    if (!schema) return [];
    const configs = schema.examConfigs || {};
    const defaults = DEFAULT_EXAM_DEFS.map((exam) => ({
        value: makeExamValue(schema.id, exam.key),
        key: exam.key,
        label: exam.label,
        schema,
        config: { label: exam.label, subjects: [], isDefault: true },
        isDefault: true
    }));
    const custom = Object.entries(configs)
        .filter(([key, config]) => !DEFAULT_EXAM_DEFS.some((exam) => exam.key === key) && config?.disabled !== true)
        .map(([key, config]) => ({
            value: makeExamValue(schema.id, key),
            key,
            label: config?.label || key,
            schema,
            config,
            isDefault: false
        }));
    return [...defaults, ...custom];
};
const getExamContext = (value = '', classLabel = '', year = currentAcademicYear) => {
    const { schemaId, examKey } = parseExamValue(value);
    const schema = resultSchemas.find((item) => item.id === schemaId) || getSchemaForClass(year, classLabel) || resultSchemas.find((item) => item.id === value);
    if (!schema) return null;
    const options = getExamOptionsForClass(schema.classLabel || classLabel, year);
    const option = options.find((entry) => entry.value === value || entry.key === examKey);
    return option || { value: schema.id, key: schema.id, label: schema.name || schema.classLabel || schema.id, schema };
};
const resolveResultAccess = async ({ isAdminUser = false, staffDocs = [], user = null, staffAccess = null, userKey = '' } = {}) => {
    if (isAdminUser) return { allowed: true, label: 'ADMINISTRATOR' };
    const myStaffDoc = staffDocs.find((s) => {
        const sLoginId = String(s.loginId || '').trim().toLowerCase();
        const sEmail = String(s.email || '').trim().toLowerCase();
        return (sLoginId && sLoginId === userKey) || (sEmail && sEmail === userKey);
    });
    let hasResultPermission = myStaffDoc && myStaffDoc.isActive !== false && (
        myStaffDoc.canManageResults === true
        || staffAccess?.result === true
        || staffAccess?.canManageResults === true
    );
    if (!hasResultPermission) {
        const staffAccessRef = doc(db, STAFF_ACCESS_COLLECTION, normalizeEmail(user?.email || ''));
        const staffAccessSnap = await getDoc(staffAccessRef);
        if (staffAccessSnap.exists()) {
            const accessData = staffAccessSnap.data() || {};
            hasResultPermission = accessData.isActive !== false && (accessData.result === true || accessData.canManageResults === true);
        }
    }
    if (!hasResultPermission) return { allowed: false, label: '' };
    return { allowed: true, label: myStaffDoc?.name || staffAccess?.name || staffAccess?.displayName || user?.displayName || 'RESULT OPERATOR' };
};
const resultMatchesExam = (row = {}, value = '') => {
    if (!value) return true;
    const { schemaId, examKey } = parseExamValue(value);
    if (schemaId === '__all' && examKey) return row.examKey === examKey || String(row.examId || '').endsWith(`::${examKey}`) || String(row.examId || '').endsWith(`_${examKey}`);
    return row.examId === value || (schemaId && row.schemaId === schemaId && row.examKey === examKey) || row.examId === schemaId;
};
const notify = (message = '', type = 'info') => {
    if (!message) return;
    if (type === 'error') return alert(`Error: ${message}`);
    alert(message);
};
const withBusyButton = async (buttonId, labelBusy, runner) => {
    const btn = document.getElementById(buttonId);
    const old = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = labelBusy;
    }
    try {
        await runner();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = old;
        }
    }
};
const getNextClassLabel = (classLabel = '') => {
    const progressionMap = resultCenterSettings.classProgressionMap || {};
    if (progressionMap[classLabel]) return String(progressionMap[classLabel]).trim();
    const clean = String(classLabel || '').trim();
    const match = clean.match(/^(\d+)(\s*[A-Z])?$/i);
    if (!match) return '';
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0 || num >= 12) return '';
    return `${num + 1}${match[2] || ''}`.trim();
};
const detectAnnualResultRow = (row = {}) => {
    if (String(row.examType || '').toLowerCase() === 'annual') return true;
    const examName = String(resultSchemas.find((schema) => schema.id === row.examId)?.name || '').toLowerCase();
    return examName.includes('annual');
};
const getStoredMarkValue = (mark) => {
    if (mark && typeof mark === 'object') return String(mark.value ?? mark.mark ?? '').trim();
    return String(mark ?? '').trim();
};
const getResultMark = (marks = {}, subject = {}) => {
    const mark = marks[subject.id] ?? marks[subject.name] ?? '';
    return getStoredMarkValue(mark);
};
const isPassingMark = (value = '', passMarks = 35) => {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) return false;
    if (raw === 'P') return true;
    if (raw === 'A' || raw === 'AB') return false;
    const num = Number(raw);
    return Number.isFinite(num) && num >= Number(passMarks || 0);
};
const isPassFromMarks = (row = {}) => {
    const marks = row.marks || {};
    const schema = resultSchemas.find((item) => item.id === row.schemaId) || getSchemaForClass(row.academicYear || currentAcademicYear, row.classLabel || '');
    const subjects = getSchemaSubjectRows(schema || {}, row.examKey || parseExamValue(row.examId || '').examKey);
    const entries = subjects.length
        ? subjects.map((subject) => ({ value: getResultMark(marks, subject), passMarks: subject.passMarks }))
        : Object.values(marks).map((mark) => ({ value: getStoredMarkValue(mark), passMarks: mark?.passMarks ?? 35 }));
    if (!entries.length) return false;
    return entries.every((entry) => isPassingMark(entry.value, entry.passMarks));
};
const buildResultSummary = (marks = {}, subjectRows = []) => {
    let obtained = 0;
    let maximum = 0;
    let hasEntries = false;
    let passStatus = 'PASS';
    const grades = {};
    subjectRows.forEach((subject) => {
        const value = getResultMark(marks, subject);
        if (!value) {
            passStatus = 'FAIL';
            return;
        }
        hasEntries = true;
        maximum += Number(subject.maxMarks || 0);
        const upper = String(value).trim().toUpperCase();
        const num = Number(value);
        if (Number.isFinite(num)) obtained += num;
        if (!isPassingMark(upper, subject.passMarks)) passStatus = 'FAIL';
        grades[subject.id] = isPassingMark(upper, subject.passMarks) ? 'PASS' : 'FAIL';
    });
    return { totals: { obtained, maximum, passStatus: hasEntries ? passStatus : 'FAIL' }, grades };
};

// --- Authentication & Guard (Username Based) ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html');
        return;
    }

    // Get login ID (Username) from current session, exactly like collection-page.js
    const staffAccess = window.AppSession?.getStaffAccess?.() || {};
    currentUserKey = String(staffAccess.loginId || staffAccess.userKey || user.email || '').trim().toLowerCase();
    
    try {
        // 1. Check if user is Master Admin
        const adminRef = doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
        const adminSnap = await getDoc(adminRef);
        const adminData = adminSnap.exists() ? adminSnap.data() : {};
        const adminEmail = String(adminData.email || '').toLowerCase();
        const adminAccounts = SINGLE_ADMIN_MODE ? [] : (Array.isArray(adminData.admins) ? adminData.admins : []);
        
        isCurrentAdmin = (window.AppSession?.getRole?.() === 'admin')
                         || (user.email && adminEmail === user.email.toLowerCase()) || 
                         (user.email && adminAccounts.some((account) => String(account.email).toLowerCase() === user.email.toLowerCase() && account.isActive !== false));

        // 2. Listen to Staff Collection to check permissions via Username
        onSnapshot(collection(db, `${BASE_PATH}/staff`), async (staffSnap) => {
            allStaff = staffSnap.docs.map(d => ({id: d.id, ...d.data()}));
            const access = await resolveResultAccess({ isAdminUser: isCurrentAdmin, staffDocs: allStaff, user, staffAccess, userKey: currentUserKey });
            if (access.allowed) grantResultAccess(access.label);
            else denyResultAccess();
        });
        
    } catch (e) {
        console.error("Auth check failed", e);
        denyResultAccess();
    }
});

const grantResultAccess = (displayName) => {
    hasResultAccess = true;
    roleScope = isCurrentAdmin ? 'admin' : 'staff';
    document.getElementById('access-denied-block').classList.add('hidden');
    document.getElementById('page-content').classList.remove('hidden');
    const safeName = typeof displayName === 'string' ? displayName : (displayName?.name || 'RESULT OPERATOR');
    document.getElementById('staff-name-display').textContent = safeName;
    applyRoleTabVisibility();
    
    if (!window.isResultInitialized) {
        initializeDataListeners();
        window.isResultInitialized = true;
    }
};

const denyResultAccess = () => {
    hasResultAccess = false;
    document.getElementById('access-denied-block').classList.remove('hidden');
    document.getElementById('page-content').classList.add('hidden');
};
const applyRoleTabVisibility = () => {
    const adminOnlyItems = Array.from(document.querySelectorAll('[data-role-scope="admin-only"]'));
    adminOnlyItems.forEach((item) => item.classList.toggle('hidden', roleScope !== 'admin'));
    if (roleScope === 'admin') return;
    const activeTab = document.querySelector('.tab-link.active');
    const activeTarget = activeTab?.dataset?.target || '';
    const blockedTargets = new Set(['settings-page', 'subjects-page', 'grades-page', 'published-page', 'draft-page', 'snapshot-page', 'promotion-page']);
    if (blockedTargets.has(activeTarget)) {
        const dashboardLink = document.querySelector('.tab-link[data-target="dashboard-page"]');
        dashboardLink?.click();
    }
};

document.getElementById('logout-btn')?.addEventListener('click', () => {
    signOut(auth).then(async () => {
        await window.AppSession?.clearAll({ purgeClientData: true });
        window.location.replace('index.html'); 
    });
});

// --- Tab Logic ---
const tabs = document.querySelectorAll('.tab-link');
const pages = document.querySelectorAll('.page-content');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const navMenu = document.querySelector('.nav-menu');

mobileMenuBtn.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    mobileMenuBtn.classList.toggle('active-toggle');
});

const activateResultTab = (tabEl, { updateHash = true } = {}) => {
    if (!tabEl) return;
    tabs.forEach(t => t.classList.remove('active'));
    pages.forEach(p => p.classList.add('hidden'));
    tabEl.classList.add('active');
    const targetPage = document.getElementById(tabEl.dataset.target);
    if(targetPage) targetPage.classList.remove('hidden');
    if (updateHash && tabEl.getAttribute('href')?.startsWith('#')) {
        const nextHash = tabEl.getAttribute('href');
        if (window.location.hash !== nextHash) history.pushState({}, '', nextHash);
    }
};
tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        if(tab.id === 'logout-btn') return;
        if(tab.getAttribute('href') && !tab.getAttribute('href').startsWith('#')) return;

        e.preventDefault();
        activateResultTab(tab);
        
        navMenu.classList.remove('active');
        mobileMenuBtn.classList.remove('active-toggle');
    });
});
window.addEventListener('hashchange', () => {
    const tab = Array.from(tabs).find((entry) => entry.getAttribute('href') === window.location.hash);
    if (tab) activateResultTab(tab, { updateHash: false });
});

// --- Data Listeners ---
const initializeDataListeners = () => {
    const scheduleRefresh = debounce(() => {
        try {
            populateDropdowns();
            updateDashboard();
            renderPublishedDraftTables();
            updateReportPreview();
        } catch (error) {
            reportFatalResultError(error, 'scheduleRefresh');
        }
    }, 100);
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'academicYears'), (snap) => {
        const payload = snap.exists() ? snap.data() : {};
        currentAcademicYear = payload.currentYear || '';
        availableAcademicYears = Array.isArray(payload.years) ? payload.years.filter(Boolean) : (payload.currentYear ? [payload.currentYear] : []);
        document.getElementById('academic-year-badge').textContent = currentAcademicYear || 'All Years';
        scheduleRefresh();
    });
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'config'), (snap) => {
        const conf = snap.exists() ? (snap.data() || {}) : {};
        institutionConfig = conf;
        applyInstitutionBranding(conf, {
            defaultAppName: 'Result Management',
            logoIds: ['header-logo', 'splash-logo-img'],
            updateDocumentTitle: true,
            documentTitleSuffix: 'Result Management'
        });
    });

    onSnapshot(collection(db, `${BASE_PATH}/students`), (snap) => {
        students = snap.docs.map(d => ({id: d.id, ...d.data()}));
        classes = [...new Set(students.map(s => s.class).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        scheduleRefresh();
    });

    onSnapshot(collection(db, `${BASE_PATH}/resultSchemas`), (snap) => {
        resultSchemas = snap.docs.map((d) => normalizeResultSchema({ id: d.id, ...d.data() }));
        renderExamSetup();
        scheduleRefresh();
    });

    onSnapshot(collection(db, `${BASE_PATH}/examResults`), (snap) => {
        examResultsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        scheduleRefresh();
    });

    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), (snap) => {
        if(snap.exists()) {
            resultCenterSettings = snap.data();
        }
        scheduleRefresh();
        
        const pubInput = document.getElementById('publish-title');
        if(pubInput && resultCenterSettings.examLabel) pubInput.value = resultCenterSettings.examLabel;
        const publishAtInput = document.getElementById('publish-at-input');
        if (publishAtInput) publishAtInput.value = resultCenterSettings.publishAt || '';
        const publishYearSelect = document.getElementById('publish-academic-year');
        if (publishYearSelect && resultCenterSettings.publishAcademicYear) publishYearSelect.value = resultCenterSettings.publishAcademicYear;
        const publishExamSelect = document.getElementById('publish-exam-select');
        if (publishExamSelect && resultCenterSettings.publishExamKey) publishExamSelect.value = resultCenterSettings.publishExamKey;
        updatePublishLiveStatus();
        const gradeScaleSelect = document.getElementById('grade-scale-select');
        if (gradeScaleSelect) gradeScaleSelect.value = String(resultCenterSettings.gradeScaleTotal || 100);
        renderGradeRules();
        renderBlockedClasses();
        renderPromotionMappingUI();
        renderResultVisibilitySettings();
    });
};
const renderGradeRules = () => {
    const container = document.getElementById('grade-rules-rows');
    if (!container) return;
    const scale = Number(document.getElementById('grade-scale-select')?.value || resultCenterSettings.gradeScaleTotal || 100) === 50 ? 50 : 100;
    const defaultRules = scale === 50
        ? [{ grade: 'A+', min: 45, max: 50 }, { grade: 'A', min: 40, max: 44.99 }, { grade: 'B', min: 30, max: 39.99 }, { grade: 'C', min: 18, max: 29.99 }, { grade: 'F', min: 0, max: 17.99 }]
        : [{ grade: 'A+', min: 90, max: 100 }, { grade: 'A', min: 80, max: 89.99 }, { grade: 'B', min: 60, max: 79.99 }, { grade: 'C', min: 35, max: 59.99 }, { grade: 'F', min: 0, max: 34.99 }];
    const rules = Array.isArray(resultCenterSettings.gradeRules) && resultCenterSettings.gradeRules.length ? resultCenterSettings.gradeRules : defaultRules;
    container.innerHTML = rules.map((rule, index) => `<div class="grid grid-cols-3 gap-2"><input class="grade-grade p-2 border rounded" data-index="${index}" value="${rule.grade || ''}"><input type="number" class="grade-min p-2 border rounded" data-index="${index}" value="${rule.min ?? 0}"><input type="number" class="grade-max p-2 border rounded" data-index="${index}" value="${rule.max ?? 0}"></div>`).join('');
};
const renderBlockedClasses = () => {
    const container = document.getElementById('blocked-classes-list');
    if (!container) return;
    container.innerHTML = classes.map((cls) => `<label class="text-sm font-medium flex items-center gap-2"><input type="checkbox" class="blocked-class-checkbox" value="${cls}" ${resultCenterSettings.blockedClasses?.includes(cls) ? 'checked' : ''}>${cls}</label>`).join('');
};
const renderPromotionMappingUI = () => {
    const container = document.getElementById('promotion-map-list');
    if (!container) return;
    const map = resultCenterSettings.classProgressionMap || {};
    container.innerHTML = classes.map((cls, idx) => {
        const fallback = classes[idx + 1] || '';
        const selected = map[cls] || fallback;
        const options = [`<option value="">-- End --</option>`, ...classes.map((option) => `<option value="${escapeHtml(option)}" ${selected === option ? 'selected' : ''}>${escapeHtml(option)}</option>`)].join('');
        return `<div class="grid grid-cols-2 gap-2 items-center"><div class="text-sm font-semibold">${escapeHtml(cls)}</div><select class="promotion-map-input p-2 border rounded" data-class="${escapeHtml(cls)}">${options}</select></div>`;
    }).join('');
    const yearSelect = document.getElementById('promotion-target-year');
    if (yearSelect) {
        const normalizeYear = (entry) => {
            if (!entry) return '';
            if (typeof entry === 'string') return entry;
            if (typeof entry === 'object') return String(entry.value || entry.year || entry.label || '').trim();
            return String(entry).trim();
        };
        const options = availableAcademicYears
            .map((year) => normalizeYear(year))
            .filter((year) => year && year !== currentAcademicYear);
        yearSelect.innerHTML = `<option value="">Select Next Academic Year</option>${options.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('')}`;
    }
};
const buildVisibilityKey = (classLabel = '', examKey = '') => `${classLabel}__${examKey}`;
const renderResultVisibilitySettings = () => {
    const container = document.getElementById('result-visibility-grid');
    if (!container) return;
    const map = resultCenterSettings.resultVisibilityMap || {};
    const rows = [];
    const classList = [...new Set(resultSchemas.filter((schema) => schema.academicYear === currentAcademicYear || !schema.academicYear).map((schema) => schema.classLabel).filter(Boolean))];
    classList.forEach((cls) => rows.push(`<button class="visibility-class-card border rounded-lg p-3 bg-white text-left hover:border-indigo-400" data-class="${escapeHtml(cls)}"><div class="font-bold">${escapeHtml(cls)}</div><div class="text-xs text-gray-500">Click to manage exam visibility</div></button>`));
    container.innerHTML = rows.length ? rows.join('') : '<div class="text-sm text-gray-500">No class/exam entries found.</div>';
};
const formatDateTimeLabel = (value = '') => {
    if (!value) return 'Not scheduled';
    const ts = new Date(value);
    if (Number.isNaN(ts.getTime())) return 'Invalid date/time';
    return ts.toLocaleString();
};
const updatePublishLiveStatus = () => {
    const el = document.getElementById('publish-live-status');
    if (!el) return;
    const nowTs = Date.now();
    const scheduleValue = document.getElementById('publish-at-input')?.value || resultCenterSettings.publishAt || '';
    const scheduleTs = scheduleValue ? new Date(scheduleValue).getTime() : 0;
    const title = document.getElementById('publish-title')?.value?.trim() || resultCenterSettings.examLabel || 'Upcoming Exam';
    let line = `Title: ${title}\nScheduled: ${formatDateTimeLabel(scheduleValue)}\nCurrent time: ${new Date(nowTs).toLocaleString()}`;
    if (scheduleTs && scheduleTs > nowTs) line += `\nStatus: Scheduled (Student page will show countdown).`;
    else if (scheduleTs && scheduleTs <= nowTs) line += `\nStatus: Publish window reached (Students can see published results).`;
    else line += `\nStatus: No schedule set.`;
    el.textContent = line;
};
const renderPublishControls = () => {
    const yearSelect = document.getElementById('publish-academic-year');
    const examSelect = document.getElementById('publish-exam-select');
    if (!yearSelect || !examSelect) return;
    const years = [...new Set([currentAcademicYear, ...resultSchemas.map((s) => s.academicYear).filter(Boolean)])].filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)));
    const prevYear = yearSelect.value || resultCenterSettings.publishAcademicYear || currentAcademicYear;
    yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
    yearSelect.value = years.includes(prevYear) ? prevYear : (years[0] || currentAcademicYear);
    const selectedYear = yearSelect.value;
    const examsMap = new Map();
    resultSchemas
        .filter((schema) => (schema.academicYear || currentAcademicYear) === selectedYear)
        .forEach((schema) => {
            getExamOptionsForClass(schema.classLabel, selectedYear).forEach((exam) => {
                const key = exam.key || parseExamValue(exam.value).examKey || exam.value;
                if (!key || examsMap.has(key)) return;
                examsMap.set(key, { value: key, label: exam.label || key });
            });
        });
    const exams = Array.from(examsMap.values());
    const prevExam = examSelect.value || resultCenterSettings.publishExamKey || '';
    examSelect.innerHTML = `<option value="">-- Choose Academic Exam --</option>${exams.map((exam) => `<option value="${exam.value}">${escapeHtml(exam.label)}</option>`).join('')}`;
    if (prevExam) examSelect.value = prevExam;
};
const updateReportPreview = () => {
    const preview = document.getElementById('report-preview-summary');
    if (!preview) return;
    const targetYear = document.getElementById('report-academic-year')?.value?.trim() || currentAcademicYear || '';
    const className = document.getElementById('report-class-select')?.value || '';
    const examId = document.getElementById('report-exam-select')?.value || '';
    if (!className || !examId) {
        preview.textContent = 'Select year, class and exam to preview result availability.';
        return;
    }
    const rows = examResultsCache.filter((row) => resultMatchesExam(row, examId) && row.classLabel === className && (!targetYear || row.academicYear === targetYear || !row.academicYear));
    const publishedCount = rows.filter((row) => row.published === true).length;
    preview.textContent = `Academic Year: ${targetYear || 'All'} | Records: ${rows.length} | Published: ${publishedCount} | Draft: ${Math.max(rows.length - publishedCount, 0)}`;
};

const renderExamSelectOptions = (selectEl, classLabel = '', year = currentAcademicYear, placeholder = '-- Choose Exam --', onlyPublished = false) => {
    if (!selectEl) return;
    const previous = selectEl.value;
    const baseOptions = classLabel
        ? getExamOptionsForClass(classLabel, year)
        : DEFAULT_EXAM_DEFS.map((exam) => ({ value: makeExamValue('__all', exam.key), key: exam.key, label: exam.label }));
    const options = baseOptions.filter((option) => !onlyPublished || examResultsCache.some((row) => row.published === true && (!classLabel || row.classLabel === classLabel) && row.academicYear === year && resultMatchesExam(row, option.value)));
    selectEl.innerHTML = `<option value="">${placeholder}</option>` + options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
    if (previous && Array.from(selectEl.options).some((option) => option.value === previous)) selectEl.value = previous;
};
const populateReportYears = () => {
    const el = document.getElementById('report-academic-year');
    if (!el) return;
    const previous = el.value;
    const years = [...new Set(examResultsCache.filter((row) => row.published === true && row.academicYear).map((row) => row.academicYear))].sort((a,b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
    const fallback = currentAcademicYear ? [currentAcademicYear] : [];
    const source = years.length ? years : fallback;
    el.innerHTML = `<option value="">-- Select Academic Year --</option>` + source.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('');
    el.value = previous && source.includes(previous) ? previous : (source[0] || '');
};
const populateDropdowns = () => {
    const classOpts = `<option value="">-- Choose Class --</option>` + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    const entryClassSelect = document.getElementById('entry-class-select');
    const reportClassSelect = document.getElementById('report-class-select');
    const subjectClassSelect = document.getElementById('subject-class-select');
    const examConfigClassSelect = document.getElementById('exam-config-class-select');
    [entryClassSelect, reportClassSelect, subjectClassSelect, examConfigClassSelect].forEach((select) => {
        if (!select) return;
        const current = select.value;
        select.innerHTML = classOpts;
        if (current && classes.includes(current)) select.value = current;
    });
    const schemaListClassFilter = document.getElementById('schema-list-class-filter');
    if (schemaListClassFilter) {
        const currentFilter = schemaListClassFilter.value;
        schemaListClassFilter.innerHTML = `<option value="">All Classes</option>` + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (currentFilter && classes.includes(currentFilter)) schemaListClassFilter.value = currentFilter;
    }
    renderExamConfigRowsForSelectedClass();
    renderExamSetup();
    populateReportYears();
    renderExamSelectOptions(document.getElementById('entry-exam-select'), entryClassSelect?.value || '', currentAcademicYear);
    renderExamSelectOptions(document.getElementById('report-exam-select'), reportClassSelect?.value || '', document.getElementById('report-academic-year')?.value || currentAcademicYear, '-- Choose Exam --', true);
};

// --- Dashboard ---
const updateDashboard = () => {
    const yearStudents = students.filter((s) => s.academicYear === currentAcademicYear || !s.academicYear);
    const yearRows = examResultsCache.filter((row) => row.academicYear === currentAcademicYear || !row.academicYear);
    const yearPublishedRows = yearRows.filter((row) => row.published === true);
    document.getElementById('dash-total-classes').textContent = classes.length;
    document.getElementById('dash-total-students').textContent = yearStudents.length;
    
    const statusEl = document.getElementById('dash-publish-status');
    if(resultCenterSettings.publishAt && new Date(resultCenterSettings.publishAt) <= new Date()) {
        statusEl.innerHTML = `<span class="text-emerald-200">Published</span>`;
    } else {
        statusEl.innerHTML = `<span class="text-amber-200">Hidden</span>`;
    }
    const passRows = yearPublishedRows.filter((row) => isPassFromMarks(row));
    const passPercent = yearPublishedRows.length ? Math.round((passRows.length / yearPublishedRows.length) * 100) : 0;
    const passEl = document.getElementById('dash-pass-percent');
    if (passEl) passEl.textContent = `${passPercent}%`;
    const healthLabelEl = document.getElementById('dash-health-label');
    if (healthLabelEl) healthLabelEl.textContent = `${passPercent}%`;
    const healthBarEl = document.getElementById('dash-health-bar');
    if (healthBarEl) healthBarEl.style.width = `${passPercent}%`;

    const recentExamsEl = document.getElementById('dash-recent-exams');
    const recent = resultSchemas.slice(-3);
    if(recent.length === 0) {
        recentExamsEl.innerHTML = '<p class="text-gray-500 text-sm">No exams created yet.</p>';
    } else {
        recentExamsEl.innerHTML = recent.map(e => `
            <div class="flex justify-between items-center p-3 border rounded-lg bg-gray-50">
                <span class="font-bold text-gray-800">${escapeHtml(e.classLabel || e.name || 'Class Schema')}</span>
                <span class="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded font-bold">${getSchemaSubjectRows(e).length || 0} Subjects</span>
            </div>
        `).join('');
    }
    renderPublishedDraftTables();
    updateReportPreview();
    renderPublishControls();
};

const getStudentNameById = (studentId = '') => students.find((entry) => entry.id === studentId)?.name || 'Unknown';
const getStudentById = (studentId = '') => students.find((entry) => entry.id === studentId) || {};
const getExamNameById = (examId = '', row = {}) => row.examLabel || getExamContext(examId, row.classLabel || '', row.academicYear || currentAcademicYear)?.label || resultSchemas.find((entry) => entry.id === examId)?.name || 'Unknown Exam';
const sortResultRows = (rows = [], order = 'admission') => {
    const wrapped = rows.map((row) => ({ row, student: getStudentById(row.studentId) }));
    return sortReportRows(wrapped, order).map((entry) => entry.row);
};
const renderPublishedDraftTables = () => {
    const publishedEl = document.getElementById('published-results-table');
    const draftEl = document.getElementById('draft-results-table');
    if (!publishedEl || !draftEl) return;
    const yearRows = examResultsCache.filter((row) => !currentAcademicYear || !row.academicYear || row.academicYear === currentAcademicYear);
    const publishedClass = document.getElementById('published-class-filter')?.value || '';
    const publishedExam = document.getElementById('published-exam-filter')?.value || '';
    const draftClass = document.getElementById('draft-class-filter')?.value || '';
    const draftExam = document.getElementById('draft-exam-filter')?.value || '';
    const publishedRowsRaw = yearRows.filter((row) => row.published === true)
        .filter((row) => !publishedClass || row.classLabel === publishedClass)
        .filter((row) => resultMatchesExam(row, publishedExam));
    const draftRowsRaw = yearRows.filter((row) => row.published !== true)
        .filter((row) => !draftClass || row.classLabel === draftClass)
        .filter((row) => resultMatchesExam(row, draftExam));
    const publishedOrder = document.getElementById('published-order-filter')?.value || 'admission';
    const draftOrder = document.getElementById('draft-order-filter')?.value || 'admission';
    const publishedRows = sortResultRows(publishedRowsRaw, publishedOrder);
    const draftRows = sortResultRows(draftRowsRaw, draftOrder);

    const rowTemplate = (row, isPublished = false) => `<div class="border rounded-lg p-3 flex items-center justify-between bg-white gap-2 relative" data-result-id="${escapeHtml(row.id)}">
        <input type="checkbox" class="${isPublished ? 'published' : 'draft'}-select-checkbox" value="${row.id}">
        <div class="min-w-0 flex-1">
            <div class="font-bold text-sm truncate">${escapeHtml(getStudentNameById(row.studentId))}</div>
            <div class="text-xs text-gray-500">${escapeHtml(getExamNameById(row.examId, row))} • ${escapeHtml(row.classLabel || '-')} • ${escapeHtml(getStudentById(row.studentId).admissionNo || getStudentById(row.studentId).adm || '-')} • ${isPublished ? 'Published' : 'Draft'}</div>
        </div>
        <div class="relative">
            <button class="result-row-menu-toggle w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600" data-id="${row.id}" title="Actions"><i class="fas fa-ellipsis-v"></i></button>
            <div class="result-row-menu hidden absolute right-0 mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[140px]" data-id="${row.id}">
                <button class="edit-result-btn block w-full text-left px-3 py-2 text-sm hover:bg-blue-50" data-id="${row.id}">Edit</button>
                <button class="publish-toggle-btn block w-full text-left px-3 py-2 text-sm hover:bg-indigo-50" data-id="${row.id}" data-next="${isPublished ? 'draft' : 'published'}">${isPublished ? 'Move to Draft' : 'Publish'}</button>
                <button class="delete-result-btn block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50" data-id="${row.id}">Delete</button>
            </div>
        </div>
    </div>`;
    publishedEl.innerHTML = publishedRows.length ? publishedRows.map((row) => rowTemplate(row, true)).join('') : '<div class="text-sm text-gray-500">No published results.</div>';
    draftEl.innerHTML = draftRows.length ? draftRows.map((row) => rowTemplate(row, false)).join('') : '<div class="text-sm text-gray-500">No draft results.</div>';
    const classOptions = `<option value="">All Classes</option>${classes.map((cls) => `<option value="${cls}">${cls}</option>`).join('')}`;
    ['published-class-filter','draft-class-filter'].forEach((id) => {
        const el = document.getElementById(id); if (!el) return; const prev = el.value; el.innerHTML = classOptions; if (prev) el.value = prev;
    });
    renderExamSelectOptions(document.getElementById('published-exam-filter'), publishedClass, currentAcademicYear, 'All Exams');
    renderExamSelectOptions(document.getElementById('draft-exam-filter'), draftClass, currentAcademicYear, 'All Exams');
};

// --- Exam Setup Logic ---
const buildSubjectRowHtml = (row = {}) => `
    <tr class="subject-row border-t">
        <td class="p-2"><input type="text" class="subject-name-input w-full p-2 border rounded" value="${escapeHtml(row.name || '')}" placeholder="Subject name"></td>
        <td class="p-2"><select class="subject-total-input w-full p-2 border rounded"><option value="100" ${(Number(row.maxMarks ?? 100) === 100) ? 'selected' : ''}>100</option><option value="50" ${(Number(row.maxMarks ?? 100) === 50) ? 'selected' : ''}>50</option></select></td>
        <td class="p-2"><input type="number" class="subject-pass-input w-full p-2 border rounded" value="${escapeHtml(String(row.passMarks ?? 35))}" min="0"></td>
        <td class="p-2"><button type="button" class="subject-remove-row text-red-600 font-bold">✕</button></td>
    </tr>
`;
const renderExamSetup = () => {
    const cont = document.getElementById('exam-list-container');
    if (!cont) return;
    const classFilter = document.getElementById('schema-list-class-filter')?.value || '';
    const filtered = resultSchemas
        .filter((s) => s.academicYear === currentAcademicYear || !s.academicYear)
        .filter((s) => !classFilter || s.classLabel === classFilter);
    
    if(filtered.length === 0) {
        cont.innerHTML = `<div class="col-span-2 text-center py-8 text-gray-500 bg-gray-50 rounded-xl border border-dashed">No saved subjects or exams for the selected class/year.</div>`;
        return;
    }

    cont.innerHTML = filtered.map((schema) => {
        const customExams = Object.entries(getCustomExamConfigs(schema.examConfigs || {}));
        const subjectsHtml = getSchemaSubjectRows(schema).map((sub) => `<div class="text-sm text-gray-700">${escapeHtml(sub.name)} <span class="text-xs text-gray-500">(${sub.maxMarks}/${sub.passMarks})</span></div>`).join('') || '<div class="text-sm text-gray-500 italic">No subjects saved.</div>';
        const defaultExamsHtml = DEFAULT_EXAM_DEFS.map((exam) => `<div class="text-sm text-slate-700 border-t pt-2 mt-2"><span class="font-bold">${escapeHtml(exam.label)}</span> <span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Default</span><div class="text-xs text-slate-500">Subjects: All saved subjects</div></div>`).join('');
        const customExamsHtml = customExams.length
            ? customExams.map(([key, config]) => {
                const examSubjects = getSchemaSubjectRows(schema, key).map((subject) => subject.name).join(', ') || 'All saved subjects';
                return `<div class="text-sm text-slate-700 border-t pt-2 mt-2 flex items-start justify-between gap-2"><div><span class="font-bold">${escapeHtml(config?.label || key)}</span><div class="text-xs text-slate-500">Subjects: ${escapeHtml(examSubjects)}</div></div><div class="flex gap-1 shrink-0"><button class="custom-exam-edit-btn text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded" data-schema-id="${schema.id}" data-exam-key="${escapeHtml(key)}">Edit</button><button class="custom-exam-delete-btn text-xs bg-red-50 text-red-700 px-2 py-1 rounded" data-schema-id="${schema.id}" data-exam-key="${escapeHtml(key)}">Delete</button></div></div>`;
            }).join('')
            : '<div class="text-sm text-gray-500 italic border-t pt-2 mt-2">No additional exams saved for this class.</div>';
        const examsHtml = defaultExamsHtml + customExamsHtml;
        return `
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm relative group hover:border-indigo-300 transition">
            <div class="flex justify-between items-start mb-2">
                <h3 class="font-bold text-lg text-gray-800">${escapeHtml(schema.classLabel || '--')}</h3>
                <div class="relative">
                    <button class="schema-menu-toggle text-slate-600 p-2 rounded hover:bg-gray-100" data-id="${schema.id}"><i class="fas fa-ellipsis-v"></i></button>
                    <div class="schema-menu hidden absolute right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 min-w-[120px]" data-id="${schema.id}">
                        <button class="schema-edit-btn block w-full text-left px-3 py-2 text-sm hover:bg-blue-50" data-id="${schema.id}">Edit Subjects</button>
                        <button class="schema-delete-btn block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50" data-id="${schema.id}">Delete</button>
                    </div>
                </div>
            </div>
            <div class="text-xs text-gray-500 mb-2">Academic Year: ${escapeHtml(schema.academicYear || '--')}</div>
            <div class="font-bold text-xs uppercase text-slate-500 mb-1">Subjects</div>
            <div class="space-y-1">${subjectsHtml}</div>
            <div class="font-bold text-xs uppercase text-slate-500 mt-3">Exams</div>
            ${examsHtml}
        </div>`;
    }).join('');
};

document.getElementById('create-exam-btn')?.addEventListener('click', () => {
    if (roleScope !== 'admin') return alert('Only admin can manage exam setup.');
    editingExamId = null;
    document.getElementById('exam-modal-title').textContent = "Create New Exam";
    document.getElementById('exam-name').value = '';
    document.getElementById('exam-max').value = '50';
    document.getElementById('exam-pass').value = '18';
    document.getElementById('subject-list').innerHTML = `
        <div class="flex gap-2 mb-2 sub-row">
            <input type="text" class="w-full p-2 border rounded-lg text-sm sub-input" placeholder="Subject Name (e.g. English)">
            <button class="text-red-500 px-2 remove-sub-btn"><i class="fas fa-times"></i></button>
        </div>
    `;
    document.getElementById('exam-modal').classList.remove('hidden');
    document.getElementById('exam-modal').classList.add('flex');
});

document.getElementById('exam-cancel').addEventListener('click', () => {
    document.getElementById('exam-modal').classList.add('hidden');
});

document.getElementById('add-subject-btn').addEventListener('click', () => {
    const div = document.createElement('div');
    div.className = 'flex gap-2 mb-2 sub-row';
    div.innerHTML = `
        <input type="text" class="w-full p-2 border rounded-lg text-sm sub-input" placeholder="Subject Name">
        <button class="text-red-500 px-2 remove-sub-btn"><i class="fas fa-times"></i></button>
    `;
    document.getElementById('subject-list').appendChild(div);
});

document.getElementById('subject-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-sub-btn');
    if(btn) btn.closest('.sub-row').remove();
});

document.getElementById('exam-list-container').addEventListener('click', async (e) => {
    if (roleScope !== 'admin') return;
    const editBtn = e.target.closest('.edit-exam-btn');
    const delBtn = e.target.closest('.del-exam-btn');

    if(editBtn) {
        const exam = resultSchemas.find(s => s.id === editBtn.dataset.id);
        if(!exam) return;
        editingExamId = exam.id;
        document.getElementById('exam-modal-title').textContent = "Edit Exam";
        document.getElementById('exam-name').value = exam.name;
        document.getElementById('exam-max').value = exam.maxMarks || '';
        document.getElementById('exam-pass').value = exam.passMarks || '';
        
        const subHtml = (exam.subjects || []).map(sub => `
            <div class="flex gap-2 mb-2 sub-row">
                <input type="text" class="w-full p-2 border rounded-lg text-sm sub-input" value="${escapeHtml(sub)}">
                <button class="text-red-500 px-2 remove-sub-btn"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        document.getElementById('subject-list').innerHTML = subHtml || `<div class="flex gap-2 mb-2 sub-row"><input type="text" class="w-full p-2 border rounded-lg text-sm sub-input" placeholder="Subject Name"><button class="text-red-500 px-2 remove-sub-btn"><i class="fas fa-times"></i></button></div>`;
        
        document.getElementById('exam-modal').classList.remove('hidden');
        document.getElementById('exam-modal').classList.add('flex');
    }

    if(delBtn) {
        if(confirm("Are you sure you want to delete this exam?")) {
            await deleteDoc(doc(db, `${BASE_PATH}/resultSchemas`, delBtn.dataset.id));
        }
    }
});

document.getElementById('exam-save').addEventListener('click', async () => {
    if (roleScope !== 'admin') return alert('Only admin can save exam setup.');
    const name = document.getElementById('exam-name').value.trim();
    const maxMarks = parseInt(document.getElementById('exam-max').value) || 0;
    const passMarks = parseInt(document.getElementById('exam-pass').value) || 0;
    
    const subjects = Array.from(document.querySelectorAll('.sub-input'))
        .map(input => input.value.trim())
        .filter(val => val !== '');

    if(!name || subjects.length === 0) return alert("Exam name and at least one subject required.");

    const payload = {
        name, maxMarks, passMarks, subjects,
        academicYear: currentAcademicYear,
        updatedAt: Date.now()
    };

    const btn = document.getElementById('exam-save');
    btn.disabled = true;
    btn.innerHTML = "Saving...";

    try {
        if(editingExamId) {
            await updateDoc(doc(db, `${BASE_PATH}/resultSchemas`, editingExamId), payload);
        } else {
            await setDoc(doc(collection(db, `${BASE_PATH}/resultSchemas`)), payload);
        }
        document.getElementById('exam-modal').classList.add('hidden');
    } catch (err) {
        console.error(err);
        alert("Failed to save exam.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Save Exam";
    }
});

// --- Marks Entry Logic ---
let entryStudents = [];
let currentExamSchema = null;
let currentExamContext = null;

const loadMarksTable = () => {
    const examId = document.getElementById('entry-exam-select').value;
    const className = document.getElementById('entry-class-select').value;
    const cont = document.getElementById('marks-entry-container');

    if(!examId || !className) {
        cont.classList.add('hidden');
        return;
    }

    currentExamContext = getExamContext(examId, className, currentAcademicYear);
    currentExamSchema = currentExamContext?.schema || null;
    entryStudents = students.filter(s => s.class === className && (s.academicYear === currentAcademicYear || !s.academicYear)).sort((a,b) => a.name.localeCompare(b.name));

    if(!currentExamSchema || entryStudents.length === 0) {
        cont.classList.add('hidden');
        alert("No students found in this class or exam not valid.");
        return;
    }

    document.getElementById('entry-table-title').textContent = `Class: ${className}`;
    document.getElementById('entry-table-subtitle').textContent = `Exam: ${currentExamContext?.label || currentExamSchema.name}`;

    // Build Headers
    let headHtml = `<tr><th class="p-3 text-left w-10">No</th><th class="p-3 text-left min-w-[150px]">Student Name</th>`;
    getSchemaSubjectRows(currentExamSchema, currentExamContext?.key || '').forEach(sub => {
        headHtml += `<th class="p-3 text-center min-w-[90px]">${escapeHtml(sub.name)}<div class="text-[10px] text-slate-400">${sub.maxMarks}/${sub.passMarks}</div></th>`;
    });
    headHtml += `<th class="p-3 text-center min-w-[120px]">Total Attendance</th><th class="p-3 text-center min-w-[120px]">Present Attendance</th></tr>`;
    document.getElementById('marks-table-head').innerHTML = headHtml;

    // Build Rows
    let bodyHtml = '';
    entryStudents.forEach((student, index) => {
        // Find existing marks
        const existingRecord = examResultsCache.find(r => resultMatchesExam(r, examId) && r.studentId === student.id);
        const marksObj = existingRecord ? (existingRecord.marks || {}) : {};

        bodyHtml += `<tr class="border-b hover:bg-white" data-studentid="${student.id}">
            <td class="p-3 font-mono text-gray-500">${index + 1}</td>
            <td class="p-3 font-bold text-gray-800">${escapeHtml(student.name)}</td>`;
        
        getSchemaSubjectRows(currentExamSchema, currentExamContext?.key || '').forEach(sub => {
            const rawMark = marksObj[sub.id] ?? marksObj[sub.name] ?? '';
            const val = rawMark && typeof rawMark === 'object' ? (rawMark.value ?? rawMark.mark ?? '') : rawMark;
            bodyHtml += `<td class="p-2 text-center">
                <input type="text" data-subject="${escapeHtml(sub.id)}" data-subject-name="${escapeHtml(sub.name)}" data-max="${sub.maxMarks}" data-pass="${sub.passMarks}" class="mark-input w-full md:w-20 p-2 text-center border rounded focus:border-indigo-500 focus:bg-indigo-50 outline-none" value="${escapeHtml(String(val ?? ''))}" placeholder="-">
            </td>`;
        });
        const attendance = existingRecord?.attendance || {};
        bodyHtml += `<td class="p-2 text-center"><input type="number" min="0" class="attendance-working w-full md:w-24 p-2 text-center border rounded" value="${escapeHtml(String(attendance.workingDays ?? ''))}" placeholder="0"></td>`;
        bodyHtml += `<td class="p-2 text-center"><input type="number" min="0" class="attendance-present w-full md:w-24 p-2 text-center border rounded" value="${escapeHtml(String(attendance.presentDays ?? ''))}" placeholder="0"></td>`;
        bodyHtml += `</tr>`;
    });
    document.getElementById('marks-table-body').innerHTML = bodyHtml;
    cont.classList.remove('hidden');
    bindMarksValidationEvents();
};
const sanitizeBulkDocId = (value = '') => String(value || '').replace(/[^\w-]/g, '_');
const getBulkTemplateRows = () => {
    const className = document.getElementById('entry-class-select')?.value || '';
    const examId = document.getElementById('entry-exam-select')?.value || '';
    if (!className || !examId || !currentExamSchema) return [];
    const scopedStudents = students
        .filter((s) => s.class === className && (s.academicYear === currentAcademicYear || !s.academicYear))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const subjectRows = getSchemaSubjectRows(currentExamSchema, currentExamContext?.key || '');
    return scopedStudents.map((student) => {
        const row = {
            student_id: student.id,
            student_name: student.name || '',
            class: className,
            total_attendance: '',
            present_attendance: ''
        };
        subjectRows.forEach((subject) => { row[subject.name] = ''; });
        return row;
    });
};
const downloadBlob = (content, filename, type = 'text/plain') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};
const csvEscape = (value = '') => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const downloadMarksTemplate = (asXlsx = false) => {
    if (!currentExamSchema || !document.getElementById('entry-class-select')?.value || !document.getElementById('entry-exam-select')?.value) {
        alert('Select class and exam first.');
        return;
    }
    const rows = getBulkTemplateRows();
    if (!rows.length) return alert('No students found for selected class.');
    const examLabel = (currentExamContext?.label || currentExamContext?.key || 'exam').replace(/\s+/g, '_');
    const classLabel = (document.getElementById('entry-class-select')?.value || 'class').replace(/\s+/g, '_');
    if (!asXlsx) {
        const headers = Object.keys(rows[0]);
        const csv = [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
        downloadBlob(csv, `marks_template_${classLabel}_${examLabel}.csv`, 'text/csv;charset=utf-8');
        return;
    }
    if (!window.XLSX) return alert('Spreadsheet library is still loading. Try again in a moment, or download CSV.');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'marks_template');
    XLSX.writeFile(wb, `marks_template_${classLabel}_${examLabel}.xlsx`, { bookType: 'xlsx' });
};
const updateBulkStatus = (message = '', percent = 0, type = 'info') => {
    const statusEl = document.getElementById('marks-bulk-status');
    const progressEl = document.getElementById('marks-bulk-progress');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `text-xs mt-2 ${type === 'error' ? 'text-red-600 font-semibold' : type === 'success' ? 'text-emerald-700 font-semibold' : 'text-gray-600'}`;
    }
    if (progressEl) {
        progressEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        progressEl.className = `${type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-emerald-500' : 'bg-indigo-500'} h-2 rounded-full transition-all duration-300`;
    }
};
const uploadBulkMarks = async () => {
    const className = document.getElementById('entry-class-select')?.value || '';
    const examId = document.getElementById('entry-exam-select')?.value || '';
    const file = document.getElementById('marks-bulk-file')?.files?.[0];
    if (!className || !examId) return alert('Select class and exam first.');
    if (!file) return alert('Choose a file first.');
    if (!currentExamSchema) return alert('Schema not loaded for selected exam.');
    if (!window.XLSX) return alert('Spreadsheet library is still loading. Try again in a moment.');
    updateBulkStatus('Reading file...', 10);
    const subjectRows = getSchemaSubjectRows(currentExamSchema, currentExamContext?.key || '');
    const subjectNames = subjectRows.map((subject) => subject.name);
    const studentMap = new Map(students.filter((s) => s.class === className && (s.academicYear === currentAcademicYear || !s.academicYear)).map((s) => [String(s.id), s]));
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    updateBulkStatus('Parsing rows...', 30);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const payloads = [];
    const errors = [];
    rows.forEach((row, rowIndex) => {
        const line = rowIndex + 2;
        const studentId = String(row.student_id || row.studentId || row.STUDENT_ID || '').trim();
        if (!studentId) {
            errors.push(`Row ${line}: missing student_id.`);
            return;
        }
        if (!studentMap.has(studentId)) {
            errors.push(`Row ${line}: student_id ${studentId} is not in ${className}.`);
            return;
        }
        const marks = {};
        let hasMark = false;
        const totalAttendance = Number(row.total_attendance ?? row.working_days ?? row.workingDays ?? '');
        const presentAttendance = Number(row.present_attendance ?? row.present_days ?? row.presentDays ?? '');
        subjectRows.forEach((subject) => {
            const raw = row[subject.name] ?? row[subject.id] ?? '';
            const value = raw === undefined || raw === null ? '' : String(raw).trim();
            if (!value) return;
            const upper = value.toUpperCase();
            const numeric = Number(value);
            const valid = upper === 'P' || upper === 'A' || upper === 'AB' || (Number.isFinite(numeric) && numeric >= 0 && numeric <= Number(subject.maxMarks || 0));
            if (!valid) errors.push(`Row ${line}: invalid mark "${value}" for ${subject.name}.`);
            marks[subject.id] = { value, name: subject.name, maxMarks: Number(subject.maxMarks || 0), passMarks: Number(subject.passMarks || 0) };
            hasMark = true;
        });
        if (hasMark) payloads.push({ studentId, marks, attendance: { workingDays: Number.isFinite(totalAttendance) ? totalAttendance : 0, presentDays: Number.isFinite(presentAttendance) ? presentAttendance : 0 } });
    });
    if (errors.length) {
        updateBulkStatus(`Upload stopped: ${errors.slice(0, 3).join(' ')}`, 100, 'error');
        alert(`Please fix these issues and upload again:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ''}`);
        return;
    }
    if (!payloads.length) {
        updateBulkStatus('No valid marks found in file.', 0, 'error');
        return alert('No valid rows found in file.');
    }
    updateBulkStatus(`Saving ${payloads.length} result row(s)...`, 60);
    const batch = writeBatch(db);
    payloads.forEach((entry) => {
        const docId = sanitizeBulkDocId(`${currentExamSchema.id}_${currentExamContext?.key || ''}_${entry.studentId}`);
        const summary = buildResultSummary(entry.marks, subjectRows);
        batch.set(doc(db, `${BASE_PATH}/examResults`, docId), {
            id: docId,
            examId,
            schemaId: currentExamSchema.id,
            examKey: currentExamContext?.key || '',
            examType: currentExamContext?.key || '',
            examLabel: currentExamContext?.label || '',
            classLabel: className,
            academicYear: currentAcademicYear || '',
            studentId: entry.studentId,
            marks: entry.marks,
            attendance: entry.attendance,
            grades: summary.grades,
            totals: summary.totals,
            showMarksToStudents: true,
            updatedAt: Date.now(),
            published: false
        }, { merge: true });
    });
    await batch.commit();
    updateBulkStatus(`Uploaded ${payloads.length} row(s) successfully as draft.`, 100, 'success');
    document.getElementById('marks-bulk-file').value = '';
    loadMarksTable();
};

document.getElementById('entry-exam-select').addEventListener('change', loadMarksTable);
document.getElementById('entry-class-select').addEventListener('change', () => {
    const examSelect = document.getElementById('entry-exam-select');
    renderExamSelectOptions(examSelect, document.getElementById('entry-class-select')?.value || '', currentAcademicYear);
    if (examSelect) examSelect.value = '';
    loadMarksTable();
});
document.getElementById('marks-template-csv-btn')?.addEventListener('click', () => downloadMarksTemplate(false));
document.getElementById('marks-template-xlsx-btn')?.addEventListener('click', () => downloadMarksTemplate(true));
document.getElementById('marks-bulk-upload-btn')?.addEventListener('click', async () => {
    try {
        await uploadBulkMarks();
    } catch (error) {
        console.error('Bulk marks upload failed', error);
        updateBulkStatus(`Bulk upload failed: ${error?.message || 'Check file format and try again.'}`, 100, 'error');
        alert('Bulk upload failed. Check file format and try again.');
    }
});

const validateSingleMarkInput = (input) => {
    if (!input || !currentExamSchema) return true;
    const raw = String(input.value || '').trim().toUpperCase();
    if (!raw) {
        input.classList.remove('input-error');
        return true;
    }
    if (raw === 'A' || raw === 'AB' || raw === 'P') {
        input.classList.remove('input-error');
        return true;
    }
    const asNum = Number(raw);
    const max = Number(input.dataset.max || currentExamSchema.maxMarks || 0);
    const valid = Number.isFinite(asNum) && asNum >= 0 && asNum <= max;
    input.classList.toggle('input-error', !valid);
    return valid;
};
const validateMarksTable = () => {
    const inputs = Array.from(document.querySelectorAll('#marks-table-body .mark-input'));
    const allValid = inputs.every((input) => validateSingleMarkInput(input));
    document.getElementById('marks-validation-note')?.classList.toggle('hidden', allValid);
    return allValid;
};
const bindMarksValidationEvents = () => {
    document.querySelectorAll('#marks-table-body .mark-input').forEach((input) => {
        input.addEventListener('input', () => validateMarksTable());
    });
    validateMarksTable();
};

const saveMarksFromEntry = async (shouldPublish = false) => {
    if(!currentExamSchema || !currentExamContext) return;
    if(!validateMarksTable()) return alert('Please fix invalid marks before saving.');
    
    const rows = document.querySelectorAll('#marks-table-body tr');
    const subjectRows = getSchemaSubjectRows(currentExamSchema, currentExamContext?.key || '');
    const batch = writeBatch(db);
    let operationCount = 0;

    rows.forEach(row => {
        const studentId = row.dataset.studentid;
        const marks = {};
        let hasData = false;

        row.querySelectorAll('.mark-input').forEach(input => {
            const sub = input.dataset.subject;
            const val = input.value.trim();
            if(val !== '') {
                marks[sub] = { value: val, name: input.dataset.subjectName || sub, maxMarks: Number(input.dataset.max || 0), passMarks: Number(input.dataset.pass || 0) };
                hasData = true;
            }
        });

        const docId = `${currentExamSchema.id}_${currentExamContext.key}_${studentId}`.replace(/[^\w-]/g, '_');
        const ref = doc(db, `${BASE_PATH}/examResults`, docId);

        if(hasData) {
            const workingDays = Number(row.querySelector('.attendance-working')?.value || 0);
            const presentDays = Number(row.querySelector('.attendance-present')?.value || 0);
            const summary = buildResultSummary(marks, subjectRows);
            batch.set(ref, {
                examId: currentExamContext.value,
                schemaId: currentExamSchema.id,
                examKey: currentExamContext.key,
                examType: currentExamContext.key,
                examLabel: currentExamContext.label,
                studentId: studentId,
                classLabel: document.getElementById('entry-class-select').value,
                marks: marks,
                attendance: { workingDays: Number.isFinite(workingDays) ? workingDays : 0, presentDays: Number.isFinite(presentDays) ? presentDays : 0 },
                grades: summary.grades,
                totals: summary.totals,
                showMarksToStudents: true,
                published: shouldPublish === true,
                publishedAt: shouldPublish === true ? Date.now() : null,
                academicYear: currentAcademicYear,
                updatedAt: Date.now()
            }, {merge: true});
            operationCount++;
        }
    });

    if(operationCount === 0) return alert("No marks entered to save.");

    const draftBtn = document.getElementById('save-draft-btn');
    const publishBtn = document.getElementById('save-publish-btn');
    const activeBtn = shouldPublish ? publishBtn : draftBtn;
    activeBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
    draftBtn.disabled = true;
    publishBtn.disabled = true;

    try {
        await batch.commit();
        activeBtn.innerHTML = shouldPublish ? `<i class="fas fa-check"></i> Published!` : `<i class="fas fa-check"></i> Draft Saved!`;
        setTimeout(() => {
            draftBtn.innerHTML = `<i class="fas fa-file"></i> Save as Draft`;
            publishBtn.innerHTML = `<i class="fas fa-upload"></i> Publish`;
            draftBtn.disabled = false;
            publishBtn.disabled = false;
        }, 2000);
    } catch (e) {
        console.error(e);
        alert("Failed to save marks. Check internet connection.");
        draftBtn.innerHTML = `<i class="fas fa-file"></i> Save as Draft`;
        publishBtn.innerHTML = `<i class="fas fa-upload"></i> Publish`;
        draftBtn.disabled = false;
        publishBtn.disabled = false;
    }
};
document.getElementById('save-draft-btn')?.addEventListener('click', async () => saveMarksFromEntry(false));
document.getElementById('save-publish-btn')?.addEventListener('click', async () => saveMarksFromEntry(true));

// --- Publish Logic ---
const runPublishAction = async () => {
    if (roleScope !== 'admin') return alert('Only admin can publish results.');
    const selectedAction = document.querySelector('input[name="publish-action"]:checked')?.value || 'publish_now';
    const title = document.getElementById('publish-title').value.trim() || 'Latest Results';
    const publishAcademicYear = document.getElementById('publish-academic-year')?.value || currentAcademicYear;
    const publishExamKey = document.getElementById('publish-exam-select')?.value || '';
    if(selectedAction === 'hide') {
        if(!confirm(`Hide results from students?`)) return;
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), { publishAt: '', countdownStartedAt: '', updatedAt: Date.now() }, {merge: true});
        alert("Results are now hidden.");
        return;
    }
    if(!confirm(`Are you sure you want to proceed with ${selectedAction.replace('_', ' ')}?`)) return;
    
    try {
        const publishAt = document.getElementById('publish-at-input')?.value || new Date().toISOString();
        const isNow = selectedAction === 'publish_now';
        await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), {
            publishAt: isNow ? new Date().toISOString() : publishAt,
            examLabel: title,
            publishAcademicYear,
            publishExamKey,
            locked: false,
            updatedAt: Date.now(),
            countdownStartedAt: isNow ? '' : ((publishAt && new Date(publishAt).getTime() > Date.now()) ? Date.now() : '')
        }, {merge: true});
        alert(isNow ? "Results Published Successfully!" : "Auto publish schedule saved.");
    } catch (e) {
        console.error(e); alert("Action failed.");
    }
};
document.getElementById('run-publish-action-btn')?.addEventListener('click', runPublishAction);
['publish-title', 'publish-at-input'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updatePublishLiveStatus);
    document.getElementById(id)?.addEventListener('change', updatePublishLiveStatus);
});
document.getElementById('publish-academic-year')?.addEventListener('change', renderPublishControls);
const getSelectedSchemaForExamConfig = () => {
    const classLabel = document.getElementById('exam-config-class-select')?.value || '';
    return classLabel ? getSchemaForClass(currentAcademicYear, classLabel) : null;
};
const buildExamConfigRowHtml = (row = {}, subjectRows = []) => {
    const selected = new Set((row.subjects || []).map((value) => String(value || '').toLowerCase()));
    const subjectChecks = subjectRows.length
        ? subjectRows.map((subject) => {
            const checked = selected.size === 0 || selected.has(subject.id.toLowerCase()) || selected.has(subject.name.toLowerCase());
            return `<label class="inline-flex items-center gap-1 mr-3 mb-2 text-xs font-semibold text-slate-600"><input type="checkbox" class="exam-subject-checkbox" value="${escapeHtml(subject.id)}" ${checked ? 'checked' : ''}>${escapeHtml(subject.name)}</label>`;
        }).join('')
        : '<span class="text-xs text-red-500">Save subjects first.</span>';
    return `
    <tr class="exam-config-row border-t" data-key="${escapeHtml(row.key || '')}">
        <td class="p-2"><input type="text" class="exam-config-name-input w-full p-2 border rounded" value="${escapeHtml(row.label || '')}" placeholder="Exam name"></td>
        <td class="p-2"><div class="exam-subject-checkboxes">${subjectChecks}</div></td>
        <td class="p-2"><button type="button" class="exam-config-remove-row text-red-600 font-bold">✕</button></td>
    </tr>`;
};
const renderExamConfigRowsForSelectedClass = () => {
    const body = document.getElementById('exam-config-rows-body');
    if (!body) return;
    const schema = getSelectedSchemaForExamConfig();
    const subjectRows = getSchemaSubjectRows(schema || {});
    if (!schema) {
        body.innerHTML = `<tr><td colspan="3" class="p-3 text-sm text-gray-500 text-center">Select a class with saved subjects.</td></tr>`;
        return;
    }
    const rows = Object.entries(getCustomExamConfigs(schema.examConfigs || {}))
        .map(([key, config]) => ({ key, label: config?.label || DEFAULT_EXAM_DEFS.find((exam) => exam.key === key)?.label || key, subjects: config?.subjects || [] }));
    body.innerHTML = (rows.length ? rows : [{ key: '', label: '', subjects: subjectRows.map((subject) => subject.id) }])
        .map((row) => buildExamConfigRowHtml(row, subjectRows)).join('');
};
const setSetupMode = (mode = 'subjects') => {
    document.getElementById('subject-setup-panel')?.classList.toggle('hidden', mode !== 'subjects');
    document.getElementById('exam-setup-panel')?.classList.toggle('hidden', mode !== 'exams');
};
const renderSubjectRowsEditor = (rows = []) => {
    const body = document.getElementById('subject-rows-body');
    if (!body) return;
    const safeRows = rows.length ? rows : [{ name: '', maxMarks: 100, passMarks: 35 }];
    body.innerHTML = safeRows.map((row) => buildSubjectRowHtml(row)).join('');
};
document.getElementById('subject-class-select')?.addEventListener('change', () => {
    const cls = document.getElementById('subject-class-select').value;
    const schema = resultSchemas.find((entry) => entry.classLabel === cls && (entry.academicYear === currentAcademicYear || !entry.academicYear));
    renderSubjectRowsEditor(getSchemaSubjectRows(schema || {}));
});
document.getElementById('subject-add-row-btn')?.addEventListener('click', () => {
    const body = document.getElementById('subject-rows-body');
    if (!body) return;
    body.insertAdjacentHTML('beforeend', buildSubjectRowHtml({ name: '', maxMarks: 100, passMarks: 35 }));
});
document.getElementById('subject-rows-body')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.subject-remove-row');
    if (!btn) return;
    btn.closest('tr')?.remove();
});
document.getElementById('save-subject-schema-btn')?.addEventListener('click', async () => {
    if (!hasResultAccess) return alert('You do not have access to save schema.');
    const classLabel = document.getElementById('subject-class-select').value;
    if (!classLabel) return alert('Select class.');
    if (!currentAcademicYear) return alert('Set the current academic year first.');
    const subjectRows = Array.from(document.querySelectorAll('#subject-rows-body .subject-row')).map((rowEl, index) => {
        const name = rowEl.querySelector('.subject-name-input')?.value?.trim() || '';
        const total = Number(rowEl.querySelector('.subject-total-input')?.value || 100);
        const pass = Number(rowEl.querySelector('.subject-pass-input')?.value || 35);
        return normalizeSubjectRow({ name, maxMarks: total, passMarks: pass }, index);
    }).filter(Boolean);
    const subjects = subjectRows.map((subject) => subject.name);
    if (!subjects.length) return alert('Enter subjects.');
    if (subjectRows.some((subject) => subject.passMarks > subject.maxMarks)) return alert('Pass mark cannot be greater than total mark.');
    const existingSchema = getSchemaForClass(currentAcademicYear, classLabel) || {};
    const docId = `${currentAcademicYear}_${classLabel}`.replace(/[^\w-]/g, '_');
    await withBusyButton('save-subject-schema-btn', 'Saving...', async () => {
        await setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), {
            classLabel,
            academicYear: currentAcademicYear || '',
            subjects,
            subjectRows,
            examConfigs: getCustomExamConfigs(existingSchema.examConfigs || {}),
            updatedAt: Date.now()
        }, { merge: true });
    });
    alert('Subjects saved for this academic year.');
});
document.querySelectorAll('.setup-mode-radio').forEach((radio) => {
    radio.addEventListener('change', () => setSetupMode(radio.value));
});
document.getElementById('exam-config-class-select')?.addEventListener('change', renderExamConfigRowsForSelectedClass);
document.getElementById('exam-config-add-row-btn')?.addEventListener('click', () => {
    const body = document.getElementById('exam-config-rows-body');
    if (!body) return;
    const schema = getSelectedSchemaForExamConfig();
    if (!schema) return alert('Select a class and save subjects first.');
    body.insertAdjacentHTML('beforeend', buildExamConfigRowHtml({ label: '', subjects: getSchemaSubjectRows(schema).map((subject) => subject.id) }, getSchemaSubjectRows(schema)));
});
document.getElementById('exam-config-rows-body')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.exam-config-remove-row');
    if (!btn) return;
    btn.closest('tr')?.remove();
});
document.getElementById('save-exam-config-btn')?.addEventListener('click', async () => {
    if (!hasResultAccess) return alert('You do not have access to save exams.');
    const classLabel = document.getElementById('exam-config-class-select')?.value || '';
    if (!classLabel) return alert('Select class.');
    if (!currentAcademicYear) return alert('Set the current academic year first.');
    const schema = getSelectedSchemaForExamConfig();
    if (!schema) return alert('Save subjects for this class first.');
    const subjectRows = getSchemaSubjectRows(schema);
    if (!subjectRows.length) return alert('Save subjects for this class first.');
    const nextConfigs = {};
    const usedKeys = new Set();
    Array.from(document.querySelectorAll('#exam-config-rows-body .exam-config-row')).forEach((rowEl) => {
        const label = rowEl.querySelector('.exam-config-name-input')?.value?.trim() || '';
        if (!label) return;
        let key = rowEl.dataset.key || makeExamKey(label);
        if (usedKeys.has(key) || nextConfigs[key]) key = `${key}_${usedKeys.size + 1}`;
        usedKeys.add(key);
        const selectedSubjects = Array.from(rowEl.querySelectorAll('.exam-subject-checkbox:checked')).map((input) => input.value);
        nextConfigs[key] = {
            label,
            subjects: selectedSubjects.length ? selectedSubjects : subjectRows.map((subject) => subject.id),
            showMarksToStudents: true
        };
    });
    if (!Object.keys(nextConfigs).length && !confirm('No additional exams entered. Save with only default exams?')) return;
    const docId = `${currentAcademicYear}_${classLabel}`.replace(/[^\w-]/g, '_');
    await withBusyButton('save-exam-config-btn', 'Saving...', async () => {
        await setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), {
            classLabel,
            academicYear: currentAcademicYear || '',
            subjects: schema.subjects || subjectRows.map((subject) => subject.name),
            subjectRows,
            examConfigs: nextConfigs,
            updatedAt: Date.now()
        }, { merge: true });
    });
    alert('Exams saved for this class.');
});
document.getElementById('schema-list-class-filter')?.addEventListener('change', renderExamSetup);

document.getElementById('exam-list-container')?.addEventListener('click', async (event) => {
    const toggle = event.target.closest('.schema-menu-toggle');
    if (toggle) {
        const id = toggle.dataset.id;
        const targetMenu = document.querySelector(`.schema-menu[data-id="${id}"]`);
        const shouldOpen = targetMenu?.classList.contains('hidden');
        document.querySelectorAll('.schema-menu').forEach((menu) => menu.classList.add('hidden'));
        if (shouldOpen) targetMenu?.classList.remove('hidden');
        return;
    }
    const customExamEditBtn = event.target.closest('.custom-exam-edit-btn');
    if (customExamEditBtn) {
        const schema = resultSchemas.find((entry) => entry.id === customExamEditBtn.dataset.schemaId);
        if (!schema) return;
        document.querySelector('.setup-mode-radio[value="exams"]')?.click();
        const classSelect = document.getElementById('exam-config-class-select');
        if (classSelect) classSelect.value = schema.classLabel || '';
        renderExamConfigRowsForSelectedClass();
        const row = Array.from(document.querySelectorAll('#exam-config-rows-body .exam-config-row')).find((entry) => entry.dataset.key === (customExamEditBtn.dataset.examKey || ''));
        row?.querySelector('.exam-config-name-input')?.focus();
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const customExamDeleteBtn = event.target.closest('.custom-exam-delete-btn');
    if (customExamDeleteBtn) {
        const schema = resultSchemas.find((entry) => entry.id === customExamDeleteBtn.dataset.schemaId);
        const examKey = customExamDeleteBtn.dataset.examKey || '';
        if (!schema || !examKey) return;
        const examLabel = schema.examConfigs?.[examKey]?.label || examKey;
        if (!confirm(`Delete exam "${examLabel}" from ${schema.classLabel}? Existing marks for this exam will remain in Draft/Published lists until deleted separately.`)) return;
        const nextConfigs = getCustomExamConfigs(schema.examConfigs || {});
        delete nextConfigs[examKey];
        await updateDoc(doc(db, `${BASE_PATH}/resultSchemas`, schema.id), { examConfigs: nextConfigs, updatedAt: Date.now() });
        renderExamConfigRowsForSelectedClass();
        return;
    }
    const editBtn = event.target.closest('.schema-edit-btn');
    if (editBtn) {
        const schema = resultSchemas.find((entry) => entry.id === editBtn.dataset.id);
        if (!schema) return;
        const classSelect = document.getElementById('subject-class-select');
        if (classSelect) classSelect.value = schema.classLabel || '';
        document.querySelector('.setup-mode-radio[value="subjects"]')?.click();
        renderSubjectRowsEditor(getSchemaSubjectRows(schema));
        return;
    }
    const delBtn = event.target.closest('.schema-delete-btn');
    if (delBtn) {
        if (!confirm('Delete this class schema?')) return;
        await deleteDoc(doc(db, `${BASE_PATH}/resultSchemas`, delBtn.dataset.id));
    }
});
document.getElementById('apply-prev-year-subjects-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const classLabel = document.getElementById('subject-class-select')?.value;
    if (!classLabel || !currentAcademicYear) return alert('Select class and ensure academic year is active.');
    const start = Number(String(currentAcademicYear).split('-')[0]);
    if (!Number.isFinite(start)) return alert('Invalid academic year format.');
    const prevYear = `${start - 1}-${start}`;
    const prevSchema = resultSchemas.find((entry) => entry.classLabel === classLabel && entry.academicYear === prevYear);
    if (!prevSchema) return alert(`No previous year schema found for ${classLabel} in ${prevYear}.`);
    if (!confirm(`Apply subjects from ${prevYear} to current year (${currentAcademicYear}) for ${classLabel}?`)) return;
    const docId = `${currentAcademicYear}_${classLabel}`.replace(/[^\w-]/g, '_');
    await setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), {
        classLabel,
        academicYear: currentAcademicYear,
        subjects: prevSchema.subjects || [],
        subjectRows: getSchemaSubjectRows(prevSchema),
        examConfigs: prevSchema.examConfigs || {},
        updatedAt: Date.now()
    }, { merge: true });
    alert('Previous year subjects applied.');
});
document.getElementById('add-grade-rule-row-btn')?.addEventListener('click', () => {
    resultCenterSettings.gradeRules = [...(resultCenterSettings.gradeRules || []), { grade: '', min: 0, max: 0 }];
    renderGradeRules();
});
document.getElementById('save-grade-rules-btn')?.addEventListener('click', async () => {
    const grades = Array.from(document.querySelectorAll('.grade-grade'));
    const rules = grades.map((gradeInput, idx) => ({ grade: gradeInput.value.trim(), min: Number(document.querySelector(`.grade-min[data-index="${idx}"]`)?.value || 0), max: Number(document.querySelector(`.grade-max[data-index="${idx}"]`)?.value || 0) })).filter((r) => r.grade);
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), { gradeRules: rules, gradeScaleTotal: Number(document.getElementById('grade-scale-select')?.value || 100) === 50 ? 50 : 100 }, { merge: true });
    alert('Grade rules saved.');
});
document.getElementById('save-blocked-classes-btn')?.addEventListener('click', async () => {
    const blocked = Array.from(document.querySelectorAll('.blocked-class-checkbox:checked')).map((el) => el.value);
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), { blockedClasses: blocked }, { merge: true });
    alert('Blocked classes saved.');
});
document.getElementById('export-snapshot-all-btn')?.addEventListener('click', () => {
    const payload = { exportedAt: new Date().toISOString(), academicYear: currentAcademicYear, settings: resultCenterSettings, schemas: resultSchemas, results: examResultsCache };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `result_snapshot_${currentAcademicYear || 'all'}.json`; a.click(); URL.revokeObjectURL(url);
});
document.getElementById('export-snapshot-classwise-btn')?.addEventListener('click', () => {
    const rows = examResultsCache.filter((row) => !currentAcademicYear || row.academicYear === currentAcademicYear || !row.academicYear);
    const classMap = {};
    rows.forEach((row) => {
        const cls = row.classLabel || 'unknown';
        if (!classMap[cls]) classMap[cls] = [];
        classMap[cls].push(row);
    });
    Object.entries(classMap).forEach(([cls, items]) => {
        const payload = { exportedAt: new Date().toISOString(), academicYear: currentAcademicYear, classLabel: cls, results: items };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `result_snapshot_${(cls || 'unknown').replace(/\s+/g, '_')}.json`; a.click(); URL.revokeObjectURL(url);
    });
});
document.getElementById('run-auto-promotion-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const targetAcademicYear = document.getElementById('promotion-target-year')?.value || '';
    if (!targetAcademicYear) return alert('Select next academic year first.');
    const annualRows = examResultsCache.filter((row) => row.published === true && detectAnnualResultRow(row));
    if (!annualRows.length) return alert('No annual published results found.');
    if (!confirm(`Annual published results found: ${annualRows.length}. Run auto promotion now?`)) return;
    const updates = [];
    const promotionDecisions = [];
    annualRows.forEach((row) => {
        if (!isPassFromMarks(row)) return;
        const student = students.find((entry) => entry.id === row.studentId);
        if (!student) return;
        const nextClass = getNextClassLabel(student.class || row.classLabel || '');
        if (!nextClass) return;
        updates.push(updateDoc(doc(db, `${BASE_PATH}/students`, student.id), {
            class: nextClass,
            academicYear: targetAcademicYear,
            promotedFrom: student.class || row.classLabel || '',
            promotedAt: new Date().toISOString()
        }));
        promotionDecisions.push(setDoc(doc(collection(db, `${BASE_PATH}/promotionDecisions`)), {
            studentId: student.id,
            studentName: student.name || '',
            fromClass: student.class || row.classLabel || '',
            toClass: nextClass,
            basedOn: 'annual',
            basedOnResultId: row.id,
            academicYear: targetAcademicYear,
            createdAt: new Date().toISOString()
        }));
    });
    if (!updates.length) return alert('No eligible PASS students found for promotion.');
    await Promise.all([...updates, ...promotionDecisions]);
    alert(`Auto promotion completed for ${updates.length} students.`);
});
document.getElementById('preview-promotion-btn')?.addEventListener('click', () => {
    const container = document.getElementById('promotion-preview-list');
    if (!container) return;
    const annualRows = examResultsCache.filter((row) => row.published === true && detectAnnualResultRow(row));
    const summaryMap = new Map(classes.map((cls) => [cls, { pass: 0, fail: 0, total: 0, boys: 0, girls: 0, nextClass: getNextClassLabel(cls) || '-' }]));
    annualRows.forEach((row) => {
        const student = students.find((entry) => entry.id === row.studentId);
        const fromClass = student?.class || row.classLabel || '';
        if (!fromClass || !summaryMap.has(fromClass)) return;
        const passed = isPassFromMarks(row);
        const gender = String(student?.gender || '').toLowerCase();
        const item = summaryMap.get(fromClass);
        item.total += 1;
        if (gender.startsWith('m') || gender.includes('boy')) item.boys += 1;
        if (gender.startsWith('f') || gender.includes('girl')) item.girls += 1;
        if (passed) item.pass += 1;
        else item.fail += 1;
    });
    container.innerHTML = Array.from(summaryMap.entries()).map(([cls, stat]) => `
        <div class="border rounded-lg p-3 bg-white">
            <div class="font-bold mb-2">${escapeHtml(cls)}</div>
            <table class="w-full text-xs border">
                <tr><td class="border p-1">Total Students</td><td class="border p-1 font-bold">${stat.total}</td></tr>
                <tr><td class="border p-1">Boys</td><td class="border p-1 font-bold">${stat.boys}</td></tr>
                <tr><td class="border p-1">Girls</td><td class="border p-1 font-bold">${stat.girls}</td></tr>
                <tr><td class="border p-1">Pass</td><td class="border p-1 font-bold text-emerald-700">${stat.pass}</td></tr>
                <tr><td class="border p-1">Fail</td><td class="border p-1 font-bold text-red-700">${stat.fail}</td></tr>
                <tr><td class="border p-1">Next Class</td><td class="border p-1 font-bold">${escapeHtml(stat.nextClass)}</td></tr>
            </table>
        </div>
    `).join('');
});
document.getElementById('copy-prev-year-schema-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const currentStartYear = Number(String(currentAcademicYear || '').split('-')[0]);
    if (!Number.isFinite(currentStartYear)) return alert('Current academic year invalid.');
    const previousYear = `${currentStartYear - 1}-${currentStartYear}`;
    const previousSchemas = resultSchemas.filter((entry) => entry.academicYear === previousYear);
    if (!previousSchemas.length) return alert('No previous year schema found.');
    await Promise.all(previousSchemas.map((schema) => {
        const docId = `${currentAcademicYear}_${schema.classLabel}`.replace(/[^\w-]/g, '_');
        return setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), {
            ...schema,
            id: undefined,
            academicYear: currentAcademicYear,
            updatedAt: Date.now()
        }, { merge: true });
    }));
    alert(`Copied ${previousSchemas.length} schemas from ${previousYear}.`);
});
document.getElementById('open-schema-carryforward-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const currentStartYear = Number(String(currentAcademicYear || '').split('-')[0]);
    if (!Number.isFinite(currentStartYear)) return alert('Current academic year invalid.');
    const previousYear = `${currentStartYear - 1}-${currentStartYear}`;
    const previousSchemas = resultSchemas.filter((entry) => entry.academicYear === previousYear);
    if (!previousSchemas.length) return alert('No previous year schema found.');
    const host = document.getElementById('schema-carryforward-list');
    if (!host) return;
    host.innerHTML = previousSchemas.map((schema) => `<label class="flex items-center gap-2 border rounded-lg p-2"><input type="checkbox" class="carry-schema-checkbox" value="${escapeHtml(schema.id)}" checked><span>${escapeHtml(schema.classLabel)} (${escapeHtml(previousYear)})</span></label>`).join('') + `<button id="save-carryforward-selection-btn" class="bg-indigo-100 text-indigo-700 py-2 px-3 rounded font-bold">Save Selected</button>`;
});
document.getElementById('schema-carryforward-list')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('#save-carryforward-selection-btn');
    if (!btn) return;
    const currentStartYear = Number(String(currentAcademicYear || '').split('-')[0]);
    const previousYear = `${currentStartYear - 1}-${currentStartYear}`;
    const previousSchemas = resultSchemas.filter((entry) => entry.academicYear === previousYear);
    const ids = Array.from(document.querySelectorAll('.carry-schema-checkbox:checked')).map((el) => el.value);
    const selected = previousSchemas.filter((schema) => ids.includes(schema.id));
    if (!selected.length) return alert('Select at least one class.');
    await Promise.all(selected.map((schema) => {
        const docId = `${currentAcademicYear}_${schema.classLabel}`.replace(/[^\w-]/g, '_');
        return setDoc(doc(db, `${BASE_PATH}/resultSchemas`, docId), { ...schema, id: undefined, academicYear: currentAcademicYear, updatedAt: Date.now() }, { merge: true });
    }));
    alert(`Copied ${selected.length} schemas from ${previousYear}.`);
});

// --- PDF Report Generation ---
const getConfiguredGrade = (total = 0, maximum = 0) => {
    if (!maximum || Number(total || 0) === 0) return '-';
    const scale = Number(resultCenterSettings.gradeScaleTotal || 100) === 50 ? 50 : 100;
    const score = (Number(total || 0) / Number(maximum || 1)) * scale;
    const rules = Array.isArray(resultCenterSettings.gradeRules) && resultCenterSettings.gradeRules.length ? resultCenterSettings.gradeRules : [];
    const matched = rules.find((rule) => score >= Number(rule.min || 0) && score <= Number(rule.max || 0));
    if (matched?.grade) return matched.grade;
    if (scale === 50) {
        if (score >= 45) return 'A+';
        if (score >= 40) return 'A';
        if (score >= 30) return 'B';
        if (score >= 18) return 'C';
        return 'FAIL';
    }
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 60) return 'B';
    if (score >= 35) return 'C';
    return 'FAIL';
};
const compareAdmissionNo = (a = {}, b = {}) => String(a.student.adm || a.student.admissionNo || a.student.uid || '').localeCompare(String(b.student.adm || b.student.admissionNo || b.student.uid || ''), undefined, { numeric: true, sensitivity: 'base' });
const genderRank = (student = {}) => {
    const gender = String(student.gender || '').trim().toLowerCase();
    if (gender.startsWith('m') || gender.includes('boy')) return 0;
    if (gender.startsWith('f') || gender.includes('girl')) return 1;
    return 2;
};
const sortReportRows = (rows = [], order = 'rank') => {
    const alpha = (a, b) => String(a.student.name || '').localeCompare(String(b.student.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
        if (order === 'admission') return compareAdmissionNo(a, b) || alpha(a, b);
        if (order === 'gender') return genderRank(a.student) - genderRank(b.student) || alpha(a, b);
        if (order === 'alpha') return alpha(a, b);
        return (a.rank || 9999) - (b.rank || 9999) || alpha(a, b);
    });
};
const getAttendanceLabel = (row = {}) => {
    const attendance = row?.attendance || {};
    if (attendance.presentDays !== undefined || attendance.workingDays !== undefined) return `${attendance.presentDays ?? '-'}/${attendance.workingDays ?? '-'}`;
    return '-';
};
document.getElementById('generate-class-report-btn').addEventListener('click', () => {
    const examId = document.getElementById('report-exam-select').value;
    const className = document.getElementById('report-class-select').value;
    const reportYear = document.getElementById('report-academic-year')?.value?.trim() || currentAcademicYear || '';
    const reportOrder = document.getElementById('report-order-select')?.value || 'rank';
    
    if(!reportYear || !className || !examId) return alert('Select Academic Year, Class and Exam.');
    
    const examContext = getExamContext(examId, className, reportYear);
    const exam = examContext?.schema;
    const classStudents = students.filter(s => s.class === className && (!reportYear || s.academicYear === reportYear || !s.academicYear));
    
    if(!examContext || !exam || classStudents.length === 0) return alert('Invalid data or no students.');

    const reportSubjects = getSchemaSubjectRows(exam, examContext?.key || '');
    if (!reportSubjects.length) return alert('No subjects configured for this exam.');

    const resultRows = classStudents.map((student) => {
        const resultRecord = examResultsCache.find(r => resultMatchesExam(r, examId) && r.studentId === student.id && (!reportYear || r.academicYear === reportYear || !r.academicYear) && r.published === true);
        const marks = resultRecord ? (resultRecord.marks || {}) : {};
        let total = 0;
        let maximum = 0;
        let isFail = !resultRecord;
        const subjectValues = reportSubjects.map((sub) => {
            maximum += Number(sub.maxMarks || 0);
            const m = getResultMark(marks, sub);
            const upper = String(m || '').trim().toUpperCase();
            const num = Number(m);
            if (upper === 'P') return 'P';
            if (Number.isFinite(num)) {
                total += num;
                if (num < Number(sub.passMarks || 0)) isFail = true;
                return num;
            }
            isFail = true;
            return m || '-';
        });
        const passStatus = isFail ? 'FAIL' : 'PASS';
        const storedTotal = resultRecord?.totals?.obtained;
        const storedMax = resultRecord?.totals?.maximum;
        const finalTotal = Number.isFinite(Number(storedTotal)) ? Number(storedTotal) : total;
        const finalMax = Number.isFinite(Number(storedMax)) && Number(storedMax) > 0 ? Number(storedMax) : maximum;
        return {
            student,
            resultRecord,
            subjectValues,
            total: finalTotal,
            maximum: finalMax,
            passStatus,
            grade: getConfiguredGrade(finalTotal, finalMax),
            attendance: getAttendanceLabel(resultRecord)
        };
    });

    const rankable = [...resultRows].sort((a, b) => b.total - a.total || String(a.student.name || '').localeCompare(String(b.student.name || '')));
    let lastScore = null;
    let lastRank = 0;
    rankable.forEach((row, index) => {
        if (lastScore === null || row.total !== lastScore) lastRank = index + 1;
        row.rank = lastRank;
        lastScore = row.total;
    });
    const orderedRows = sortReportRows(resultRows, reportOrder);

    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = docPdf.internal.pageSize.getWidth();
    const instName = institutionConfig.appName || 'Institution Name';
    const instPlace = institutionConfig.place || '';
    const instReg = institutionConfig.regNo || '';
    const orderLabels = { rank: 'Rank Order', admission: 'Admission No Order', gender: 'Boys First, then Girls', alpha: 'Alphabetical Order' };

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(15);
    docPdf.text(instName, pageWidth / 2, 12, { align: 'center' });
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    const subTitle = [instPlace, instReg ? `Reg No: ${instReg}` : ''].filter(Boolean).join(' | ');
    if (subTitle) docPdf.text(subTitle, pageWidth / 2, 18, { align: 'center' });
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(10);
    docPdf.text(`Class: ${className}`, 14, 27);
    docPdf.text(`Exam: ${examContext.label}`, 80, 27);
    docPdf.text(`Academic Year: ${reportYear}`, 150, 27);
    docPdf.text(`Order: ${orderLabels[reportOrder] || orderLabels.rank}`, 225, 27);

    const headers = ['No', 'Adm No', 'Student Name', ...reportSubjects.map((subject) => `${subject.name} (${subject.maxMarks})`), 'Total', 'Result', 'Attendance', 'Rank'];
    const resultColIndex = headers.indexOf('Result');
    const body = orderedRows.map((row, index) => [
        index + 1,
        row.student.adm || row.student.admissionNo || row.student.uid || '-',
        row.student.name || '-',
        ...row.subjectValues,
        `${row.total}/${row.maximum}`,
        row.passStatus,
        row.attendance,
        row.rank || '-'
    ]);

    docPdf.autoTable({
        startY: 34,
        head: [headers],
        body,
        styles: { fontSize: reportSubjects.length > 8 ? 6.5 : 7.5, cellPadding: 1.5, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 18 }, 2: { cellWidth: 38 } },
        didParseCell: (data) => {
            if (data.section !== 'body') return;
            const rowMeta = orderedRows[data.row.index];
            if (rowMeta?.passStatus === 'FAIL' && data.column.index === resultColIndex) {
                data.cell.styles.textColor = [220, 38, 38];
                data.cell.styles.fontStyle = 'bold';
            }
        },
        didDrawPage: () => {
            const pageCount = docPdf.internal.getNumberOfPages();
            docPdf.setFontSize(8);
            docPdf.setTextColor(120);
            docPdf.text(`Page ${pageCount}`, pageWidth - 20, docPdf.internal.pageSize.getHeight() - 8);
            docPdf.setTextColor(0);
        }
    });

    docPdf.save(`Results_${reportYear}_${className}_${examContext.label.replace(/\s+/g, '_')}_${reportOrder}.pdf`);
});

['report-academic-year', 'report-class-select', 'report-exam-select', 'report-order-select'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
        if (id === 'report-academic-year' || id === 'report-class-select') renderExamSelectOptions(document.getElementById('report-exam-select'), document.getElementById('report-class-select')?.value || '', document.getElementById('report-academic-year')?.value || currentAcademicYear, '-- Choose Exam --', true);
        updateReportPreview();
    });
    document.getElementById(id)?.addEventListener('input', updateReportPreview);
});
let editingResultId = '';
const getSchemaForResultRow = (row = {}) => resultSchemas.find((schema) => schema.id === row.schemaId) || getSchemaForClass(row.academicYear || currentAcademicYear, row.classLabel || '');
const validateMarkValueForMax = (value = '', maxMarks = 0) => {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return true;
    if (raw === 'P' || raw === 'A' || raw === 'AB') return true;
    const asNum = Number(raw);
    return Number.isFinite(asNum) && asNum >= 0 && asNum <= Number(maxMarks || 0);
};
const openResultEditModal = (resultId = '') => {
    const row = examResultsCache.find((entry) => entry.id === resultId);
    if (!row) return alert('Result record not found.');
    const schema = getSchemaForResultRow(row);
    if (!schema) return alert('Schema not found for this result.');
    const subjects = getSchemaSubjectRows(schema, row.examKey || parseExamValue(row.examId || '').examKey);
    if (!subjects.length) return alert('No subjects found for this result.');
    editingResultId = resultId;
    const modal = document.getElementById('result-edit-modal');
    const fields = document.getElementById('result-edit-fields');
    document.getElementById('result-edit-error')?.classList.add('hidden');
    const summary = document.getElementById('result-edit-summary');
    if (summary) summary.textContent = `${getStudentNameById(row.studentId)} • ${getExamNameById(row.examId, row)} • ${row.classLabel || ''}`;
    if (fields) {
        fields.innerHTML = subjects.map((subject) => {
            const existing = row.marks?.[subject.id] ?? row.marks?.[subject.name] ?? '';
            const value = getStoredMarkValue(existing);
            return `<label class="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-2 items-center border rounded-lg p-3 bg-slate-50">
                <span class="font-semibold text-sm text-slate-700">${escapeHtml(subject.name)} <span class="text-xs text-slate-400">(${subject.maxMarks}/${subject.passMarks})</span></span>
                <input type="text" class="result-edit-mark-input p-2 border rounded text-center" data-subject="${escapeHtml(subject.id)}" data-subject-name="${escapeHtml(subject.name)}" data-max="${subject.maxMarks}" data-pass="${subject.passMarks}" value="${escapeHtml(value)}" placeholder="Mark / P / A">
            </label>`;
        }).join('');
    }
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
};
const closeResultEditModal = () => {
    editingResultId = '';
    const modal = document.getElementById('result-edit-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
};
const saveResultEditModal = async () => {
    const row = examResultsCache.find((entry) => entry.id === editingResultId);
    if (!row) return;
    const inputs = Array.from(document.querySelectorAll('#result-edit-fields .result-edit-mark-input'));
    const invalid = inputs.find((input) => !validateMarkValueForMax(input.value, input.dataset.max));
    const errorEl = document.getElementById('result-edit-error');
    if (invalid) {
        invalid.classList.add('input-error');
        if (errorEl) {
            errorEl.textContent = `Invalid mark for ${invalid.dataset.subjectName}. Use 0-${invalid.dataset.max}, P for pass, or A for absent.`;
            errorEl.classList.remove('hidden');
        }
        return;
    }
    const marks = {};
    inputs.forEach((input) => {
        const value = input.value.trim();
        if (!value) return;
        marks[input.dataset.subject] = { value, name: input.dataset.subjectName || input.dataset.subject, maxMarks: Number(input.dataset.max || 0), passMarks: Number(input.dataset.pass || 0) };
    });
    if (!Object.keys(marks).length) return alert('Enter at least one mark.');
    const schema = getSchemaForResultRow(row);
    const subjectRows = getSchemaSubjectRows(schema || {}, row.examKey || parseExamValue(row.examId || '').examKey);
    const summary = buildResultSummary(marks, subjectRows);
    await withBusyButton('result-edit-save', 'Saving...', async () => {
        await updateDoc(doc(db, `${BASE_PATH}/examResults`, editingResultId), { marks, grades: summary.grades, totals: summary.totals, updatedAt: Date.now() });
    });
    closeResultEditModal();
};
const handleResultRowAction = async (event, expectedPublished = false) => {
    if (roleScope !== 'admin') return;
    const menuToggle = event.target.closest('.result-row-menu-toggle');
    if (menuToggle) {
        const id = menuToggle.dataset.id;
        const menu = document.querySelector(`.result-row-menu[data-id="${id}"]`);
        const shouldOpen = menu?.classList.contains('hidden');
        document.querySelectorAll('.result-row-menu').forEach((entry) => entry.classList.add('hidden'));
        if (shouldOpen) menu?.classList.remove('hidden');
        return;
    }
    const editBtn = event.target.closest('.edit-result-btn');
    const targetBtn = event.target.closest('.publish-toggle-btn');
    const deleteBtn = event.target.closest('.delete-result-btn');
    if (editBtn) return openResultEditModal(editBtn.dataset.id);
    if (targetBtn) {
        const publish = targetBtn.dataset.next === 'published';
        await updateDoc(doc(db, `${BASE_PATH}/examResults`, targetBtn.dataset.id), { published: publish, publishedAt: publish ? Date.now() : null, updatedAt: Date.now() });
    }
    if (deleteBtn && confirm(expectedPublished ? 'Delete this published result?' : 'Delete this draft?')) await deleteDoc(doc(db, `${BASE_PATH}/examResults`, deleteBtn.dataset.id));
};
document.getElementById('result-edit-cancel')?.addEventListener('click', closeResultEditModal);
document.getElementById('result-edit-save')?.addEventListener('click', saveResultEditModal);
document.getElementById('result-edit-fields')?.addEventListener('input', (event) => {
    const input = event.target.closest('.result-edit-mark-input');
    if (!input) return;
    input.classList.toggle('input-error', !validateMarkValueForMax(input.value, input.dataset.max));
});
document.getElementById('published-results-table')?.addEventListener('click', async (event) => handleResultRowAction(event, true));
document.getElementById('draft-results-table')?.addEventListener('click', async (event) => handleResultRowAction(event, false));
document.getElementById('published-class-filter')?.addEventListener('change', () => {
    const classValue = document.getElementById('published-class-filter')?.value || '';
    const examSelect = document.getElementById('published-exam-filter');
    renderExamSelectOptions(examSelect, classValue, currentAcademicYear, 'All Exams');
    if (examSelect) examSelect.value = '';
    renderPublishedDraftTables();
});
document.getElementById('draft-class-filter')?.addEventListener('change', () => {
    const classValue = document.getElementById('draft-class-filter')?.value || '';
    const examSelect = document.getElementById('draft-exam-filter');
    renderExamSelectOptions(examSelect, classValue, currentAcademicYear, 'All Exams');
    if (examSelect) examSelect.value = '';
    renderPublishedDraftTables();
});
document.getElementById('published-exam-filter')?.addEventListener('change', renderPublishedDraftTables);
document.getElementById('draft-exam-filter')?.addEventListener('change', renderPublishedDraftTables);
document.getElementById('published-order-filter')?.addEventListener('change', renderPublishedDraftTables);
document.getElementById('draft-order-filter')?.addEventListener('change', renderPublishedDraftTables);
document.getElementById('published-bulk-delete-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const ids = Array.from(document.querySelectorAll('.published-select-checkbox:checked')).map((el) => el.value);
    if (!ids.length) return alert('Select at least one result.');
    if (!confirm(`Delete ${ids.length} published result(s)?`)) return;
    await withBusyButton('published-bulk-delete-btn', 'Deleting...', async () => {
        await Promise.all(ids.map((id) => deleteDoc(doc(db, `${BASE_PATH}/examResults`, id))));
        notify(`Deleted ${ids.length} published result(s).`);
    });
});
document.getElementById('draft-bulk-publish-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const ids = Array.from(document.querySelectorAll('.draft-select-checkbox:checked')).map((el) => el.value);
    if (!ids.length) return alert('Select at least one draft result.');
    await withBusyButton('draft-bulk-publish-btn', 'Publishing...', async () => {
        await Promise.all(ids.map((id) => updateDoc(doc(db, `${BASE_PATH}/examResults`, id), { published: true, publishedAt: Date.now(), updatedAt: Date.now() })));
        notify(`Published ${ids.length} draft result(s).`);
    });
});
document.getElementById('draft-bulk-delete-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const ids = Array.from(document.querySelectorAll('.draft-select-checkbox:checked')).map((el) => el.value);
    if (!ids.length) return alert('Select at least one draft result.');
    if (!confirm(`Delete ${ids.length} draft result(s)?`)) return;
    await withBusyButton('draft-bulk-delete-btn', 'Deleting...', async () => {
        await Promise.all(ids.map((id) => deleteDoc(doc(db, `${BASE_PATH}/examResults`, id))));
        notify(`Deleted ${ids.length} draft result(s).`);
    });
});


document.getElementById('save-promotion-map-btn')?.addEventListener('click', async () => {
    const map = {};
    Array.from(document.querySelectorAll('.promotion-map-input')).forEach((input) => {
        const fromClass = String(input.dataset.class || '').trim();
        const toClass = String(input.value || '').trim();
        if (fromClass && toClass) map[fromClass] = toClass;
    });
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), { classProgressionMap: map }, { merge: true });
    alert('Promotion mapping saved.');
});
document.getElementById('save-result-visibility-btn')?.addEventListener('click', async () => {
    if (roleScope !== 'admin') return;
    const map = {};
    document.querySelectorAll('.result-visibility-checkbox').forEach((el) => {
        const key = el.dataset.key;
        const type = el.dataset.type || 'marks';
        if (!map[key]) map[key] = { marks: true, grades: true };
        map[key][type] = el.checked;
    });
    await setDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), { resultVisibilityMap: map }, { merge: true });
    alert('Student result visibility settings saved.');
});
document.getElementById('result-visibility-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('.visibility-class-card');
    if (!card) return;
    const cls = card.dataset.class || '';
    const modal = document.getElementById('visibility-modal');
    const body = document.getElementById('visibility-modal-body');
    const title = document.getElementById('visibility-modal-title');
    if (!modal || !body || !title) return;
    const map = resultCenterSettings.resultVisibilityMap || {};
    title.textContent = `Visibility - ${cls}`;
    const schemas = resultSchemas.filter((schema) => schema.classLabel === cls && (schema.academicYear === currentAcademicYear || !schema.academicYear));
    const rows = schemas.flatMap((schema) => getExamOptionsForClass(schema.classLabel, currentAcademicYear).map((exam) => {
        const key = buildVisibilityKey(cls, exam.key);
        const visibility = map[key] && typeof map[key] === 'object' ? map[key] : { marks: map[key] !== false, grades: map[key] !== false };
        return `<div class="border rounded p-2"><div class="text-sm font-semibold">${escapeHtml(exam.label)}</div><div class="flex gap-4 text-sm mt-1"><label><input type="checkbox" class="result-visibility-checkbox" data-key="${escapeHtml(key)}" data-type="marks" ${visibility.marks ? 'checked' : ''}> Mark</label><label><input type="checkbox" class="result-visibility-checkbox" data-key="${escapeHtml(key)}" data-type="grades" ${visibility.grades ? 'checked' : ''}> Grade</label></div></div>`;
    }));
    body.innerHTML = rows.join('') || '<div class="text-sm text-gray-500">No exams found.</div>';
    modal.classList.remove('hidden');
});
document.getElementById('visibility-modal-close')?.addEventListener('click', () => document.getElementById('visibility-modal')?.classList.add('hidden'));
const bindSelectToggle = (btnId, checkboxClass) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
        const btn = document.getElementById(btnId);
        const boxes = Array.from(document.querySelectorAll(`.${checkboxClass}`));
        const allChecked = boxes.length && boxes.every((box) => box.checked);
        boxes.forEach((box) => { box.checked = !allChecked; });
        if (btn) btn.textContent = allChecked ? 'Select All' : 'Deselect All';
    });
};
bindSelectToggle('published-select-toggle-btn', 'published-select-checkbox');
bindSelectToggle('draft-select-toggle-btn', 'draft-select-checkbox');

document.getElementById('grade-scale-select')?.addEventListener('change', () => {
    resultCenterSettings.gradeRules = [];
    renderGradeRules();
});

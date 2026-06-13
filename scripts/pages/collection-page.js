import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDocs, writeBatch, setDoc, query, where, getDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE } from '../../config/app-config.js';
import { BASE_PATH, applyInstitutionBranding, buildEmptyState, enableSmartSelectWindowing, escapeHtml, fitTextToContainer, formatCurrency, formatMonthLabel, hardenExternalLinks, registerServiceWorker, renderVersionInfo } from '../shared/app-common.js';
import { appLog } from '../shared/logger.js';
import { showToast } from '../shared/toaster.js';
import { initCollectionEntryModule } from './collection/entry-module.js';
import { initCollectionHistoryModule } from './collection/history-module.js';
import { initCollectionReportsModule } from './collection/reports-module.js';
import { initCollectionUploadModule } from './collection/upload-module.js';
import { initCollectionSettingsModule } from './collection/settings-module.js';

window.AppSession?.guardStaffPageAccess?.('collection');

appLog('info', 'collection.bootstrap', 'Collection page loaded');
window.notifyApp = (message = '', type = 'info') => showToast(message, type);
initCollectionEntryModule();
initCollectionHistoryModule();
initCollectionReportsModule();
initCollectionUploadModule();
initCollectionSettingsModule();

registerServiceWorker();
hardenExternalLinks();
enableSmartSelectWindowing(document, { visibleCount: 6 });
window.addEventListener('load', () => {
    const loader = document.getElementById('loading-screen');
    if (!loader) return;
    loader.style.opacity = '0';
    setTimeout(() => { loader.style.display = 'none'; }, 300);
});
const syncCollectionPwaMode = () => {
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
    document.body.classList.toggle('pwa-standalone', Boolean(isStandalone));
};
syncCollectionPwaMode();
window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', syncCollectionPwaMode);

const NON_TOGGLE_TAB_TARGETS = new Set(['dashboard-page']);
const getSessionCollectorKey = () => {
    const access = window.AppSession?.getStaffAccess?.() || {};
    const fallback = window.AppSession?.getStaffEmail?.() || '';
    return String(access.userKey || access.loginId || fallback || '').trim().toLowerCase();
};
const getTabPrefsStorageKey = () => `collector_tab_prefs_${getSessionCollectorKey() || 'default'}`;
const readTabPrefsFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getTabPrefsStorageKey()) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
};
const writeTabPrefsToLocal = (prefs = {}) => {
    localStorage.setItem(getTabPrefsStorageKey(), JSON.stringify(prefs));
};

const getCollectorPrefsRef = () => doc(db, `${BASE_PATH}/collectorPreferences`, getSessionCollectorKey() || 'default');
const readTabPrefsFromCloud = async () => {
    try {
        const snap = await getDoc(getCollectorPrefsRef());
        if (!snap.exists()) return null;
        const prefs = snap.data()?.menuTabs;
        return prefs && typeof prefs === 'object' ? prefs : null;
    } catch (error) {
        console.warn('Unable to read cloud menu settings.', error);
        return null;
    }
};
const writeTabPrefsToCloud = async (prefs = {}) => {
    try {
        await setDoc(getCollectorPrefsRef(), {
            userKey: getSessionCollectorKey(),
            menuTabs: prefs,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (error) {
        console.warn('Unable to save cloud menu settings.', error);
    }
};


// Hamburger Menu Logic
const mobileToggle = document.getElementById('mobile-menu-btn');
const navMenu = document.querySelector('.nav-menu');
const toggleIcon = mobileToggle.querySelector('i.fas.fa-bars') || mobileToggle.querySelector('i');
const setMobileMenuState = (isOpen) => {
    navMenu.classList.toggle('active', isOpen);
    mobileToggle.classList.toggle('active-toggle', isOpen);
    mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

mobileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setMobileMenuState(!navMenu.classList.contains('active'));
});

document.addEventListener('click', (e) => {
    if (!navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
        setMobileMenuState(false);
    }
});

// TABS LOGIC
const links = Array.from(document.querySelectorAll('.tab-link'));
const pages = Array.from(document.querySelectorAll('.page-content'));
const defaultTabId = 'dashboard-page';
const linkItems = links.map((link) => ({ link, target: link.dataset.target, listItem: link.closest('li'), isBottomNav: link.dataset.bottomNav === 'true' }));
const getToggleableLinks = () => linkItems.filter((item) => item.target && !item.isBottomNav && !NON_TOGGLE_TAB_TARGETS.has(item.target));
const applyTabVisibilityPreferences = () => {
    const prefs = readTabPrefsFromLocal();
    getToggleableLinks().forEach(({ target, listItem }) => {
        const isVisible = prefs[target] !== false;
        listItem?.classList.toggle('hidden', !isVisible);
    });
    const currentTarget = getTargetFromHash(window.location.hash);
    const currentLink = getLinkForTarget(currentTarget);
    if (currentLink && currentLink.closest('li')?.classList.contains('hidden')) {
        activateTab(defaultTabId);
    }
};

const getLinkForTarget = (targetId) => links.find(link => link.dataset.target === targetId);
const getTargetFromHash = (hashValue) => {
    if (!hashValue) return defaultTabId;
    const normalizedHash = hashValue.startsWith('#') ? hashValue : `#${hashValue}`;
    const matchedLink = links.find(link => link.getAttribute('href') === normalizedHash);
    return matchedLink?.dataset.target || defaultTabId;
};

const activateTab = (targetId, { updateHash = true } = {}) => {
    const safeTargetId = document.getElementById(targetId) ? targetId : defaultTabId;
    const activeLink = getLinkForTarget(safeTargetId);
    if (!activeLink) return;

    links.forEach(link => {
        const isActive = link.dataset.target === safeTargetId;
        link.classList.toggle('active', isActive);
        link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    pages.forEach(page => {
        page.classList.toggle('hidden', page.id !== safeTargetId);
    });

    if (updateHash) {
        const nextHash = activeLink.getAttribute('href');
        if (nextHash && window.location.hash !== nextHash) {
            history.pushState({ collectionTab: safeTargetId }, '', nextHash);
        }
    }

    setMobileMenuState(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (safeTargetId === 'conc-group-page') renderConcessionGroupOverview();
    window.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: safeTargetId } }));
};

links.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        activateTab(link.dataset.target);
    });
});

window.addEventListener('hashchange', () => {
    activateTab(getTargetFromHash(window.location.hash), { updateHash: false });
});
window.addEventListener('popstate', () => {
    activateTab(getTargetFromHash(window.location.hash), { updateHash: false });
});

activateTab(getTargetFromHash(window.location.hash), { updateHash: false });
applyTabVisibilityPreferences();
readTabPrefsFromCloud().then((cloudPrefs) => {
    if (!cloudPrefs) return;
    writeTabPrefsToLocal(cloudPrefs);
    applyTabVisibilityPreferences();
});

// Modals close logic
document.getElementById('confirm-cancel')?.addEventListener('click', () => { document.getElementById('confirm-popup').classList.add('hidden'); });
document.getElementById('close-profile-btn')?.addEventListener('click', () => { document.getElementById('student-profile-popup').classList.add('hidden'); });
document.getElementById('close-my-profile-btn')?.addEventListener('click', () => { document.getElementById('my-profile-popup').classList.add('hidden'); });
document.getElementById('close-tab-settings-btn')?.addEventListener('click', () => { document.getElementById('tab-settings-popup').classList.add('hidden'); });

// Navigation button actions
document.getElementById('new-fee-entry-btn')?.addEventListener('click', () => { activateTab('home-page'); });


// --- GLOBAL STATE ---
let isCurrentAdmin = false;
let currentUserEmail = '';
let currentCollectorKey = '';
let students = [], allStudentsRaw = [], allPayments = [], allDonations = [], classes = [], studentGroups = [], feeItems = [], allStaff = [];
let directoryEntries = [], directoryCategories = [], pageAccessConfig = { categories: {}, overrides: {} };
let defaultFee = 200, feeStatusTitle = '', defaultReceiptMandatory = false;
let currentWorkingAcademicYear = '';
let isEditMode = false, editingPaymentGroup = {}, selectedStudentId = null;
let editTouchedItemKeys = new Set();
let availableFeeAcademicYears = [];
let selectedFeeAcademicYear = '';
let selectedDutyClasses = [];
let pendingFeeSelectionsByYear = {};
let isPaymentMutationInFlight = false;
let isDonationSaveInFlight = false;
let collectorPaymentDetails = {
    accountName: '',
    upiNumber: '',
    upiId: '',
};
const setResultPageNavVisibility = (canAccess = false) => {
    const navItem = document.getElementById('result-nav-item');
    if (!navItem) return;
    navItem.classList.toggle('hidden', !canAccess);
};
const normalizeEmail = (email = '') => String(email || '').trim().toLowerCase();
const getEffectiveStaffEmail = () => normalizeEmail(currentUserEmail || window.AppSession?.getStaffEmail?.() || auth.currentUser?.email || '');
const getCollectorKey = () => normalizeEmail(currentCollectorKey || window.AppSession?.getStaffAccess?.()?.userKey || window.AppSession?.getStaffAccess?.()?.loginId || getEffectiveStaffEmail());
const getDutyUserKey = () => getCollectorKey();
const getDutyStorageKey = () => `collector_duty_classes_${getDutyUserKey()}`;
const getDutyPaymentStorageKey = () => `collector_duty_payment_${getDutyUserKey()}`;
const readDutyClassesFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getDutyStorageKey()) || '[]');
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
        return [];
    }
};
const readDutyPaymentFromLocal = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(getDutyPaymentStorageKey()) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
};
const hasDutyPaymentDetails = (details = {}) => Object.values(details || {}).some((value) => String(value || '').trim().length > 0);
const getDirectoryCategoryName = (categoryId = '') => directoryCategories.find((category) => category.id === categoryId)?.name || 'Category';
const getDirectoryCollectionAccess = (entry = {}) => {
    const categoryAccess = pageAccessConfig?.categories?.[entry.categoryId] || {};
    const override = pageAccessConfig?.overrides?.[entry.id] || {};
    if (override.blocked === true) return false;
    if (typeof override.collection === 'boolean') return override.collection;
    return categoryAccess.collection === true;
};
const getDirectoryValue = (entry = {}, keys = []) => {
    const values = entry.values || {};
    for (const key of keys) {
        const value = values[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
};
const normalizeFeeItemName = (name = '') => String(name || '').replace(/\s*\((?:\d{4}\s*-\s*\d{2,4}|\d{4}\s*-\s*\d{4})\)\s*$/i, '').trim();
const getPaymentItemType = (payment = {}) => {
    if (payment.entryType === 'donation' || payment.itemKey === STUDENT_DONATION_ITEM_KEY) return 'donation';
    const feeItem = feeItems.find((item) => item.key === payment.itemKey);
    if (feeItem?.type === 'month') return 'month';
    if (feeItem?.type === 'custom') return 'custom';
    const key = String(payment.itemKey || '').toLowerCase();
    if (key.startsWith('month-') || key.includes('-month-')) return 'month';
    return 'custom';
};
const getDutyPaymentDetails = () => ({
    accountName: document.getElementById('duty-pay-account-name')?.value?.trim() || '',
    upiNumber: document.getElementById('duty-pay-upi-number')?.value?.trim() || '',
    upiId: document.getElementById('duty-pay-upi-id')?.value?.trim() || '',
});
const setDutyPaymentDetailsInputs = (details = {}) => {
    const values = { ...collectorPaymentDetails, ...details };
    const setVal = (id, value = '') => { const el = document.getElementById(id); if (el) el.value = value; };
    setVal('duty-pay-account-name', values.accountName || '');
    setVal('duty-pay-upi-number', values.upiNumber || '');
    setVal('duty-pay-upi-id', values.upiId || '');
};

// History Pagination State
let sortedHistoryList = [];
let historyDisplayedCount = 0;
let historyRenderToken = 0;
let historyLoadTimer = null;
let multiEntryQueue = [];
const INITIAL_LOAD = 30;
const LOAD_MORE = 10;
const MONTH_SEQUENCE = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const STUDENT_DONATION_ITEM_KEY = '__student_donation__';
const STUDENT_DONATION_ITEM = {
    key: STUDENT_DONATION_ITEM_KEY,
    name: 'Donation',
    type: 'custom',
    scope: 'global',
    amount: '',
    isVisible: true
};
let editingDonationId = null;
let academicYearSettings = [];
let sessionRegistryHeartbeat = null;
const getSessionRegistryRef = () => doc(db, `${BASE_PATH}/settings`, 'sessionRegistry');
const getLocalDeviceId = () => {
    const key = 'fee_collection_device_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const generated = `col-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(key, generated);
    return generated;
};
const getCollectionSessionUserKey = () => getCollectorKey();
const updateCollectionSessionRegistry = async () => {
    const userKey = getCollectionSessionUserKey();
    if (!userKey) return;
    const deviceId = getLocalDeviceId();
    await setDoc(getSessionRegistryRef(), {
        sessions: {
            [deviceId]: {
                deviceId,
                role: 'collection',
                userKey,
                userName: window.AppSession?.getStaffName?.() || currentUserEmail || 'Collector',
                adminEmail: currentUserEmail || '',
                deviceLabel: navigator.userAgent.includes('Android') ? 'Android Device' : navigator.userAgent.includes('iPhone') ? 'iOS Device' : 'Browser Device',
                platform: navigator.platform || '',
                lastSeenAt: new Date().toISOString(),
                forceLogout: false
            }
        }
    }, { merge: true });
};
const startCollectionSessionHeartbeat = () => {
    if (sessionRegistryHeartbeat) clearInterval(sessionRegistryHeartbeat);
    updateCollectionSessionRegistry().catch((error) => console.error('Failed to update collection session registry.', error));
    sessionRegistryHeartbeat = setInterval(() => {
        updateCollectionSessionRegistry().catch((error) => console.error('Failed to update collection session registry.', error));
    }, 60000);
};
const getAcademicYearRecord = (label = '') => academicYearSettings.find((year) => year?.label === label) || null;
const getAcademicYearStatus = (label = '') => String(getAcademicYearRecord(label)?.status || 'active').toLowerCase();
const isYearVisibleInCollection = (label = '') => getAcademicYearStatus(label) !== 'archived';
const getAcademicMonthSequence = (yearLabel = '') => {
    const yearRecord = getAcademicYearRecord(yearLabel) || {};
    const startMonth = Number.isInteger(Number(yearRecord?.startMonth)) ? Number(yearRecord.startMonth) : 5;
    const endMonth = Number.isInteger(Number(yearRecord?.endMonth)) ? Number(yearRecord.endMonth) : 4;
    const months = [];
    let cursor = startMonth;
    for (let count = 0; count < 24; count += 1) {
        months.push(cursor);
        if (cursor === endMonth) break;
        cursor = (cursor + 1) % 12;
    }
    return months.length ? months : [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];
};
const getMonthIndexFromName = (name = '') => {
    const normalized = normalizeFeeItemName(name || '').toLowerCase();
    const matchedMonth = MONTH_SEQUENCE.find((month) => normalized.startsWith(month));
    return matchedMonth ? MONTH_SEQUENCE.indexOf(matchedMonth) : -1;
};
const sortFeeItemsForDisplay = (items = []) => {
    const selectedYearMonthOrder = getAcademicMonthSequence(selectedFeeAcademicYear || currentWorkingAcademicYear);
    const monthly = items.filter((item) => (item.type || 'month') === 'month')
        .sort((a, b) => {
            const aLabel = normalizeFeeItemName(a.name || '');
            const bLabel = normalizeFeeItemName(b.name || '');
            const aIndex = getMonthIndexFromName(aLabel);
            const bIndex = getMonthIndexFromName(bLabel);
            const aOrder = selectedYearMonthOrder.indexOf(aIndex);
            const bOrder = selectedYearMonthOrder.indexOf(bIndex);
            if (aOrder === -1 && bOrder === -1) return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
            if (aOrder === -1) return 1;
            if (bOrder === -1) return -1;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
        });
    const monthlyKeys = new Set(monthly.map((item) => item.key));
    const custom = items.filter((item) => !monthlyKeys.has(item.key));
    return [...monthly, ...custom];
};
const sortMonthlyItemsByAcademicYear = (items = [], academicYear = '') => {
    const yearMonthOrder = getAcademicMonthSequence(academicYear || selectedFeeAcademicYear || currentWorkingAcademicYear);
    return [...items].sort((a, b) => {
        const aLabel = normalizeFeeItemName(a.name || '');
        const bLabel = normalizeFeeItemName(b.name || '');
        const aOrder = yearMonthOrder.indexOf(getMonthIndexFromName(aLabel));
        const bOrder = yearMonthOrder.indexOf(getMonthIndexFromName(bLabel));
        if (aOrder === -1 && bOrder === -1) return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
        if (aOrder === -1) return 1;
        if (bOrder === -1) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    });
};

const buildFeeStatusMatrix = () => {
    const fCls = document.getElementById('filter-class').value;
    const fGen = document.getElementById('filter-gender').value;
    const dutyFilteredStudents = (!isCurrentAdmin && selectedDutyClasses.length)
        ? students.filter((student) => selectedDutyClasses.includes(student.class))
        : students;
    const list = dutyFilteredStudents.filter(s => (fCls === 'all' || s.class === fCls) && (fGen === 'all' || s.gender === fGen));
    const items = feeItems.filter((i) => {
        if (i.isVisible === false) return false;
        if (!currentWorkingAcademicYear) return true;
        return (i.academicYear || currentWorkingAcademicYear) === currentWorkingAcademicYear;
    });
    return { list, items };
};

// --- LISTEN FOR TAB CHANGES FROM HTML ---
window.addEventListener('tabChanged', (e) => {
    const targetId = e.detail.tab;
    if (targetId === 'history-page') prepareHistoryData();
    if (targetId === 'fee-page') renderFeeTable();
    if (targetId === 'students-page') renderStudentInfoList();
    if (targetId === 'home-page') exitEditMode();
    if (targetId === 'bulk-upload-page') setupBulkUploadUI();
    if (targetId === 'donation-page') setupDonationEntryUI();
    if (targetId === 'dashboard-page') updateDashboardMetrics();
    if (targetId === 'monthly-collected-page') renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input').value);
    if (targetId === 'collector-wise-monthly-page') renderCollectorWiseMonthlyPage();
});

// --- GLOBAL EXPORTS (For HTML buttons) ---
window.openStudentProfile = (id) => {
    const s = getStudentById(id); if(!s) return;
    document.getElementById('prof-name').textContent = s.name;
    document.getElementById('prof-class').textContent = s.class;
    document.getElementById('prof-gender').textContent = s.gender;
    document.getElementById('prof-adm').textContent = s.adm || '-';
    document.getElementById('prof-uid').textContent = s.uid || '-';
    document.getElementById('prof-father').textContent = s.father || '-';
    document.getElementById('prof-addr').textContent = s.address || '-';
    const activeGroup = studentGroups.find((group) => Array.isArray(group.memberIds) && group.memberIds.includes(s.id) && Number(group.fee || 0) > 0);
    const groupWrap = document.getElementById('prof-group-wrap');
    const groupMembersEl = document.getElementById('prof-group-members');
    const groupAmountEl = document.getElementById('prof-group-amount');
    if (activeGroup && groupWrap && groupMembersEl && groupAmountEl) {
        const groupFee = Number(activeGroup.fee || 0);
        document.getElementById('prof-conc').textContent = 'Group Payment';
        groupAmountEl.textContent = `Amount: ₹${groupFee.toFixed(0)}`;
        groupMembersEl.innerHTML = (activeGroup.memberIds || []).map((memberId, index) => {
            const member = students.find((student) => student.id === memberId) || allStudentsRaw.find((student) => student.id === memberId) || {};
            const isSelected = memberId === s.id;
            return `
                <div class="flex items-center justify-between gap-2 rounded-lg bg-white border border-blue-100 px-2 py-1.5 text-xs">
                    <span class="${isSelected ? 'font-extrabold text-blue-900' : 'font-bold text-gray-800'}">${index + 1}. ${escapeHtml(member.name || memberId)}</span>
                    <span class="text-gray-500">${escapeHtml(member.class || '-')}</span>
                    <span class="font-bold text-green-700">₹${groupFee.toFixed(0)}</span>
                </div>`;
        }).join('');
        groupWrap.classList.remove('hidden');
    } else {
        document.getElementById('prof-conc').textContent = s.concessionFee !== undefined && s.concessionFee !== null ? `₹${s.concessionFee}` : 'None';
        groupWrap?.classList.add('hidden');
        if (groupMembersEl) groupMembersEl.innerHTML = '';
        if (groupAmountEl) groupAmountEl.textContent = '';
    }

    const mobCont = document.getElementById('prof-mobile');
    const callBtn = document.getElementById('prof-call-btn');
    if(s.mobile) {
        mobCont.textContent = s.mobile;
        callBtn.href = `tel:${s.mobile}`;
        callBtn.classList.remove('hidden');
        callBtn.classList.add('inline-flex');
    } else {
        mobCont.textContent = 'Not Available';
        callBtn.classList.add('hidden');
        callBtn.classList.remove('inline-flex');
    }

    document.getElementById('student-profile-popup').classList.remove('hidden');
    document.getElementById('student-profile-popup').classList.add('flex');
};

const renderTabSettings = () => {
    const listEl = document.getElementById('tab-settings-list');
    if (!listEl) return;
    const prefs = readTabPrefsFromLocal();
    listEl.innerHTML = getToggleableLinks().map(({ link, target }) => {
        const checked = prefs[target] !== false;
        return `<label class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
            <span class="text-sm font-semibold text-gray-700">${escapeHtml(link.textContent.trim())}</span>
            <input type="checkbox" class="tab-pref-checkbox w-4 h-4" data-target="${target}" ${checked ? 'checked' : ''}>
        </label>`;
    }).join('');
};

document.getElementById('open-tab-settings-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderTabSettings();
    document.getElementById('tab-settings-popup')?.classList.remove('hidden');
    document.getElementById('tab-settings-popup')?.classList.add('flex');
    setMobileMenuState(false);
});

document.getElementById('tab-settings-save-btn')?.addEventListener('click', () => {
    const checkboxes = Array.from(document.querySelectorAll('.tab-pref-checkbox'));
    const prefs = {};
    checkboxes.forEach((checkbox) => {
        prefs[checkbox.dataset.target] = checkbox.checked;
    });
    writeTabPrefsToLocal(prefs);
    writeTabPrefsToCloud(prefs);
    applyTabVisibilityPreferences();
    document.getElementById('tab-settings-popup')?.classList.add('hidden');
});

document.getElementById('open-profile-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if(isCurrentAdmin) {
        document.getElementById('my-prof-name').textContent = "Administrator";
        document.getElementById('my-prof-role').textContent = "Master Admin";
        document.getElementById('my-prof-email').textContent = currentUserEmail || 'admin@institute.com';
        document.getElementById('my-prof-phone').textContent = "-";
        document.getElementById('my-prof-msr').textContent = "-";
        document.getElementById('my-prof-addr').textContent = "System Administrator Account";
        document.getElementById('my-prof-img').src = "assets/images/logo.png";
    } else {
        const searchKey = getCollectorKey();
        const myData = allStaff.find(s => normalizeEmail(s.email) === searchKey || String(s.loginId).toLowerCase() === searchKey);
        
        if(myData) {
            document.getElementById('my-prof-name').textContent = myData.name || 'Staff';
            document.getElementById('my-prof-role').textContent = myData.role || myData.type || 'Staff';
            document.getElementById('my-prof-email').textContent = myData.email || '-';
            document.getElementById('my-prof-phone').textContent = myData.phone || '-';
            document.getElementById('my-prof-msr').textContent = myData.msr || '-';
            document.getElementById('my-prof-addr').textContent = myData.address || '-';
            document.getElementById('my-prof-img').src = myData.photo || "https://via.placeholder.com/150";
        }
    }
    document.getElementById('my-profile-popup').classList.remove('hidden');
    document.getElementById('my-profile-popup').classList.add('flex');

    // Close Mobile Menu if Open
    const navMenu = document.querySelector('.nav-menu');
    if(navMenu) navMenu.classList.remove('active');
});

document.getElementById('logout-btn')?.addEventListener('click', () => {
    signOut(auth).then(async () => {
        await window.AppSession?.clearAll({ purgeClientData: true });
        window.location.href = 'index.html';
    });
});

// --- HELPER FUNCTIONS ---
const getStudentById = (id) => students.find(s => s.id === id);

const getStaffName = (email, savedName) => {
    if (savedName && savedName !== email) return savedName;
    if (!email) return 'Admin';
    const st = allStaff.find(s => s.email === email);
    if (st && st.name) return st.name;
    if (email === currentUserEmail && isCurrentAdmin) return 'Administrator';
    return email;
};

const getVisiblePayments = () => {
    if(isCurrentAdmin) return allPayments;
    return allPayments.filter((payment) => {
        if (payment.collectedBy !== getCollectorKey()) return false;
        if (!selectedDutyClasses.length) return true;
        const paymentClass = payment.classLabel || getStudentById(payment.studentId)?.class || '';
        return selectedDutyClasses.includes(paymentClass);
    });
};
const getVisibleDonations = () => isCurrentAdmin
    ? [...allDonations]
    : allDonations.filter((donation) => donation.collectedBy === getCollectorKey());
const getAcademicYearFromDate = (dateObj = new Date()) => {
    const month = dateObj.getMonth();
    const year = dateObj.getFullYear();
    return month < 5 ? `${year - 1}-${year}` : `${year}-${year + 1}`;
};
const toAcademicYearDocId = (academicYear = '') => String(academicYear || '').trim().replace(/[^\w-]/g, '_');
const getYearPaymentsCollectionPath = (academicYear = '') => `${BASE_PATH}/academicYears/${toAcademicYearDocId(academicYear || getAcademicYearFromDate())}/payments`;
const queuePaymentWrite = (batch, payload) => {
    const paymentRef = doc(collection(db, `${BASE_PATH}/payments`));
    batch.set(paymentRef, payload);
    const yearPath = getYearPaymentsCollectionPath(payload.academicYear);
    batch.set(doc(db, yearPath, paymentRef.id), payload);
};
const compareAcademicYears = (a = '', b = '') => {
    const [aStart = 0] = String(a).split('-').map(Number);
    const [bStart = 0] = String(b).split('-').map(Number);
    return bStart - aStart;
};
const applyCurrentYearStudentScope = () => {
    if (!Array.isArray(allStudentsRaw)) {
        students = [];
        return;
    }
    if (!currentWorkingAcademicYear) {
        students = [...allStudentsRaw];
        return;
    }
    students = allStudentsRaw.filter((student) => {
        const studentYear = student.academicYear || currentWorkingAcademicYear;
        return studentYear === currentWorkingAcademicYear;
    });
};
const getPaymentGroupKey = (payment = {}) => {
    if (payment.transactionId) return `txn:${payment.transactionId}`;
    if (payment.receiptNo !== undefined && payment.receiptNo !== null && payment.receiptNo !== '') {
        return `rcpt:${payment.collectedBy || 'unknown'}:${payment.receiptNo}`;
    }
    return `fallback:${payment.studentId || 'unknown'}:${payment.itemKey || 'unknown'}:${payment.timestamp || payment.paymentDate || 'na'}`;
};
const parsePaymentGroupKey = (groupKey = '') => {
    if (groupKey.startsWith('txn:')) return { type: 'transaction', transactionId: groupKey.slice(4) };
    if (groupKey.startsWith('rcpt:')) {
        const payload = groupKey.slice(5);
        const splitIndex = payload.lastIndexOf(':');
        if (splitIndex === -1) return { type: 'unknown' };
        const collectedBy = payload.slice(0, splitIndex);
        const receiptNo = Number(payload.slice(splitIndex + 1));
        if (Number.isNaN(receiptNo)) return { type: 'unknown' };
        return { type: 'receipt', collectedBy, receiptNo };
    }
    return { type: 'fallback' };
};
const collectPaymentDocsForGroup = async (groupKey = '', expectedStudentId = '') => {
    const parsed = parsePaymentGroupKey(groupKey);
    if (parsed.type === 'transaction') {
        const txnSnap = await getDocs(query(collection(db, `${BASE_PATH}/payments`), where("transactionId", "==", parsed.transactionId)));
        return txnSnap.docs;
    }

    if (parsed.type === 'receipt') {
        const receiptSnap = await getDocs(query(collection(db, `${BASE_PATH}/payments`), where("receiptNo", "==", parsed.receiptNo)));
        return receiptSnap.docs.filter((docSnap) => {
            const data = docSnap.data();
            const sameCollector = (data.collectedBy || '') === parsed.collectedBy;
            if (!sameCollector) return false;
            if (!expectedStudentId) return true;
            return (data.studentId || '') === expectedStudentId;
        });
    }

    return [];
};

const downloadTextFile = (filename, content, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const buildMonthlyReportSummary = (payments) => {
    const summary = {
        totalAmount: 0,
        defaultAmount: 0,
        donationAmount: 0,
        otherAmount: 0,
        receipts: new Set(),
        students: new Set()
    };

    const seenBillingKeys = new Set();
    payments.forEach((payment) => {
        const itemType = getPaymentItemType(payment);
        const billingKey = getPaymentBillingKey(payment);
        const shouldCountAmount = !seenBillingKeys.has(billingKey);
        if (shouldCountAmount) seenBillingKeys.add(billingKey);
        const amount = shouldCountAmount ? getMonthlyReportPaymentAmount(payment) : 0;
        summary.totalAmount = roundMoney(summary.totalAmount + amount);
        if (itemType === 'donation') summary.donationAmount = roundMoney(summary.donationAmount + amount);
        else if (itemType === 'month') summary.defaultAmount = roundMoney(summary.defaultAmount + amount);
        else summary.otherAmount = roundMoney(summary.otherAmount + amount);
        summary.receipts.add(getPaymentGroupKey(payment));
        if (payment.studentId) summary.students.add(payment.studentId);
    });

    return summary;
};

const renderMonthlySummaryCards = (payments, searchTerm = '') => {
    const summary = buildMonthlyReportSummary(payments);
    const summaryContainer = document.getElementById('monthly-report-summary');
    const subtitle = searchTerm ? `Filtered by "${searchTerm}"` : 'All visible collections';

    summaryContainer.innerHTML = `
        <div class="insight-card success">
            <div class="insight-label">Default Fee</div>
            <div class="insight-value">${formatCurrency(summary.defaultAmount)}</div>
            <div class="insight-subvalue">Monthly collections</div>
        </div>
        <div class="insight-card warning">
            <div class="insight-label">Donation</div>
            <div class="insight-value">${formatCurrency(summary.donationAmount)}</div>
            <div class="insight-subvalue">All donation entries</div>
        </div>
        <div class="insight-card info">
            <div class="insight-label">Other Fees</div>
            <div class="insight-value">${formatCurrency(summary.otherAmount)}</div>
            <div class="insight-subvalue">Custom or additional items</div>
        </div>
        <div class="insight-card">
            <div class="insight-label">Total</div>
            <div class="insight-value">${formatCurrency(summary.totalAmount)}</div>
            <div class="insight-subvalue">${summary.students.size} students • ${summary.receipts.size} receipts • ${escapeHtml(subtitle)}</div>
        </div>
    `;
};

const exportMonthlySummaryCsv = (searchTerm = '') => {
    const lowerTerm = searchTerm.toLowerCase();
    const visiblePayments = [...getVisiblePayments(), ...getVisibleDonations()].filter((payment) => {
        if (!searchTerm) return true;
        if (payment.entryType === 'donation') {
            return (payment.donorName || '').toLowerCase().includes(lowerTerm)
                || (payment.description || '').toLowerCase().includes(lowerTerm)
                || (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm));
        }
        const student = getStudentById(payment.studentId);
        return Boolean(student) && (
            student.name.toLowerCase().includes(lowerTerm) ||
            (student.adm && student.adm.toLowerCase().includes(lowerTerm)) ||
            student.class.toLowerCase().includes(lowerTerm) ||
            (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm))
        );
    });

    if (visiblePayments.length === 0) {
        alert('No monthly report data available to export.');
        return;
    }

    const monthlyGroups = visiblePayments.reduce((acc, payment) => {
        if (!payment.paymentDate) return acc;
        const monthKey = payment.paymentDate.substring(0, 7);
        if (!acc[monthKey]) acc[monthKey] = [];
        acc[monthKey].push(payment);
        return acc;
    }, {});

    const rows = [['Month', 'Total Collected', 'Monthly Fees', 'Other Fees', 'Receipts', 'Students']];
    Object.keys(monthlyGroups).sort().reverse().forEach((monthKey) => {
        const summary = buildMonthlyReportSummary(monthlyGroups[monthKey]);
        rows.push([
            formatMonthLabel(monthKey),
            summary.totalAmount.toFixed(0),
            summary.defaultAmount.toFixed(0),
            summary.otherAmount.toFixed(0),
            summary.receipts.size.toString(),
            summary.students.size.toString()
        ]);
    });

    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const suffix = searchTerm ? `-${searchTerm.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
    downloadTextFile(`monthly-report-summary${suffix || ''}.csv`, csv, 'text/csv;charset=utf-8');
};

// --- DASHBOARD RENDER ---
const updateDashboardMetrics = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.substring(0, 7);
    const myPays = [...getVisiblePayments(), ...getVisibleDonations()];

    let todayTotal = 0, monthTotal = 0;
    const todayReceipts = new Set();

    myPays.forEach(p => {
        const amt = parseFloat(p.amount) || 0;
        if(p.paymentDate === todayStr) {
            todayTotal += amt;
            todayReceipts.add(getPaymentGroupKey(p));
        }
        if(p.paymentDate && p.paymentDate.substring(0,7) === currentMonthStr) {
            monthTotal += amt;
        }
    });

    document.getElementById('dash-today-amt').textContent = todayTotal.toFixed(0);
    document.getElementById('dash-month-amt').textContent = monthTotal.toFixed(0);
    document.getElementById('dash-today-receipts').textContent = todayReceipts.size;
    document.getElementById('dash-students-count').textContent = students.length;
};

const getAvailableFeeYearsForStudent = (student) => {
    const fallbackYear = student?.academicYear || getAcademicYearFromDate();
    const years = [...new Set(
        feeItems
            .map((item) => item.academicYear)
            .filter(Boolean)
            .concat([fallbackYear])
    )]
        .filter((year) => isYearVisibleInCollection(year))
        .sort(compareAcademicYears);
    return years;
};
const renderFeeYearSwitcher = () => {
    const switcher = document.getElementById('fee-year-switcher');
    const label = document.getElementById('fee-year-label');
    const prevBtn = document.getElementById('fee-year-prev-btn');
    const nextBtn = document.getElementById('fee-year-next-btn');
    const prevLabel = document.getElementById('fee-year-prev-label');
    const nextLabel = document.getElementById('fee-year-next-label');
    if (!switcher || !label || !prevBtn || !nextBtn || !prevLabel || !nextLabel) return;
    if (!selectedStudentId || availableFeeAcademicYears.length === 0) {
        switcher.classList.add('hidden');
        return;
    }
    switcher.classList.remove('hidden');
    const currentIndex = Math.max(0, availableFeeAcademicYears.indexOf(selectedFeeAcademicYear));
    label.textContent = `${selectedFeeAcademicYear}`;
    prevBtn.disabled = currentIndex >= availableFeeAcademicYears.length - 1;
    nextBtn.disabled = currentIndex <= 0;
    prevBtn.classList.toggle('opacity-40', prevBtn.disabled);
    nextBtn.classList.toggle('opacity-40', nextBtn.disabled);
    prevLabel.textContent = currentIndex < availableFeeAcademicYears.length - 1 ? availableFeeAcademicYears[currentIndex + 1] : '--';
    nextLabel.textContent = currentIndex > 0 ? availableFeeAcademicYears[currentIndex - 1] : '--';
};

const getClassOptionsForCollector = () => {
    if (isCurrentAdmin || !selectedDutyClasses.length) return classes;
    return classes.filter((cls) => selectedDutyClasses.includes(cls));
};

const renderMyClassTab = () => {
    const listEl = document.getElementById('my-class-list');
    if (!listEl) return;
    const classOptions = classes.length ? classes : [];
    listEl.innerHTML = classOptions.map((classLabel) => {
        const checked = selectedDutyClasses.includes(classLabel) ? 'checked' : '';
        return `<label class="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold cursor-pointer hover:bg-blue-50 transition">
            <input type="checkbox" class="my-class-checkbox w-4 h-4 text-blue-600 rounded" value="${classLabel}" ${checked}>
            <span class="text-gray-800">${classLabel}</span>
        </label>`;
    }).join('') || '<div class="text-xs text-gray-500 p-3">No classes available.</div>';
};

const getStaffDirectoryRank = (staff = {}) => {
    const type = String(staff.type || '').trim().toLowerCase();
    if (type === 'teacher') return 1;
    if (type === 'management') return 2;
    return 3;
};
const buildStaffDirectoryCard = (staff = {}) => {
    const displayName = escapeHtml(staff.name || staff.email || 'Staff');
    const roleLabel = escapeHtml(staff.role || staff.type || 'Staff');
    const typeRank = getStaffDirectoryRank(staff);
    const badgeClass = typeRank === 1
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : typeRank === 2
            ? 'bg-purple-100 text-purple-800 border-purple-200'
            : 'bg-slate-100 text-slate-700 border-slate-200';
    const roleBadge = `<span class="${badgeClass} text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border">${roleLabel}</span>`;
    const classLabel = Array.isArray(staff.dutyClasses) && staff.dutyClasses.length
        ? `<div class="flex flex-wrap gap-1 mt-1">${staff.dutyClasses.map(c => `<span class="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">${escapeHtml(c)}</span>`).join('')}</div>`
        : '<span class="text-[10px] text-gray-400 italic">Not assigned</span>';
    const emailLine = isCurrentAdmin ? `<div class="text-[10px] text-gray-400 mt-1 truncate" title="${escapeHtml(staff.email || '--')}"><i class="fas fa-envelope mr-1"></i>${escapeHtml(staff.email || '--')}</div>` : '';
    return `<div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition relative">
        <div class="flex justify-between items-start mb-1">
            <div class="font-bold text-gray-800 text-sm truncate pr-2">${displayName}</div>
            ${roleBadge}
        </div>
        ${emailLine}
        <div class="mt-3 pt-3 border-t border-gray-50">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Duty Classes</div>
            ${classLabel}
        </div>
    </div>`;
};
const buildDirectoryCollectorCard = (entry = {}) => {
    const displayName = escapeHtml(getDirectoryValue(entry, ['name', 'fullName', 'title']) || 'Collector');
    const categoryName = escapeHtml(getDirectoryCategoryName(entry.categoryId));
    const roleLabel = escapeHtml(getDirectoryValue(entry, ['role', 'designation', 'type']) || categoryName);
    const phone = getDirectoryValue(entry, ['phone', 'mobile', 'contactPhone']);
    const phoneLine = phone ? `<div class="text-[10px] text-gray-500 mt-1 truncate"><i class="fas fa-phone mr-1"></i>${escapeHtml(phone)}</div>` : '';
    return `<div class="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm hover:shadow-md transition relative">
        <div class="flex justify-between items-start mb-1">
            <div class="font-bold text-gray-800 text-sm truncate pr-2">${displayName}</div>
            <span class="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">${categoryName}</span>
        </div>
        <div class="text-xs text-gray-500 font-medium">${roleLabel}</div>
        ${phoneLine}
        <div class="mt-3 pt-3 border-t border-gray-50">
            <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">Collection Access</span>
        </div>
    </div>`;
};
const renderStaffDirectory = () => {
    const host = document.getElementById('collection-staff-directory');
    if (!host) return;
    const visibleStaff = [...allStaff]
        .filter((staff) => staff && staff.isActive !== false && staff.canCollect !== false)
        .sort((a, b) => getStaffDirectoryRank(a) - getStaffDirectoryRank(b) || Number(a.displayOrder || 999) - Number(b.displayOrder || 999) || String(a.name || '').localeCompare(String(b.name || '')));
    const visibleDirectoryCollectors = [...directoryEntries]
        .filter((entry) => entry && entry.categoryId && entry.isActive !== false && getDirectoryCollectionAccess(entry))
        .sort((a, b) => getDirectoryCategoryName(a.categoryId).localeCompare(getDirectoryCategoryName(b.categoryId)) || Number(a.displayOrder || 999) - Number(b.displayOrder || 999) || getDirectoryValue(a, ['name', 'fullName', 'title']).localeCompare(getDirectoryValue(b, ['name', 'fullName', 'title'])));
    if (!visibleStaff.length && !visibleDirectoryCollectors.length) {
        host.innerHTML = '<div class="text-xs text-gray-500 bg-white border border-dashed rounded-lg p-3">No collection-access staff available.</div>';
        return;
    }
    host.innerHTML = [
        ...visibleStaff.map(buildStaffDirectoryCard),
        ...visibleDirectoryCollectors.map(buildDirectoryCollectorCard)
    ].join('');
};

// 🌟 FIX: Database Sync Logic Update
document.getElementById('save-my-class-btn')?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.my-class-checkbox:checked')).map((checkbox) => checkbox.value);
    selectedDutyClasses = selected;
    collectorPaymentDetails = getDutyPaymentDetails();
    
    // Save to local storage for immediate UI reflect
    localStorage.setItem(getDutyStorageKey(), JSON.stringify(selectedDutyClasses));
    localStorage.setItem(getDutyPaymentStorageKey(), JSON.stringify(collectorPaymentDetails));
    
    const msg = document.getElementById('my-class-save-msg');
    
    if (isCurrentAdmin) {
        alert("അഡ്മിൻ അക്കൗണ്ടിന് പ്രത്യേകമായി ക്ലാസുകൾ അസൈൻ ചെയ്യാൻ സാധിക്കില്ല. ക്ലാസ്സ് ഡ്യൂട്ടി എടുക്കാൻ സ്റ്റാഫ് ആയി ലോഗിൻ ചെയ്യുക.");
        return;
    }

    try {
        const btn = document.getElementById('save-my-class-btn');
        btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Saving...`;
        btn.disabled = true;

        // Find Exact Firestore Document ID for this Staff
        const searchKey = getCollectorKey(); // This could be email OR directory loginId
        const myStaffRecord = allStaff.find(s => normalizeEmail(s.email) === searchKey || String(s.loginId).toLowerCase() === searchKey);

        if (myStaffRecord?.id) {
            // Securely update the central database
            await updateDoc(doc(db, `${BASE_PATH}/staff`, myStaffRecord.id), {
                dutyClasses: selectedDutyClasses,
                dutyPaymentDetails: collectorPaymentDetails,
                updatedAt: new Date().toISOString()
            });
            
            if (msg) {
                msg.textContent = 'വിവരങ്ങൾ ഡാറ്റാബേസിൽ സേവ് ചെയ്തു!';
                msg.classList.remove('opacity-0');
                setTimeout(() => { msg.classList.add('opacity-0'); }, 3000);
            }
        } else {
            alert("നിങ്ങളുടെ പ്രൊഫൈൽ സിസ്റ്റത്തിൽ കണ്ടെത്താനായില്ല. ദയവായി അഡ്മിനെ ബന്ധപ്പെടുക.");
        }
    } catch (error) {
        console.error('Failed to save My Class Duty details', error);
        alert('സേവ് ചെയ്യുന്നതിൽ എറർ സംഭവിച്ചു. ഇന്റർനെറ്റ് കണക്ഷൻ പരിശോധിക്കുക.');
    } finally {
        const btn = document.getElementById('save-my-class-btn');
        btn.innerHTML = `<i class="fas fa-save mr-2"></i> Save Details`;
        btn.disabled = false;
        populateClassDropdowns();
        resetStudentSelection();
        renderFeeTable();
    }
});

['duty-pay-account-name', 'duty-pay-upi-number', 'duty-pay-upi-id']
    .forEach((inputId) => {
        document.getElementById(inputId)?.addEventListener('input', () => {
            collectorPaymentDetails = getDutyPaymentDetails();
        });
    });

const setupDonationEntryUI = () => {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('donation-date');
    if (dateInput && !dateInput.value) dateInput.value = today;
    const saveBtn = document.getElementById('save-donation-btn');
    if (saveBtn) saveBtn.textContent = editingDonationId ? 'Update Donation' : 'Save Donation';
};
document.getElementById('save-donation-btn')?.addEventListener('click', async () => {
    if (isDonationSaveInFlight) return;
    const donorName = document.getElementById('donation-name')?.value?.trim() || '';
    const receiptRaw = document.getElementById('donation-receipt')?.value?.trim() || '';
    const description = document.getElementById('donation-description')?.value?.trim() || '';
    const amount = Number(document.getElementById('donation-amount')?.value || 0);
    const donationDate = document.getElementById('donation-date')?.value || new Date().toISOString().split('T')[0];
    if (!donorName || !amount || amount <= 0) {
        alert('Donor name and valid amount are required.');
        return;
    }
    const receiptNo = receiptRaw ? parseInt(receiptRaw, 10) : null;
    if (receiptNo) {
        const hasDuplicate = allDonations.some((donation) => {
            if (editingDonationId && donation.id === editingDonationId) return false;
            return donation.collectedBy === getCollectorKey() && Number(donation.receiptNo) === receiptNo;
        });
        if (hasDuplicate) {
            alert(`Donation receipt ${receiptNo} is already used.`);
            return;
        }
    }
    const collectorLabel = isCurrentAdmin ? 'Administrator' : (allStaff.find((staff) => normalizeEmail(staff.email) === normalizeEmail(currentUserEmail))?.name || currentUserEmail);
    const donationDoc = {
        donorName,
        receiptNo,
        description,
        amount,
        paymentDate: donationDate,
        academicYear: getAcademicYearFromDate(new Date(donationDate)),
        timestamp: Date.now(),
        collectedBy: getCollectorKey(),
        collectedByName: collectorLabel,
        entryType: 'donation'
    };
    isDonationSaveInFlight = true;
    const donationBtn = document.getElementById('save-donation-btn');
    if (donationBtn) donationBtn.disabled = true;
    try {
        if (editingDonationId) {
            await updateDoc(doc(db, `${BASE_PATH}/donations`, editingDonationId), donationDoc);
        } else {
            await setDoc(doc(collection(db, `${BASE_PATH}/donations`)), donationDoc);
        }
        document.getElementById('donation-name').value = '';
        document.getElementById('donation-receipt').value = '';
        document.getElementById('donation-description').value = '';
        document.getElementById('donation-amount').value = '';
        editingDonationId = null;
        setupDonationEntryUI();
        const msg = document.getElementById('donation-save-msg');
        if (msg) {
            msg.textContent = 'Donation saved.';
            setTimeout(() => { msg.textContent = ''; }, 2000);
        }
    } catch (error) {
        console.error(error);
        alert('Failed to save donation.');
    } finally {
        isDonationSaveInFlight = false;
        if (donationBtn) donationBtn.disabled = false;
    }
});


const isMultiEntryMode = () => document.getElementById('multi-entry-toggle')?.checked === true;
const renderMultiEntryQueue = () => {
    const panel = document.getElementById('multi-entry-panel');
    const count = document.getElementById('multi-entry-count');
    const list = document.getElementById('multi-entry-list');
    if (!panel || !count || !list) return;
    panel.classList.toggle('hidden', !isMultiEntryMode());
    count.textContent = `${multiEntryQueue.length} students queued for same receipt`;
    list.innerHTML = multiEntryQueue.map((entry, index) => `
        <div class="flex items-center justify-between bg-white border border-blue-100 rounded-lg px-3 py-2 text-sm">
            <div><b>${escapeHtml(entry.studentName)}</b> <span class="text-slate-500">(${escapeHtml(entry.classLabel || '--')})</span><div class="text-xs text-slate-500">Items: ${entry.items.length} • ₹${Number(entry.total || 0).toFixed(0)}</div></div>
            <div class="flex gap-2">${entry.isGroupedClone ? '' : `<button type="button" class="text-blue-600 font-bold" data-multi-edit="${index}">Edit</button>`}<button type="button" class="text-red-600 font-bold" data-multi-remove="${index}">Remove</button></div>
        </div>
    `).join('') || '<div class="text-xs text-slate-500">No students added yet.</div>';
};

const buildSelectedItemsForCurrentStudent = () => {
    captureCurrentYearFeeSelections();
    return Object.entries(pendingFeeSelectionsByYear).flatMap(([year, selections]) =>
        Object.entries(selections || {})
            .filter(([, item]) => item?.checked)
            .map(([itemKey, item]) => ({ year, itemKey, itemType: item.type, amount: Number(item.amount || 0) }))
    );
};


const getStudentBillingGroup = (studentId = '') => studentGroups.find((g) => Array.isArray(g.memberIds) && g.memberIds.includes(studentId));

const roundMoney = (value = 0) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const getPaymentBillingKey = (payment = {}) => payment.billingGroupId && getPaymentItemType(payment) === 'month'
    ? `${getPaymentGroupKey(payment)}__${payment.itemKey || ''}__${payment.academicYear || ''}__${payment.billingGroupId}`
    : `${getPaymentGroupKey(payment)}__${payment.studentId || ''}__${payment.itemKey || ''}__${payment.academicYear || ''}`;
const getMonthlyReportPaymentAmount = (payment = {}) => {
    if (getPaymentItemType(payment) !== 'month' || !payment.billingGroupId) return roundMoney(payment.amount || 0);
    const billingGroup = studentGroups.find((group) => group.id === payment.billingGroupId);
    const groupFee = Number(billingGroup?.fee || 0);
    return roundMoney(groupFee > 0 ? groupFee : payment.amount || 0);
};
const sumReportPaymentsOnce = (payments = [], predicate = () => true) => {
    const seenBillingKeys = new Set();
    return roundMoney(payments.reduce((sum, payment) => {
        if (!predicate(payment)) return sum;
        const billingKey = getPaymentBillingKey(payment);
        if (seenBillingKeys.has(billingKey)) return sum;
        seenBillingKeys.add(billingKey);
        return sum + getMonthlyReportPaymentAmount(payment);
    }, 0));
};

const getGroupMemberStudents = (group = {}) => (group.memberIds || []).map((id) => getStudentById(id)).filter(Boolean);

const renderGroupedStudentsPanel = () => {
    const panel = document.getElementById('grouped-students-panel');
    if (!panel) return;
    const group = selectedStudentId ? getStudentBillingGroup(selectedStudentId) : null;
    const members = group ? getGroupMemberStudents(group) : [];
    if (!group || members.length <= 1) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const selectedItems = buildSelectedItemsForCurrentStudent().filter((item) => (item.itemType || 'month') === 'month');
    const groupFee = Number(group.fee || calculateEntryTotalForStudent([{ itemType: 'month' }], selectedStudentId) || 0);
    const groupTotal = calculateEntryTotalForStudent(selectedItems, selectedStudentId);
    const memberRows = members.map((student, index) => `
        <li class="flex items-center justify-between gap-3 rounded-lg bg-white border border-emerald-100 px-3 py-2">
            <span class="font-semibold text-emerald-950">${index + 1}. ${escapeHtml(student.name || 'Student')}</span>
            <span class="text-xs font-bold text-emerald-700">${escapeHtml(student.class || '--')}</span>
        </li>`).join('');

    panel.innerHTML = `
        <div class="flex items-start gap-2">
            <i class="fas fa-users text-emerald-600 mt-0.5"></i>
            <div class="flex-1">
                <div class="font-bold text-emerald-800">Grouped fee collection</div>
                <ol class="mt-2 space-y-1 text-xs">${memberRows}</ol>
                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold">
                    <span class="bg-white border border-emerald-200 rounded-lg px-2 py-2 text-center">Default fee: ₹${groupFee.toFixed(0)}</span>
                    <span class="bg-white border border-emerald-200 rounded-lg px-2 py-2 text-center">Total fee: ₹${groupTotal.toFixed(0)}</span>
                </div>
            </div>
        </div>`;
    panel.classList.remove('hidden');
};

const syncGroupedStudentsForSelectedStudent = () => {
    renderGroupedStudentsPanel();
};

const calculateEntryTotalForStudent = (entryItems = [], studentId = '') => {
    const st = getStudentById(studentId);
    let baseFee = defaultFee;
    if (st) {
        const group = studentGroups.find((g) => g.memberIds.includes(st.id));
        if (st.concessionFee !== undefined && st.concessionFee !== null && st.concessionFee !== '') baseFee = parseFloat(st.concessionFee);
        else if (group && group.fee > 0) baseFee = group.fee;
    }
    return entryItems.reduce((sum, item) => sum + Number(item.itemType === 'month' ? baseFee : (item.amount || 0)), 0);
};
const addCurrentStudentToMultiQueue = () => {
    if (!isMultiEntryMode()) return;
    if (!selectedStudentId) return alert('ദയവായി ഒരു വിദ്യാർത്ഥിയെ തിരഞ്ഞെടുക്കുക.');
    const selected = buildSelectedItemsForCurrentStudent();
    if (!selected.length) return alert('ദയവായി ഫീസ് ഐറ്റം തിരഞ്ഞെടുക്കുക.');
    const st = getStudentById(selectedStudentId);
    const total = selected.reduce((sum, item) => sum + Number(item.itemType === 'month' ? defaultFee : (item.amount || 0)), 0);
    multiEntryQueue.push({ studentId: selectedStudentId, studentName: st?.name || 'Student', classLabel: st?.class || '', items: selected, total });
    resetStudentSelection();
    document.getElementById('total-amount').value = 0;
    renderMultiEntryQueue();
};


const editMultiEntryItem = (index = -1) => {
    const entry = multiEntryQueue[index];
    if (!entry) return;
    const st = getStudentById(entry.studentId);
    if (!st) return;
    document.getElementById('entry-class').value = st.class || '';
    document.getElementById('entry-gender').value = st.gender || 'all';
    selectedStudentId = st.id;
    document.getElementById('entry-student-input').value = `${st.name} (Adm: ${st.adm || '-'})`;
    pendingFeeSelectionsByYear = {};
    (entry.items || []).forEach((item) => {
        const year = item.year || selectedFeeAcademicYear || '';
        if (!pendingFeeSelectionsByYear[year]) pendingFeeSelectionsByYear[year] = {};
        pendingFeeSelectionsByYear[year][item.itemKey] = { checked: true, type: item.itemType, amount: Number(item.amount || 0) };
    });
    multiEntryQueue.splice(index, 1);
    populateFeeItemSelection();
    updateTotalAmount();
    renderMultiEntryQueue();
};

// --- FEE ENTRY & LOGIC ---
const populateClassDropdowns = () => {
    classes = [...new Set(students.map(s => s.class).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
    const classOptions = getClassOptionsForCollector();
    const opts = classOptions.map(c => `<option value="${c}">${c}</option>`).join('');
    const allClassOpts = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('filter-class').innerHTML = `<option value="all">All Classes</option>` + opts;
    document.getElementById('entry-class').innerHTML = opts;
    document.getElementById('stu-info-class').innerHTML = `<option value="">-- Select --</option>` + allClassOpts;
    
    // Also populate bulk upload class dropdown
    const bulkClassDropdown = document.getElementById('bulk-class');
    if (bulkClassDropdown) {
        bulkClassDropdown.innerHTML = `<option value="">-- Select Class --</option>` + allClassOpts;
    }

    renderMyClassTab();
};

const updateStudentInputClearButton = () => {
    const input = document.getElementById('entry-student-input');
    const clearBtn = document.getElementById('entry-student-clear-btn');
    if (!input || !clearBtn) return;
    clearBtn.classList.toggle('hidden', !input.value.trim());
};
const resetStudentSelection = () => {
    selectedStudentId = null;
    pendingFeeSelectionsByYear = {};
    document.getElementById('entry-student-input').value = '';
    document.getElementById('student-suggestions').classList.add('hidden');
    document.getElementById('grouped-students-panel')?.classList.add('hidden');
    updateStudentInputClearButton();
    populateFeeItemSelection();
};
document.getElementById('entry-class').addEventListener('change', resetStudentSelection);
document.getElementById('entry-gender').addEventListener('change', resetStudentSelection);
document.getElementById('filter-class').addEventListener('change', () => renderFeeTable());
document.getElementById('filter-gender').addEventListener('change', () => renderFeeTable());

const populateStudentSuggestions = (searchTerm = '') => {
    const cls = document.getElementById('entry-class').value, gen = document.getElementById('entry-gender').value, lSugg = document.getElementById('student-suggestions');
    const fil = students.filter(s => {
        const classMatch = s.class === cls;
        const genderMatch = !gen || gen === 'all' || s.gender === gen;
        const searchMatch = (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || ((s.adm || '').toLowerCase().includes(searchTerm.toLowerCase()));
        return classMatch && genderMatch && searchMatch;
    }).sort((a,b)=>(a.name || '').localeCompare(b.name || ''));
    lSugg.innerHTML = '';
    if(fil.length > 0) {
        fil.forEach(s => {
            const d = document.createElement('div');
            d.className = 'p-3 hover:bg-blue-50 cursor-pointer border-b text-sm font-medium flex justify-between';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = s.name;
            const admSpan = document.createElement('span');
            admSpan.className = 'text-xs text-gray-500 font-mono';
            admSpan.textContent = `Adm: ${s.adm || '-'}`;
            d.append(nameSpan, admSpan);
            d.onclick = () => { selectedStudentId = s.id; document.getElementById('entry-student-input').value = `${s.name} (Adm: ${s.adm||'-'})`; lSugg.classList.add('hidden'); updateStudentInputClearButton(); populateFeeItemSelection(); syncGroupedStudentsForSelectedStudent(); };
            lSugg.appendChild(d);
        });
        lSugg.classList.remove('hidden');
    } else lSugg.classList.add('hidden');
};
document.getElementById('entry-student-input').addEventListener('focus', () => populateStudentSuggestions(''));
document.getElementById('entry-student-input').addEventListener('input', e => { populateStudentSuggestions(e.target.value); updateStudentInputClearButton(); });
document.getElementById('entry-student-clear-btn')?.addEventListener('click', () => {
    resetStudentSelection();
    document.getElementById('entry-student-input')?.focus();
});
document.addEventListener('click', e => { if(!document.getElementById('student-combobox-container').contains(e.target)) document.getElementById('student-suggestions').classList.add('hidden'); });

document.getElementById('multi-entry-toggle')?.addEventListener('change', () => { if (!isMultiEntryMode()) multiEntryQueue = []; renderMultiEntryQueue(); });
document.getElementById('add-multi-student-btn')?.addEventListener('click', addCurrentStudentToMultiQueue);
document.getElementById('clear-multi-students-btn')?.addEventListener('click', () => { multiEntryQueue = []; renderMultiEntryQueue(); });
document.getElementById('multi-entry-list')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-multi-edit]');
    if (editBtn) {
        const idx = Number(editBtn.dataset.multiEdit);
        if (!Number.isNaN(idx) && !multiEntryQueue[idx]?.isGroupedClone) editMultiEntryItem(idx);
        return;
    }
    const btn = e.target.closest('[data-multi-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.multiRemove);
    if (Number.isNaN(idx)) return;
    multiEntryQueue.splice(idx, 1);
    renderMultiEntryQueue();
});


const getNextReceiptNoForStaff = () => {
    const myPays = allPayments.filter(p => p.collectedBy === getCollectorKey() && p.receiptNo);
    if (myPays.length === 0) return '';
    const validPays = myPays.map(p => parseInt(p.receiptNo)).filter(n => !isNaN(n));
    if(validPays.length === 0) return '';
    return Math.max(...validPays) + 1;
};

const checkReceiptMandatory = () => {
    let isReq = false;
    document.querySelectorAll('.fee-item-checkbox:checked').forEach(cb => {
        const type = cb.dataset.itemType, key = cb.dataset.itemKey;
        if(type === 'custom') { const item = feeItems.find(i=>i.key === key); if(item && item.isReceiptMandatory) isReq = true; }
        else if(type === 'month') { if(defaultReceiptMandatory) isReq = true; }
    });
    document.getElementById('receipt-req-star').classList.toggle('hidden', !isReq);
    return isReq;
};
const captureCurrentYearFeeSelections = () => {
    if (!selectedFeeAcademicYear) return;
    const yearSelections = {};
    document.querySelectorAll('.fee-item-checkbox:not(:disabled)').forEach((cb) => {
        const input = cb.closest('.relative')?.querySelector('.custom-fee-amount-input');
        yearSelections[cb.dataset.itemKey] = {
            checked: cb.checked,
            type: cb.dataset.itemType || 'month',
            amount: Number(input?.value || 0)
        };
    });
    pendingFeeSelectionsByYear[selectedFeeAcademicYear] = yearSelections;
};

const updateTotalAmount = () => {
    let total = 0;
    const st = getStudentById(selectedStudentId);
    let baseFee = defaultFee;
    if(st) {
        const group = studentGroups.find(g => g.memberIds.includes(st.id));
        if(st.concessionFee !== undefined && st.concessionFee !== null && st.concessionFee !== "") baseFee = parseFloat(st.concessionFee);
        else if(group && group.fee > 0) baseFee = group.fee;
    }

    captureCurrentYearFeeSelections();
    Object.values(pendingFeeSelectionsByYear).forEach((yearSelections = {}) => {
        Object.values(yearSelections).forEach((selection) => {
            if (!selection?.checked) return;
            total += selection.type === 'month' ? baseFee : Number(selection.amount || 0);
        });
    });
    document.getElementById('total-amount').value = total;
    syncGroupedStudentsForSelectedStudent();
    checkReceiptMandatory();
};

const populateFeeItemSelection = () => {
    const st = getStudentById(selectedStudentId);
    const container = document.getElementById('fee-item-selection-container');

    if(!st) {
        container.innerHTML = '<div class="col-span-3 text-center text-xs font-semibold text-gray-400 py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">Search and select a student first</div>';
        document.getElementById('total-amount').value = 0;
        const dueNotice = document.getElementById('fee-due-notice');
        if (dueNotice) {
            dueNotice.textContent = '';
            dueNotice.classList.add('hidden');
        }
        availableFeeAcademicYears = [];
        selectedFeeAcademicYear = '';
        renderFeeYearSwitcher();
        return;
    }

    availableFeeAcademicYears = getAvailableFeeYearsForStudent(st);
    if (!selectedFeeAcademicYear || !availableFeeAcademicYears.includes(selectedFeeAcademicYear)) {
        if (currentWorkingAcademicYear && availableFeeAcademicYears.includes(currentWorkingAcademicYear)) {
            selectedFeeAcademicYear = currentWorkingAcademicYear;
        } else {
            selectedFeeAcademicYear = st.academicYear && availableFeeAcademicYears.includes(st.academicYear)
                ? st.academicYear
                : availableFeeAcademicYears[0];
        }
    }
    renderFeeYearSwitcher();

    const visibleItems = feeItems.filter(i => {
        const itemYear = i.academicYear || getAcademicYearFromDate();
        if (selectedFeeAcademicYear && itemYear !== selectedFeeAcademicYear) return false;
        if(i.isVisible === false) return false;
        if(i.type === 'custom' && st) {
            if(i.scope === 'specific' && i.targetClass !== st.class) return false;
        }
        return true;
    });
    if (!visibleItems.some((item) => item.key === STUDENT_DONATION_ITEM_KEY)) {
        visibleItems.push({ ...STUDENT_DONATION_ITEM, academicYear: selectedFeeAcademicYear || getAcademicYearFromDate() });
    }

    if (visibleItems.length === 0) {
         container.innerHTML = '<div class="col-span-3 text-center text-xs font-semibold text-gray-400 py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">No fee items available</div>';
         document.getElementById('total-amount').value = 0;
         return;
    }

    const renderFeeOption = (item) => {
        let defaultAmt = '';
        let amountLocked = false;
        if(item.type === 'custom' && st) {
            if(item.scope === 'global') defaultAmt = item.amount || '';
            else if(item.scope === 'class-wise' && item.classValues) defaultAmt = item.classValues[st.class] || '';
            else if(item.scope === 'specific') defaultAmt = item.amount || '';
            amountLocked = defaultAmt !== '' && defaultAmt !== null && defaultAmt !== undefined;
        }

        const itemYear = item.academicYear || '--';
        const displayName = normalizeFeeItemName(item.name || 'Fee Item');
        return `
        <div class="relative"><input type="checkbox" id="item-${item.key}" data-item-key="${item.key}" data-item-type="${item.type||'month'}" class="fee-item-checkbox peer sr-only">
        <label for="item-${item.key}" class="block py-2 px-1 text-[11px] sm:text-xs font-semibold border-2 border-red-300 text-red-700 rounded-lg cursor-pointer text-center bg-red-50 peer-checked:bg-green-600 peer-checked:text-white peer-checked:border-green-600 shadow-sm transition fee-item-label" title="${item.name}">
            <div class="leading-tight">
                <div class="font-bold break-words">${displayName}</div>
                <div class="text-[10px] opacity-80 mt-1 block">${itemYear}</div>
                <div class="fee-item-receipt text-[10px] opacity-70 mt-1 h-3"></div>
            </div>
        </label>
        ${item.type === 'custom' ? `<input type="number" data-locked="${amountLocked ? 'true' : 'false'}" ${amountLocked ? 'readonly' : ''} class="custom-fee-amount-input hidden w-full mt-1.5 p-1.5 text-xs font-medium border rounded-md shadow-sm text-center ${amountLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-gray-50'}" placeholder="₹ Amount" value="${defaultAmt}">` : ''}</div>
        `;
    };
    const monthlyItems = sortMonthlyItemsByAcademicYear(
        visibleItems.filter((item) => (item.type || 'month') === 'month'),
        selectedFeeAcademicYear
    );
    const donationItems = visibleItems.filter((item) => item.key === STUDENT_DONATION_ITEM_KEY);
    const otherItems = visibleItems.filter((item) => (item.type || 'month') === 'custom' && item.key !== STUDENT_DONATION_ITEM_KEY);
    const buildSection = (title, items, tone = 'text-gray-500') => {
        if (!items.length) return '';
        return `<div class="col-span-3 mt-2"><div class="text-[10px] uppercase tracking-widest font-bold ${tone} mb-2">${title}</div><div class="grid grid-cols-3 gap-2">${items.map(renderFeeOption).join('')}</div></div>`;
    };
    container.innerHTML = [
        buildSection('Monthly Fees', monthlyItems, 'text-blue-600'),
        buildSection('Other Fees', otherItems, 'text-amber-600'),
        buildSection('Donation (Optional)', donationItems, 'text-emerald-600')
    ].join('');

    if(st) {
        document.querySelectorAll('.fee-item-checkbox').forEach(cb => {
            const isDonationItem = cb.dataset.itemKey === STUDENT_DONATION_ITEM_KEY;
            const pay = allPayments.find((payment) => {
                if (payment.studentId !== st.id || payment.itemKey !== cb.dataset.itemKey) return false;
                return (payment.academicYear || '') === (selectedFeeAcademicYear || '');
            });
            const donationCount = isDonationItem
                ? allPayments.filter((payment) => payment.studentId === st.id && payment.itemKey === STUDENT_DONATION_ITEM_KEY && (payment.academicYear || '') === (selectedFeeAcademicYear || '')).length
                : 0;
            cb.checked = false; cb.disabled = isDonationItem ? false : !!pay;
            const receiptEl = cb.nextElementSibling.querySelector('.fee-item-receipt');
            if (receiptEl) receiptEl.textContent = isDonationItem ? (donationCount ? `${donationCount} donation(s)` : '') : (pay?.receiptNo ? `Rcpt: ${pay.receiptNo}` : '');
            
            // Clear custom colors
            const labelEl = cb.nextElementSibling;
            labelEl.classList.remove('fee-item-paid-elsewhere', 'fee-item-editing-yellow', 'fee-item-new-green');

            if(pay && !isDonationItem) { 
                labelEl.classList.add('fee-item-paid-elsewhere');
                cb.checked = true; 
            }
            const pending = pendingFeeSelectionsByYear[selectedFeeAcademicYear]?.[cb.dataset.itemKey];
            if (!cb.disabled && pending?.checked) {
                cb.checked = true;
                if (cb.dataset.itemType === 'custom') {
                    const customInput = cb.closest('.relative')?.querySelector('.custom-fee-amount-input');
                    if (customInput) {
                        customInput.classList.remove('hidden');
                        if (Number.isFinite(Number(pending.amount))) customInput.value = pending.amount;
                    }
                }
            }
        });
    }
    const dueNotice = document.getElementById('fee-due-notice');
    if (dueNotice) {
        dueNotice.textContent = '';
        dueNotice.classList.add('hidden');
    }
    updateTotalAmount();
};

document.getElementById('fee-item-selection-container').addEventListener('input', e => { if(e.target.classList.contains('custom-fee-amount-input') || e.target.classList.contains('fee-item-checkbox')) updateTotalAmount(); });
document.getElementById('fee-item-selection-container').addEventListener('change', e => {
    if (isEditMode && e.target.classList.contains('fee-item-checkbox')) {
        const cb = e.target;
        const itemKey = cb.dataset.itemKey;
        if (itemKey) editTouchedItemKeys.add(itemKey);
        
        const labelEl = cb.nextElementSibling;
        
        // Remove edit mode specific highlight classes
        labelEl.classList.remove('fee-item-editing-yellow', 'fee-item-new-green');
        
        // If checked, turn it green. If unchecked, defaults to red.
        if (cb.checked) {
            labelEl.classList.add('fee-item-new-green');
        }
    }
    if(e.target.classList.contains('fee-item-checkbox') && e.target.dataset.itemType === 'custom') {
        const input = e.target.closest('.relative').querySelector('.custom-fee-amount-input');
        if(input) {
            const isLocked = input.dataset.locked === 'true';
            input.classList.toggle('hidden', !e.target.checked);
            if(!e.target.checked && !isLocked) input.value = '';
        }
    }
});
document.getElementById('fee-year-prev-btn')?.addEventListener('click', () => {
    if (!selectedStudentId) return;
    captureCurrentYearFeeSelections();
    const index = availableFeeAcademicYears.indexOf(selectedFeeAcademicYear);
    if (index < 0 || index >= availableFeeAcademicYears.length - 1) return;
    selectedFeeAcademicYear = availableFeeAcademicYears[index + 1];
    populateFeeItemSelection();
});
document.getElementById('fee-year-next-btn')?.addEventListener('click', () => {
    if (!selectedStudentId) return;
    captureCurrentYearFeeSelections();
    const index = availableFeeAcademicYears.indexOf(selectedFeeAcademicYear);
    if (index <= 0) return;
    selectedFeeAcademicYear = availableFeeAcademicYears[index - 1];
    populateFeeItemSelection();
});
const setupFeeEntryUI = () => {
    document.getElementById('fee-entry-title').textContent = "Fee Entry";
    document.getElementById('save-fee-btn').classList.remove('hidden'); document.getElementById('cancel-edit-btn').classList.add('hidden'); document.getElementById('update-fee-btn').classList.add('hidden');

    document.getElementById('entry-receipt').value = getNextReceiptNoForStaff();
    document.getElementById('entry-description').value = '';
    document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
    populateFeeItemSelection();
    multiEntryQueue = [];
    renderMultiEntryQueue();
};

const exitEditMode = () => { isEditMode = false; editingPaymentGroup = {}; editTouchedItemKeys = new Set(); resetStudentSelection(); setupFeeEntryUI(); };
document.getElementById('cancel-edit-btn').addEventListener('click', exitEditMode);

const startEditingPayment = (studentId, txnId) => {
    const student = getStudentById(studentId); if(!student) return;
    document.querySelector('.nav-link[data-target="home-page"]').click();
    document.getElementById('entry-class').value = student.class || ''; document.getElementById('entry-gender').value = student.gender || 'all';
    selectedStudentId = student.id; document.getElementById('entry-student-input').value = `${student.name} (Adm: ${student.adm||'-'})`; document.getElementById('student-suggestions').classList.add('hidden');

    isEditMode = true;
    editTouchedItemKeys = new Set();
    document.getElementById('fee-entry-title').textContent = "Edit Payment";
    document.getElementById('save-fee-btn').classList.add('hidden'); document.getElementById('cancel-edit-btn').classList.remove('hidden'); document.getElementById('update-fee-btn').classList.remove('hidden');

    populateFeeItemSelection();

    const parsedKey = parsePaymentGroupKey(txnId);
    const grp = allPayments.filter((payment) => {
        if (parsedKey.type === 'transaction') return payment.transactionId === parsedKey.transactionId;
        if (parsedKey.type === 'receipt') return Number(payment.receiptNo) === parsedKey.receiptNo && (payment.collectedBy || '') === parsedKey.collectedBy;
        return false;
    });
    if(grp.length === 0) return;
    pendingFeeSelectionsByYear = {};
    grp.forEach((payment) => {
        const paymentYear = payment.academicYear || selectedFeeAcademicYear || '';
        if (!pendingFeeSelectionsByYear[paymentYear]) pendingFeeSelectionsByYear[paymentYear] = {};
        const feeItem = feeItems.find((item) => item.key === payment.itemKey);
        pendingFeeSelectionsByYear[paymentYear][payment.itemKey] = {
            checked: true,
            type: feeItem?.type || 'custom',
            amount: Number(payment.amount || 0)
        };
    });

    const firstPaymentYear = grp[0].academicYear || '';
    if (firstPaymentYear && firstPaymentYear !== selectedFeeAcademicYear) {
        selectedFeeAcademicYear = firstPaymentYear;
        populateFeeItemSelection();
    }

    editingPaymentGroup = { txnId, itemKeys: new Set(grp.map((p) => `${p.itemKey}__${p.academicYear || ''}`)) };

    document.getElementById('entry-receipt').value = grp[0].receiptNo || ''; document.getElementById('entry-date').value = grp[0].paymentDate;
    document.getElementById('entry-description').value = grp[0].description || ''; document.getElementById('total-amount').value = grp.reduce((s,p)=>s+p.amount, 0);

    const groupedByStudent = grp.reduce((acc, payment) => {
        if (!acc[payment.studentId]) acc[payment.studentId] = [];
        acc[payment.studentId].push(payment);
        return acc;
    }, {});
    const groupStudentIds = Object.keys(groupedByStudent);
    if (groupStudentIds.length > 1) {
        const toggle = document.getElementById('multi-entry-toggle');
        if (toggle) toggle.checked = false;
        multiEntryQueue = [];
        renderMultiEntryQueue();
        renderGroupedStudentsPanel();
    }

    document.querySelectorAll('.fee-item-checkbox').forEach(cb => {
        const isPaidHere = editingPaymentGroup.itemKeys.has(`${cb.dataset.itemKey}__${selectedFeeAcademicYear || ''}`);
        const isPaidElsewhere = allPayments.some((payment) => {
            if (payment.studentId !== studentId || payment.itemKey !== cb.dataset.itemKey) return false;
            if ((payment.academicYear || '') !== (selectedFeeAcademicYear || '')) return false;
            return getPaymentGroupKey(payment) !== txnId;
        });
        
        cb.checked = isPaidHere; 
        cb.disabled = isPaidElsewhere;
        
        const labelEl = cb.nextElementSibling;
        labelEl.classList.remove('fee-item-paid-elsewhere', 'fee-item-editing-yellow', 'fee-item-new-green');
        
        if(isPaidHere) {
            labelEl.classList.add('fee-item-editing-yellow');
            if(cb.dataset.itemType === 'custom') { 
                const input = cb.closest('.relative').querySelector('.custom-fee-amount-input'); 
                input.value = (grp.find((p) => p.itemKey === cb.dataset.itemKey && (p.academicYear || '') === (selectedFeeAcademicYear || ''))?.amount) || ''; 
                input.classList.remove('hidden'); 
            }
        } else if(isPaidElsewhere) { 
            labelEl.classList.add('fee-item-paid-elsewhere');
            cb.checked = true; // Visual check for disabled item
        }
    });
    checkReceiptMandatory();
};

const processPaymentSubmit = async (isUpdate) => {
    if (isPaymentMutationInFlight) return;
    if(!selectedStudentId && !multiEntryQueue.length) return alert("ദയവായി ഒരു വിദ്യാർത്ഥിയെ തിരഞ്ഞെടുക്കുക.");
    captureCurrentYearFeeSelections();
    const selected = buildSelectedItemsForCurrentStudent();
    const selectedGroup = selectedStudentId ? studentGroups.find((g) => Array.isArray(g.memberIds) && g.memberIds.includes(selectedStudentId)) : null;
    const primaryEntry = selectedStudentId ? { studentId: selectedStudentId, studentName: getStudentById(selectedStudentId)?.name || 'Student', classLabel: getStudentById(selectedStudentId)?.class || '', items: selected, total: calculateEntryTotalForStudent(selected, selectedStudentId), billingGroupId: selectedGroup?.id || null } : null;
    const allEntries = isMultiEntryMode() ? [...multiEntryQueue, primaryEntry].filter(Boolean) : [primaryEntry].filter(Boolean);
    if(allEntries.length === 0 || allEntries.every((entry) => !entry.items.length)) return alert("ദയവായി ഫീസ് ഐറ്റം തിരഞ്ഞെടുക്കുക.");

    const rcptStr = document.getElementById('entry-receipt').value.trim();
    const rcpt = rcptStr ? parseInt(rcptStr) : null;

    const isReq = checkReceiptMandatory();
    if(isReq && !rcpt) return alert("തിരഞ്ഞെടുത്ത ഫീസിന് രസീത് നമ്പർ നിർബന്ധമാണ്.");

    if(rcpt) {
        const isDup = allPayments.some((payment) => {
            if (payment.receiptNo !== rcpt || payment.collectedBy !== getCollectorKey()) return false;
            if (!isUpdate) return true;
            return getPaymentGroupKey(payment) !== editingPaymentGroup.txnId;
        });
        if(isDup) return alert(`രസീത് നമ്പർ ${rcpt} ഉപയോഗിച്ചിട്ടുണ്ട്. ദയവായി വേറൊരു നമ്പർ നൽകുക.`);
    }

    const dt = document.getElementById('entry-date').value;
    const desc = document.getElementById('entry-description').value.trim();
    const visibleTotal = parseFloat(document.getElementById('total-amount').value || 0);
    const uniqueTotals = new Map();
    allEntries.forEach((entry) => {
        const groupKey = entry.billingGroupId || `single-${entry.studentId}`;
        if (!uniqueTotals.has(groupKey)) uniqueTotals.set(groupKey, Number(entry.total || 0));
    });
    const effectiveTotal = [...uniqueTotals.values()].reduce((sum, amount) => sum + amount, 0);
    const tot = isMultiEntryMode() ? effectiveTotal : visibleTotal;
    if(!dt || isNaN(tot)) return alert("തിയ്യതിയും തുകയും പരിശോധിക്കുക.");

    const confirmBtn = document.getElementById('confirm-ok');
    document.getElementById('confirm-title').textContent = isUpdate ? 'Update Payment' : 'Confirm Payment';
    const confirmMessage = document.getElementById('confirm-message');
    const titleLine = document.createElement('p');
    titleLine.className = 'font-medium text-gray-800';
    titleLine.textContent = isUpdate ? 'മാറ്റങ്ങൾ സേവ് ചെയ്യട്ടെ?' : (isMultiEntryMode() ? `${allEntries.length} വിദ്യാർത്ഥികളുടെ ഫീസ് ഒരേ രസീതിൽ സേവ് ചെയ്യട്ടെ?` : `${getStudentById(selectedStudentId).name} ന്റെ ഫീസ് സേവ് ചെയ്യട്ടെ?`);
    const amountLine = document.createElement('p');
    amountLine.className = 'mt-2 text-sm text-gray-500 font-mono';
    amountLine.textContent = `ആകെ തുക: ₹${tot}`;
    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'mt-2 text-xs text-slate-600 space-y-1 max-h-40 overflow-y-auto';
    const finalEntries = allEntries.filter((entry) => (entry.items || []).length);
    finalEntries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'flex justify-between gap-3 bg-slate-50 rounded px-2 py-1';
        row.innerHTML = `<span>${escapeHtml(entry.studentName)} (${escapeHtml(entry.classLabel || '--')})</span><b>₹${Number(entry.total || 0).toFixed(0)}</b>`;
        detailsWrap.appendChild(row);
    });
    confirmMessage.replaceChildren(titleLine, amountLine, detailsWrap);
    document.getElementById('confirm-popup').classList.remove('hidden'); document.getElementById('confirm-popup').classList.add('flex');

    confirmBtn.onclick = async () => {
        if (isPaymentMutationInFlight) return;
        isPaymentMutationInFlight = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i> Processing...`; confirmBtn.disabled = true;
        const saveBtn = document.getElementById('save-fee-btn');
        const updateBtn = document.getElementById('update-fee-btn');
        if (saveBtn) saveBtn.disabled = true;
        if (updateBtn) updateBtn.disabled = true;
        try {
            const batch = writeBatch(db);
            const tId = isUpdate ? editingPaymentGroup.txnId : (Date.now().toString() + Math.random().toString(36).substr(2, 5));

            if(isUpdate) {
                const docsToDelete = await collectPaymentDocsForGroup(editingPaymentGroup.txnId, '');
                docsToDelete.forEach((docSnap) => {
                    batch.delete(docSnap.ref);
                    const payment = docSnap.data();
                    const yearPath = getYearPaymentsCollectionPath(payment.academicYear || '');
                    batch.delete(doc(db, yearPath, docSnap.id));
                });
            }

            const currentStaffName = isCurrentAdmin ? 'Administrator' : (allStaff.find(s=>s.email===currentUserEmail)?.name || currentUserEmail);
            const writtenGroupedMonthlyItems = new Set();
            allEntries.forEach((entry) => {
                const entrySelected = entry.items || [];
                if (!entrySelected.length) return;
                const customCbs = entrySelected.filter((item) => item.itemType === 'custom');
                const monthlyCbs = entrySelected.filter((item) => item.itemType === 'month');
                const customTot = customCbs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
                const studentClass = students.find((student) => student.id === entry.studentId)?.class || '';
                const entryTot = Number(entry.total || 0);
                const common = {
                    receiptNo: rcpt,
                    transactionId: tId,
                    paymentDate: dt,
                    timestamp: Date.now(),
                    description: desc,
                    collectedBy: getCollectorKey(),
                    collectedByName: currentStaffName,
                    academicYear: selectedFeeAcademicYear || '',
                    classLabel: studentClass
                };
                if (monthlyCbs.length > 0) {
                    const amtPer = Math.max(0, (entryTot - customTot) / monthlyCbs.length);
                    customCbs.forEach((item) => {
                        queuePaymentWrite(batch, { ...common, academicYear: item.year || common.academicYear, studentId: entry.studentId, itemKey: item.itemKey, amount: Number(item.amount || 0), billingGroupId: entry.billingGroupId || null });
                    });
                    monthlyCbs.forEach((item) => {
                        const group = getStudentBillingGroup(entry.studentId);
                        const targetIds = group ? (group.memberIds || []) : [entry.studentId];
                        const billingGroupId = group?.id || entry.billingGroupId || null;
                        const itemYear = item.year || common.academicYear;
                        const groupedItemKey = billingGroupId ? `${billingGroupId}__${item.itemKey}__${itemYear}` : '';
                        if (groupedItemKey && writtenGroupedMonthlyItems.has(groupedItemKey)) return;
                        if (groupedItemKey) writtenGroupedMonthlyItems.add(groupedItemKey);
                        const amountPerStudent = targetIds.length > 1 ? Math.max(0, amtPer / targetIds.length) : Math.max(0, amtPer);
                        targetIds.forEach((id) => {
                            queuePaymentWrite(batch, { ...common, academicYear: itemYear, studentId: id, itemKey: item.itemKey, amount: amountPerStudent, billingGroupId });
                        });
                    });
                } else {
                    customCbs.forEach((item) => {
                        queuePaymentWrite(batch, { ...common, academicYear: item.year || common.academicYear, studentId: entry.studentId, itemKey: item.itemKey, amount: Number(item.amount || 0), billingGroupId: entry.billingGroupId || null });
                    });
                }
            });

            await batch.commit();
            if(!isUpdate) document.getElementById('entry-receipt').value = rcpt ? rcpt + 1 : '';
            exitEditMode();
        } catch (e) { console.error(e); alert("Failed."); }
        finally {
            isPaymentMutationInFlight = false;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'OK';
            if (saveBtn) saveBtn.disabled = false;
            if (updateBtn) updateBtn.disabled = false;
            document.getElementById('confirm-popup').classList.add('hidden');
        }
    };
};

document.getElementById('save-fee-btn').addEventListener('click', () => processPaymentSubmit(false));
document.getElementById('update-fee-btn').addEventListener('click', () => processPaymentSubmit(true));


// --- BULK UPLOAD LOGIC ---
const setupBulkUploadUI = () => {
    const yearSelect = document.getElementById('bulk-academic-year');
    if (yearSelect) {
        yearSelect.innerHTML = `<option value="">-- Select Academic Year --</option>` +
            academicYearSettings.map(y => `<option value="${y.label}">${y.label}</option>`).join('');
        if (currentWorkingAcademicYear) yearSelect.value = currentWorkingAcademicYear;
    }
    document.getElementById('bulk-default-fee').value = defaultFee;
    document.getElementById('bulk-progress-container').classList.add('hidden');
    document.getElementById('bulk-preview-area').classList.add('hidden');
    document.getElementById('bulk-drop-zone').classList.remove('hidden');
    document.getElementById('bulk-file-input').value = '';
    window.bulkUploadParsedData = null;
};

// EXCEL/CSV Template Download Logic
document.getElementById('bulk-download-btn')?.addEventListener('click', () => {
    const year = document.getElementById('bulk-academic-year').value;
    const targetClass = document.getElementById('bulk-class').value;
    const defFee = document.getElementById('bulk-default-fee').value;

    if (!year || !targetClass || !defFee) {
        alert("ദയവായി Academic Year, Target Class, Default Fee എന്നിവ നൽകുക.");
        return;
    }

    const filteredStudents = allStudentsRaw.filter(s => s.class === targetClass && (s.academicYear || currentWorkingAcademicYear) === year);
    if (filteredStudents.length === 0) {
        alert("ഈ ക്ലാസ്സിൽ ഈ അക്കാദമിക് വർഷം വിദ്യാർത്ഥികൾ ആരും ഇല്ല.");
        return;
    }

    const monthlyItems = sortMonthlyItemsByAcademicYear(
        feeItems.filter(item => (item.type || 'month') === 'month' && (!item.academicYear || item.academicYear === year)),
        year
    );

    if (monthlyItems.length === 0) {
        alert("ഈ അക്കാദമിക് വർഷത്തിൽ പ്രതിമാസ ഫീസ് ഇനങ്ങൾ (Monthly Fee Items) കണ്ടെത്തിയില്ല.");
        return;
    }

    // 1. Create Headers
    let headers = ['Student_ID', 'Admission_No', 'Student_Name'];
    monthlyItems.forEach(item => {
        const safeName = normalizeFeeItemName(item.name).replace(/[^a-zA-Z0-9]/g, '_');
        headers.push(`${safeName}_Amount`);
        headers.push(`${safeName}_ReceiptNo`);
        headers.push(`${safeName}_Date`);
    });

    const rowsData = [headers];

    // 2. Create Model Row (Sample Entry)
    const todayStr = new Date().toISOString().split('T')[0];
    const modelRow = ['SAMPLE-ID-DO-NOT-DELETE', '1234', 'Model Student Name'];
    monthlyItems.forEach(() => {
        modelRow.push(defFee);     // Amount
        modelRow.push('1001');     // Sample Receipt No
        modelRow.push(todayStr);   // Date YYYY-MM-DD
    });
    rowsData.push(modelRow);

    // 3. Add Actual Student Data
    filteredStudents.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(student => {
        const rowData = [
            student.id,
            student.adm || '',
            student.name || ''
        ];

        monthlyItems.forEach(() => {
            rowData.push(defFee); // Amount pre-filled
            rowData.push('');     // Empty Receipt
            rowData.push('');     // Empty Date
        });
        rowsData.push(rowData);
    });

    // Generate Excel File using SheetJS
    try {
        const ws = XLSX.utils.aoa_to_sheet(rowsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Fee_Template");
        
        const safeClassName = targetClass.replace(/[^a-zA-Z0-9]/g, '_');
        XLSX.writeFile(wb, `Bulk_Fee_Template_${safeClassName}_${year}.xlsx`);
    } catch (e) {
        console.error("Excel generation failed:", e);
        alert("ടെമ്പ്ലേറ്റ് നിർമ്മിക്കുന്നതിൽ എറർ സംഭവിച്ചു.");
    }
});

// SheetJS Excel/CSV Upload & Parse Logic
const handleBulkFileSelection = (file) => {
    if (!file) return;
    const year = document.getElementById('bulk-academic-year').value;
    const targetClass = document.getElementById('bulk-class').value;

    if (!year || !targetClass) {
        alert("ദയവായി Academic Year ഉം Target Class ഉം സെലക്ട് ചെയ്ത ശേഷം ഫയൽ അപ്‌ലോഡ് ചെയ്യുക.");
        document.getElementById('bulk-file-input').value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to Array of Arrays
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            
            if (rows.length < 2) {
                alert("ഫയലിൽ ഡാറ്റ കണ്ടെത്തിയില്ല.");
                return;
            }

            const headers = rows[0];
            if (headers[0] !== 'Student_ID' || headers[1] !== 'Admission_No') {
                alert("തെറ്റായ ഫയൽ ഫോർമാറ്റ്. ദയവായി ഡൗൺലോഡ് ചെയ്ത ടെമ്പ്ലേറ്റ് മാത്രം ഉപയോഗിക്കുക.");
                return;
            }

            const monthlyItems = sortMonthlyItemsByAcademicYear(
                feeItems.filter(item => (item.type || 'month') === 'month' && (!item.academicYear || item.academicYear === year)),
                year
            );

            window.bulkUploadParsedData = { rows: rows.slice(1), headers, monthlyItems, year, targetClass };
            
            document.getElementById('bulk-file-name').textContent = file.name;
            document.getElementById('bulk-record-count').textContent = `Found ${rows.length - 1} rows to check`;
            document.getElementById('bulk-drop-zone').classList.add('hidden');
            document.getElementById('bulk-preview-area').classList.remove('hidden');
            document.getElementById('bulk-start-upload-btn').disabled = false;
            document.getElementById('bulk-start-upload-btn').innerHTML = `<i class="fas fa-cogs"></i> Start Processing`;
            document.getElementById('bulk-progress-container').classList.add('hidden');

        } catch (error) {
            console.error("Parse Error:", error);
            alert("ഫയൽ വായിക്കുന്നതിൽ എറർ സംഭവിച്ചു. ശരിയായ Excel/CSV ഫയലാണോ എന്ന് ഉറപ്പുവരുത്തുക.");
            document.getElementById('bulk-file-input').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

document.getElementById('bulk-file-input')?.addEventListener('change', (e) => handleBulkFileSelection(e.target.files[0]));

const bulkDropZone = document.getElementById('bulk-drop-zone');
if (bulkDropZone) {
    bulkDropZone.addEventListener('dragover', (e) => { e.preventDefault(); bulkDropZone.classList.add('dragover'); });
    bulkDropZone.addEventListener('dragleave', () => bulkDropZone.classList.remove('dragover'));
    bulkDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        bulkDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleBulkFileSelection(e.dataTransfer.files[0]);
    });
    bulkDropZone.addEventListener('click', () => document.getElementById('bulk-file-input').click());
}

document.getElementById('bulk-cancel-btn')?.addEventListener('click', setupBulkUploadUI);

document.getElementById('bulk-start-upload-btn')?.addEventListener('click', async () => {
    if (!window.bulkUploadParsedData) return;
    
    const btn = document.getElementById('bulk-start-upload-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;
    
    document.getElementById('bulk-progress-container').classList.remove('hidden');
    const progressBar = document.getElementById('bulk-progress-bar');
    const progressPct = document.getElementById('bulk-progress-pct');
    const progressText = document.getElementById('bulk-progress-text');
    
    const { rows, headers, monthlyItems, year, targetClass } = window.bulkUploadParsedData;
    const collectorName = isCurrentAdmin ? 'Administrator' : (allStaff.find(s => s.email === currentUserEmail)?.name || currentUserEmail);
    const collectorUserKey = getCollectorKey();

    let paymentOperations = [];
    let autoReceiptNo = getNextReceiptNoForStaff() || 1;

    for (const row of rows) {
        if (!row || row.length < 3) continue;
        const studentId = String(row[0]).trim();
        
        // Skip Model/Sample row automatically
        if (studentId === 'SAMPLE-ID-DO-NOT-DELETE') continue;

        const student = allStudentsRaw.find(s => s.id === studentId);
        if (!student || student.class !== targetClass || (student.academicYear || currentWorkingAcademicYear) !== year) {
            continue; 
        }

        let transactionId = Date.now().toString() + Math.random().toString(36).substring(2, 6);

        monthlyItems.forEach((item) => {
            const safeName = normalizeFeeItemName(item.name).replace(/[^a-zA-Z0-9]/g, '_');
            const amtIndex = headers.indexOf(`${safeName}_Amount`);
            const rcptIndex = headers.indexOf(`${safeName}_ReceiptNo`);
            const dateIndex = headers.indexOf(`${safeName}_Date`);

            if (amtIndex !== -1 && dateIndex !== -1) {
                const amtVal = parseFloat(row[amtIndex]);
                // SheetJS might convert dates to numbers, or return formatted string
                // We handle common JS Date casting if needed, or simple string read
                const rawDate = row[dateIndex];
                let dateVal = '';
                
                if (typeof rawDate === 'number') {
                    // Excel date serial number handling
                    const d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
                    dateVal = d.toISOString().split('T')[0];
                } else if (rawDate) {
                    dateVal = String(rawDate).trim();
                }

                const rcptVal = rcptIndex !== -1 ? String(row[rcptIndex] || '').trim() : '';

                if (!isNaN(amtVal) && amtVal > 0 && dateVal) {
                    // Validate basic YYYY-MM-DD
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
                        console.warn(`Invalid date format for student ${student.name}. Expected YYYY-MM-DD. Found: ${dateVal}`);
                        return;
                    }

                    const isAlreadyPaid = allPayments.some(p => p.studentId === studentId && p.itemKey === item.key && (p.academicYear || '') === year);
                    if (isAlreadyPaid) return;

                    let finalReceiptNo = null;
                    if (rcptVal) {
                        finalReceiptNo = parseInt(rcptVal, 10);
                    } else {
                        finalReceiptNo = autoReceiptNo;
                        autoReceiptNo++;
                    }

                    const paymentData = {
                        studentId: studentId,
                        itemKey: item.key,
                        amount: amtVal,
                        receiptNo: finalReceiptNo,
                        transactionId: transactionId,
                        paymentDate: dateVal,
                        timestamp: new Date(dateVal).getTime() || Date.now(),
                        description: "Bulk Upload",
                        collectedBy: collectorUserKey,
                        collectedByName: collectorName,
                        academicYear: year,
                        classLabel: student.class || ''
                    };
                    paymentOperations.push(paymentData);
                }
            }
        });
    }

    if (paymentOperations.length === 0) {
        alert("അപ്‌ലോഡ് ചെയ്യാൻ സാധുവായ ഫീസ് ഡാറ്റയൊന്നും കണ്ടെത്തിയില്ല. (മുമ്പ് അടച്ചവ ഒഴിവാക്കപ്പെട്ടു).");
        setupBulkUploadUI();
        return;
    }

    const CHUNK_SIZE = 150; 
    let successCount = 0;

    try {
        for (let i = 0; i < paymentOperations.length; i += CHUNK_SIZE) {
            const batch = writeBatch(db);
            const chunk = paymentOperations.slice(i, i + CHUNK_SIZE);
            
            chunk.forEach(payload => {
                queuePaymentWrite(batch, payload);
            });
            
            await batch.commit();
            successCount += chunk.length;
            
            const pct = Math.round((successCount / paymentOperations.length) * 100);
            progressBar.style.width = `${pct}%`;
            progressPct.textContent = `${pct}%`;
            progressText.textContent = `Saving ${successCount} of ${paymentOperations.length}...`;
        }

        progressBar.style.width = `100%`;
        progressPct.textContent = `100%`;
        progressText.textContent = "Upload Complete!";
        
        setTimeout(() => {
            alert(`വിജയകരം! ${successCount} ഫീസ് റെക്കോർഡുകൾ സിസ്റ്റത്തിൽ അപ്ഡേറ്റ് ചെയ്തു.`);
            setupBulkUploadUI();
            document.querySelector('.nav-link[data-target="dashboard-page"]')?.click();
        }, 800);

    } catch (error) {
        console.error("Bulk Upload Error:", error);
        alert("അപ്‌ലോഡ് ചെയ്യുന്നതിനിടയിൽ എറർ സംഭവിച്ചു. നെറ്റ്വർക്ക് പരിശോധിക്കുക.");
        setupBulkUploadUI();
    }
});


const downloadFeeStatusPdf = () => {
    const { list, items: rawItems } = buildFeeStatusMatrix();
    const items = sortFeeItemsForDisplay(rawItems);
    if (!list.length || !items.length) {
        alert('No fee status data available to export.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF({ orientation: items.length > 6 ? 'landscape' : 'portrait' });
    const title = document.getElementById('fee-status-title-header')?.textContent || 'Fee Status';
    const conf = window.institutionConfig || {};
    const institutionName = conf.appName || document.getElementById('header-title')?.textContent || 'Institution';
    const placeText = conf.place || document.getElementById('header-place')?.textContent?.trim() || '';
    const regRaw = conf.regNo || document.getElementById('header-regno')?.textContent?.trim() || '';
    const regText = regRaw && regRaw.toLowerCase().includes('reg') ? regRaw : (regRaw ? `Reg No: ${regRaw}` : '');
    const regPlace = [placeText, regText].filter(Boolean).join(' • ');
    const generatedOn = new Date().toLocaleString();
    const selectedClass = document.getElementById('filter-class')?.value || 'all';
    const classLabel = selectedClass === 'all' ? 'All Classes' : selectedClass;
    const pageWidth = docPdf.internal.pageSize.getWidth();

    docPdf.setFontSize(16);
    docPdf.text(institutionName, pageWidth / 2, 14, { align: 'center' });
    docPdf.setFontSize(10);
    docPdf.text(regPlace || '--', pageWidth / 2, 20, { align: 'center' });
    docPdf.text(`Generated: ${generatedOn}`, pageWidth / 2, 26, { align: 'center' });
    docPdf.setFontSize(12);
    docPdf.text(title, 14, 34);
    docPdf.text(`Class: ${classLabel}`, pageWidth / 2, 34, { align: 'center' });

    const groupedClasses = Object.values(list.reduce((acc, student) => {
        const classKey = String(student.class || '--');
        if (!acc[classKey]) acc[classKey] = { classLabel: classKey, male: [], female: [] };
        const gender = String(student.gender || '').toLowerCase();
        if (gender === 'male') acc[classKey].male.push(student);
        else acc[classKey].female.push(student);
        return acc;
    }, {})).sort((a, b) => a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }));

    const buildRows = (students = []) => students
        .sort((a, b) => String(a.adm || '').localeCompare(String(b.adm || ''), undefined, { numeric: true }) || String(a.name || '').localeCompare(String(b.name || '')))
        .map((student, idx) => {
            const row = [idx + 1, student.adm || '-', student.name];
            items.forEach((item) => {
                const payment = allPayments.find((pay) => pay.studentId === student.id && pay.itemKey === item.key);
                row.push(payment ? (item.type === 'custom' ? `₹${Number(payment.amount || 0).toFixed(0)}` : (payment.receiptNo ? `R:${payment.receiptNo}` : 'Paid')) : '-');
            });
            return row;
        });

    let currentY = 40;
    groupedClasses.forEach((classGroup, classIndex) => {
        if (classIndex > 0) currentY = docPdf.lastAutoTable ? docPdf.lastAutoTable.finalY + 10 : currentY + 10;
        docPdf.setFontSize(11);
        docPdf.text(`Class: ${classGroup.classLabel}`, 14, currentY);
        currentY += 3;

        const maleRows = buildRows(classGroup.male);
        if (maleRows.length) {
            docPdf.autoTable({
                startY: currentY,
                head: [[ 'Sl No', 'Adm No', 'Student (Boys)', ...items.map((item) => normalizeFeeItemName(item.name)) ]],
                body: maleRows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [37, 99, 235] },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });
            currentY = docPdf.lastAutoTable.finalY + 4;
        }

        const femaleRows = buildRows(classGroup.female);
        if (femaleRows.length) {
            docPdf.autoTable({
                startY: currentY,
                head: [[ 'Sl No', 'Adm No', 'Student (Girls)', ...items.map((item) => normalizeFeeItemName(item.name)) ]],
                body: femaleRows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [16, 185, 129] },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });
            currentY = docPdf.lastAutoTable.finalY + 4;
        }
    });

    docPdf.save(`${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'fee-status'}.pdf`);
};

document.getElementById('fee-download-pdf-btn')?.addEventListener('click', downloadFeeStatusPdf);

// --- FEE STATUS RENDER ---
const renderFeeTable = () => {
    const cont = document.getElementById('fee-table-container');
    const { list, items: rawItems } = buildFeeStatusMatrix();
    const items = sortFeeItemsForDisplay(rawItems);
    if(list.length === 0) { cont.innerHTML = `<p class="text-gray-500 text-center py-6">No data found.</p>`; return; }

    if (items.length === 0) { cont.innerHTML = `<p class="text-gray-500 text-center py-6">No fee items configured.</p>`; return; }

    const matrixYears = [...new Set(items.map((item) => item.academicYear).filter(Boolean))];
    const matrixYearLabel = matrixYears.length === 1 ? matrixYears[0] : (matrixYears.length ? 'Multi-Year' : (selectedFeeAcademicYear || getAcademicYearFromDate()));
    const headerEl = document.getElementById('fee-status-title-header');
    if (headerEl) headerEl.textContent = `${feeStatusTitle || 'Fee Status'} (${matrixYearLabel})`;
    let html = `<table class="w-full text-sm text-left whitespace-nowrap"><thead class="table-header"><tr><th class="p-3">Adm.No</th><th class="p-3">Student Name</th>${items.map(i=>`<th class="p-3">${normalizeFeeItemName(i.name)}</th>`).join('')}</tr></thead><tbody class="divide-y divide-gray-200">`;

    Object.values(list.reduce((acc, s) => {
        const k=`${s.class}#${s.gender}`;
        if (!acc[k]) acc[k] = { class: s.class, gender: s.gender, students: [] };
        acc[k].students.push(s);
        return acc;
    }, {}))
    .sort((a,b) => {
        const classCompare = a.class.localeCompare(b.class, undefined, {numeric: true});
        if (classCompare !== 0) return classCompare;
        if (a.gender === 'Male' && b.gender !== 'Male') return -1;
        if (a.gender !== 'Male' && b.gender === 'Male') return 1;
        return 0;
    })
    .forEach(g => {
        html += `<tr class="bg-gray-100 font-bold text-gray-800"><td colspan="${items.length+2}" class="p-3">${g.class} - ${g.gender}</td></tr>`;

        g.students.sort((a,b) => (a.adm||'').localeCompare(b.adm||'', undefined, {numeric: true})).forEach(s => {
            html += `<tr class="hover:bg-gray-50 bg-white"><td class="p-3 font-mono text-gray-500">${s.adm || '-'}</td><td class="p-3 font-medium text-gray-900 border-r">${s.name}</td>`;
            items.forEach(i => {
                const p = allPayments.find(pay => pay.studentId === s.id && pay.itemKey === i.key);
                if(p) {
                    const staffName = getStaffName(p.collectedBy, p.collectedByName);
                    html += `<td class="p-2 text-center bg-green-50 border-r">
                        <div class="${i.type==='custom'?'text-sm':'text-xs'} font-bold text-green-800">${i.type==='custom'?`₹${p.amount.toFixed(0)}`:(p.receiptNo?`R:${p.receiptNo}`:'Paid')}</div>
                        <div class="text-[10px] text-green-600">${new Date(p.paymentDate).toLocaleDateString('en-GB')}</div>
                        <div class="text-[9px] text-gray-500 font-semibold mt-1 max-w-[80px] truncate mx-auto" title="${staffName}">By: ${staffName}</div>
                    </td>`;
                } else {
                    html += `<td class="p-3 text-center text-gray-300 border-r">-</td>`;
                }
            });
            html += `</tr>`;
        });
    });
    cont.innerHTML = html + `</tbody></table>`;
};

const getClassSortValue = (classLabel = '') => {
    const text = String(classLabel || '').toUpperCase();
    const numberMatch = text.match(/\d+/);
    if (numberMatch) return Number(numberMatch[0]);
    if (text.includes('PLUS TWO') || text.includes('+2')) return 12;
    if (text.includes('PLUS ONE') || text.includes('+1')) return 11;
    if (text.includes('UKG')) return 0.2;
    if (text.includes('LKG')) return 0.1;
    return -1;
};
const compareClassesHighToLow = (a = '', b = '') => {
    const rankDiff = getClassSortValue(b) - getClassSortValue(a);
    if (rankDiff !== 0) return rankDiff;
    return String(b || '').localeCompare(String(a || ''), undefined, { numeric: true, sensitivity: 'base' });
};
const studentConcGroupSearchText = (student = {}) => [student.name, student.adm, student.class, student.concessionFee]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
const groupConcGroupSearchText = (group = {}, members = []) => [
    group.fee,
    ...members.flatMap((member) => [member.name, member.adm, member.class])
].map((value) => String(value || '').toLowerCase()).join(' ');
const renderConcessionGroupOverview = () => {
    const yearSelect = document.getElementById('conc-group-year-select');
    const searchInput = document.getElementById('conc-group-search-input');
    const selectedYear = yearSelect?.value || currentWorkingAcademicYear || getAcademicYearFromDate();
    if (yearSelect && !yearSelect.dataset.bound) {
        const years = [...new Set(students.map((s) => s.academicYear).filter(Boolean).concat([currentWorkingAcademicYear]).filter(Boolean))].sort(compareAcademicYears);
        yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
        yearSelect.value = selectedYear;
        yearSelect.dataset.bound = '1';
        yearSelect.addEventListener('change', renderConcessionGroupOverview);
    }
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        searchInput.addEventListener('input', renderConcessionGroupOverview);
    }
    const activeYear = yearSelect?.value || selectedYear;
    const searchTerm = (searchInput?.value || '').trim().toLowerCase();
    const yearStudents = students.filter((student) => (student.academicYear || '') === activeYear);
    const concessionStudents = yearStudents
        .filter((student) => student.concessionFee !== undefined && student.concessionFee !== null && student.concessionFee !== '')
        .filter((student) => !searchTerm || studentConcGroupSearchText(student).includes(searchTerm))
        .sort((a, b) => compareClassesHighToLow(a.class, b.class) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const groupEntries = studentGroups
        .filter((group) => (group.academicYear || activeYear) === activeYear)
        .map((group) => ({
            group,
            members: (group.memberIds || [])
                .map((memberId) => students.find((student) => student.id === memberId))
                .filter(Boolean)
                .sort((a, b) => compareClassesHighToLow(a.class, b.class) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
        }))
        .filter((entry) => !searchTerm || groupConcGroupSearchText(entry.group, entry.members).includes(searchTerm))
        .sort((a, b) => {
            const topClassA = a.members[0]?.class || '';
            const topClassB = b.members[0]?.class || '';
            return compareClassesHighToLow(topClassA, topClassB)
                || String(a.members[0]?.name || '').localeCompare(String(b.members[0]?.name || ''), undefined, { sensitivity: 'base' });
        });
    const groupRows = groupEntries.map(({ group, members }, idx) => `<div class="bg-white border border-blue-100 rounded-xl p-4">
        <div class="font-bold text-blue-800 mb-2">Group ${idx + 1} ${group.fee ? `<span class="text-xs bg-blue-50 px-2 py-1 rounded ml-2">₹${group.fee}/month</span>` : ''}</div>
        <div class="space-y-1 text-sm">${members.map((member) => `<div>${escapeHtml(member.name || '--')} <span class="text-gray-500">(${escapeHtml(member.class || '--')}${member.adm ? ` · Adm: ${escapeHtml(member.adm)}` : ''})</span></div>`).join('') || '<div class="text-gray-400">No members</div>'}</div>
    </div>`);
    const emptyLabel = searchTerm ? 'No matching records' : 'No concessions';
    const emptyGroupLabel = searchTerm ? 'No matching groups' : 'No groups';
    document.getElementById('conc-group-summary').innerHTML = `
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><div class="text-xs uppercase font-bold text-emerald-700">Concession Students</div><div class="text-2xl font-bold text-emerald-800">${concessionStudents.length}</div></div>
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-3"><div class="text-xs uppercase font-bold text-blue-700">Groups</div><div class="text-2xl font-bold text-blue-800">${groupRows.length}</div></div>`;
    document.getElementById('conc-group-content').innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-white border border-gray-200 rounded-xl p-4"><div class="font-bold mb-2 text-gray-800">Concession List</div>${concessionStudents.map((student, idx) => `<div class="text-sm py-1 border-b">${idx + 1}. ${escapeHtml(student.name || '--')} <span class="text-gray-500">(${escapeHtml(student.class || '--')}${student.adm ? ` · Adm: ${escapeHtml(student.adm)}` : ''})</span> <span class="font-bold text-emerald-700">₹${escapeHtml(String(student.concessionFee))}</span></div>`).join('') || `<div class="text-sm text-gray-500">${emptyLabel}</div>`}</div>
            <div><div class="font-bold mb-2 text-gray-800">Group List</div><div class="space-y-3">${groupRows.join('') || `<div class="text-sm text-gray-500">${emptyGroupLabel}</div>`}</div></div>
        </div>`;
};
document.getElementById('conc-group-download-pdf-btn')?.addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    const text = document.getElementById('conc-group-content')?.innerText || 'No data';
    pdf.setFontSize(14);
    pdf.text('Concession & Group Overview', 14, 16);
    pdf.setFontSize(10);
    pdf.text(text.split('\n').slice(0, 220), 14, 24);
    pdf.save('concession-group-overview.pdf');
});

// --- HISTORY RENDER ---
const updateHistoryStaffFilter = () => {
    const filterEl = document.getElementById('history-staff-filter');
    if (!isCurrentAdmin) { filterEl.classList.add('hidden'); return; }
    filterEl.classList.remove('hidden');

    const uniqueEmails = [...new Set(allPayments.map(p => p.collectedBy))].filter(Boolean);
    const currentVal = filterEl.value;

    let opts = `<option value="all">All Staff Collections</option>`;
    uniqueEmails.forEach(email => { opts += `<option value="${email}">${getStaffName(email, null)}</option>`; });

    filterEl.innerHTML = opts;
    if(uniqueEmails.includes(currentVal) || currentVal === 'all') filterEl.value = currentVal;
};

const prepareHistoryData = () => {
    historyRenderToken += 1;
    if (historyLoadTimer) {
        clearTimeout(historyLoadTimer);
        historyLoadTimer = null;
    }

    let myPays = isCurrentAdmin ? [...allPayments] : allPayments.filter((payment) => payment.collectedBy === getCollectorKey());
    let myDonations = isCurrentAdmin ? [...allDonations] : allDonations.filter((donation) => donation.collectedBy === getCollectorKey());

    if (isCurrentAdmin) {
        const staffFilter = document.getElementById('history-staff-filter').value;
        if (staffFilter && staffFilter !== 'all') {
            myPays = myPays.filter(p => p.collectedBy === staffFilter);
            myDonations = myDonations.filter((donation) => donation.collectedBy === staffFilter);
        }
    }

    const searchTerm = document.getElementById('history-search-input').value.toLowerCase();

    // 🌟 FIX: Timestamp History Sorting 🌟
    const feeHistoryGroups = Object.values(myPays.reduce((a, p) => {
        const k = getPaymentGroupKey(p);
        
        // Use exact millisecond timestamp from database
        const pTs = p.timestamp || new Date(p.paymentDate || Date.now()).getTime();
        
        if(!a[k]) {
            a[k] = {
                tId: k, r: p.receiptNo||'-', sId: p.studentId, dt: p.paymentDate,
                ts: pTs, kind: 'fee',
                i: [], tot: 0, by: getStaffName(p.collectedBy, p.collectedByName), studentIds: [], seenBillingKeys: new Set()
            };
        } else {
            // Keep the absolute highest (newest) timestamp for accurate sorting of this group
            if (pTs > a[k].ts) a[k].ts = pTs;
        }
        
        const billingKey = getPaymentBillingKey(p);
        if (!a[k].seenBillingKeys.has(billingKey)) {
            a[k].seenBillingKeys.add(billingKey);
            a[k].i.push(p.itemKey);
            a[k].tot = roundMoney(a[k].tot + getMonthlyReportPaymentAmount(p));
        }
        
        if (!a[k].studentIds.includes(p.studentId)) a[k].studentIds.push(p.studentId);
        
        return a;
    }, {}));
    
    const donationHistoryRows = myDonations.map((donation) => ({
        tId: `donation:${donation.id}`,
        r: donation.receiptNo || '-',
        sId: '',
        dt: donation.paymentDate,
        ts: donation.timestamp || new Date(donation.paymentDate || Date.now()).getTime(),
        kind: 'donation',
        i: ['donation'],
        tot: Number(donation.amount || 0),
        by: getStaffName(donation.collectedBy, donation.collectedByName),
        studentIds: [],
        donorName: donation.donorName || '-',
        description: donation.description || ''
    }));
    sortedHistoryList = [...feeHistoryGroups, ...donationHistoryRows];

    if (searchTerm) {
        sortedHistoryList = sortedHistoryList.filter(item => {
            if (item.kind === 'donation') {
                const donor = (item.donorName || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                const rNo = item.r.toString().toLowerCase();
                return donor.includes(searchTerm) || desc.includes(searchTerm) || rNo.includes(searchTerm);
            }
            const studentsInTxn = item.studentIds.map((id) => getStudentById(id)).filter(Boolean);
            const sName = studentsInTxn.map((student) => student.name.toLowerCase()).join(' ');
            const sAdm = studentsInTxn.map((student) => (student.adm || '').toLowerCase()).join(' ');
            const rNo = item.r.toString().toLowerCase();
            return sName.includes(searchTerm) || sAdm.includes(searchTerm) || rNo.includes(searchTerm);
        });
    }

    // Sort by entered payment date first (desc), then by timestamp within same date (desc)
    const toDayValue = (dateStr = '') => {
        if (!dateStr) return 0;
        const parsed = new Date(`${dateStr}T00:00:00`).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    };
    sortedHistoryList.sort((a, b) => {
        const dayDiff = toDayValue(b.dt) - toDayValue(a.dt);
        if (dayDiff !== 0) return dayDiff;
        return Number(b.ts || 0) - Number(a.ts || 0);
    });

    document.getElementById('history-count-badge').textContent = `${sortedHistoryList.length} Transactions`;
    const tbody = document.getElementById('history-content-tbody');
    document.getElementById('history-loading-indicator').classList.add('hidden');
    if(sortedHistoryList.length === 0) {
        historyDisplayedCount = 0;
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-gray-500">No payment history found.</td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    historyDisplayedCount = 0;
    loadMoreHistory(historyRenderToken);
};

document.getElementById('history-staff-filter').addEventListener('change', prepareHistoryData);
document.getElementById('history-search-input').addEventListener('input', prepareHistoryData);

const loadMoreHistory = (renderToken = historyRenderToken) => {
    if(historyDisplayedCount >= sortedHistoryList.length) return;

    const limit = historyDisplayedCount === 0 ? INITIAL_LOAD : LOAD_MORE;
    const toAdd = sortedHistoryList.slice(historyDisplayedCount, historyDisplayedCount + limit);
    const tbody = document.getElementById('history-content-tbody');
    const loader = document.getElementById('history-loading-indicator');

    loader.classList.remove('hidden');

    historyLoadTimer = setTimeout(() => {
        if (renderToken !== historyRenderToken) {
            loader.classList.add('hidden');
            return;
        }
        let html = '';
        toAdd.forEach(i => {
            const seenStudentIds = new Set();
            const txnStudents = i.studentIds
                .filter((id) => {
                    if (!id || seenStudentIds.has(id)) return false;
                    seenStudentIds.add(id);
                    return true;
                })
                .map((id) => getStudentById(id))
                .filter(Boolean);
            const primaryStudent = txnStudents[0] || getStudentById(i.sId);
            const isDonationRow = i.kind === 'donation';
            if(!primaryStudent && !isDonationRow) return;
            const formatStudentMeta = (student) => `${student.name} (Adm: ${student.adm||'-'}, Class: ${student.class||'-'})`;
            const primaryStudentLabel = isDonationRow
                ? `Donation: ${i.donorName || '-'}${i.description ? ` (${i.description})` : ''}`
                : formatStudentMeta(primaryStudent);
            const otherStudentRows = txnStudents.slice(1).map((student) => formatStudentMeta(student));
            const studentCount = isDonationRow ? 1 : (txnStudents.length || 1);
            const totalLabel = `₹${Number(i.tot || 0).toFixed(0)} (${studentCount})`;
            html += `<tr class="bg-white hover:bg-gray-50 transition">
                <td class="p-3 font-medium text-gray-900">${i.r}</td>
                <td class="p-3 text-gray-600">${new Date(i.dt).toLocaleDateString('en-GB')}</td>
                <td class="p-3 font-medium text-blue-700">${escapeHtml(primaryStudentLabel)}${otherStudentRows.length ? `<span class="text-[10px] text-gray-500 block mt-1">${otherStudentRows.map((row) => escapeHtml(row)).join('<br>')}</span>` : ''}</td>
                <td class="p-3"><span class="text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100 whitespace-nowrap">${i.by}</span></td>
                <td class="p-3 text-center text-gray-600">${isDonationRow ? 'Donation' : i.i.length}</td>
                <td class="p-3 font-bold text-gray-800">${totalLabel}</td>
                <td class="p-3 text-center">${isDonationRow
                    ? `<button class="donation-edit-btn text-blue-500 hover:text-blue-700 mr-3" data-id="${i.tId.replace('donation:', '')}"><i class="fas fa-edit"></i></button><button class="donation-del-btn text-red-500 hover:text-red-700" data-id="${i.tId.replace('donation:', '')}"><i class="fas fa-trash"></i></button>`
                    : `<button class="edit-payment-btn text-blue-500 hover:text-blue-700 mr-3" data-sid="${i.sId}" data-tid="${i.tId}"><i class="fas fa-edit"></i></button><button class="delete-payment-btn text-red-500 hover:text-red-700" data-sid="${i.sId}" data-tid="${i.tId}"><i class="fas fa-trash"></i></button>`}</td>
            </tr>`;
        });
        tbody.insertAdjacentHTML('beforeend', html);
        historyDisplayedCount += toAdd.length;
        loader.classList.add('hidden');
        historyLoadTimer = null;
    }, 300);
};

document.getElementById('history-content-container').addEventListener('scroll', function() {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 20) {
        if (historyDisplayedCount < sortedHistoryList.length) { loadMoreHistory(); }
    }
});

// Event Delegation for dynamically generated history buttons
document.getElementById('history-content-container').addEventListener('click', e => {
    const editBtn = e.target.closest('.edit-payment-btn'), delBtn = e.target.closest('.delete-payment-btn');
    const donationEditBtn = e.target.closest('.donation-edit-btn');
    const donationDelBtn = e.target.closest('.donation-del-btn');
    if(editBtn) startEditingPayment(editBtn.dataset.sid, editBtn.dataset.tid);
    if (donationEditBtn) {
        const donation = allDonations.find((entry) => entry.id === donationEditBtn.dataset.id);
        if (!donation) return;
        editingDonationId = donation.id;
        document.getElementById('donation-name').value = donation.donorName || '';
        document.getElementById('donation-receipt').value = donation.receiptNo || '';
        document.getElementById('donation-amount').value = donation.amount || '';
        document.getElementById('donation-date').value = donation.paymentDate || new Date().toISOString().split('T')[0];
        document.getElementById('donation-description').value = donation.description || '';
        setupDonationEntryUI();
        document.querySelector('.nav-link[data-target="donation-page"]')?.click();
    }
    if (donationDelBtn) {
        if (!confirm('Delete this donation entry?')) return;
        deleteDoc(doc(db, `${BASE_PATH}/donations`, donationDelBtn.dataset.id)).catch((error) => {
            console.error(error);
            alert('Failed to delete donation.');
        });
    }
    if(delBtn) {
        const tid = delBtn.dataset.tid;
        document.getElementById('confirm-title').textContent = "Delete Payment";
        document.getElementById('confirm-message').innerHTML = `<p class="text-gray-800 font-medium">ഈ പേയ്‌മെന്റ് പൂർണ്ണമായും ഡിലീറ്റ് ചെയ്യട്ടെ?</p>`;
        document.getElementById('confirm-popup').classList.remove('hidden');
        document.getElementById('confirm-popup').classList.add('flex');

        document.getElementById('confirm-ok').onclick = async () => {
            const batch = writeBatch(db);
            const docsToDelete = await collectPaymentDocsForGroup(tid, '');
            docsToDelete.forEach((docSnap) => {
                batch.delete(docSnap.ref);
                const payment = docSnap.data();
                const yearPath = getYearPaymentsCollectionPath(payment.academicYear || '');
                batch.delete(doc(db, yearPath, docSnap.id));
            });
            await batch.commit(); document.getElementById('confirm-popup').classList.add('hidden');
        }
    }
});

// --- MONTHLY REPORT RENDER ---
const renderMonthlyCollectedPage = (searchTerm = '') => {
    const cont = document.getElementById('monthly-collected-container'), lowerTerm = searchTerm.toLowerCase(); cont.innerHTML = '';
    const myPays = getVisiblePayments();
    const myDonations = getVisibleDonations();
    const combinedEntries = [...myPays, ...myDonations];
    renderMonthlySummaryCards(combinedEntries.filter((payment) => {
        if (!searchTerm) return true;
        if (payment.entryType === 'donation') {
            return (payment.donorName || '').toLowerCase().includes(lowerTerm)
                || (payment.description || '').toLowerCase().includes(lowerTerm)
                || (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm));
        }
        const student = getStudentById(payment.studentId);
        return Boolean(student) && (
            student.name.toLowerCase().includes(lowerTerm) ||
            (student.adm && student.adm.toLowerCase().includes(lowerTerm)) ||
            student.class.toLowerCase().includes(lowerTerm) ||
            (payment.receiptNo && payment.receiptNo.toString().includes(lowerTerm))
        );
    }), searchTerm);

    if (searchTerm) {
        const matching = students.filter(s => s.name.toLowerCase().includes(lowerTerm) || (s.adm && s.adm.toLowerCase().includes(lowerTerm)));
        if (matching.length === 1) {
            const s = matching[0], paysByItem = myPays.filter(p => p.studentId === s.id).reduce((acc, p) => { acc[p.itemKey] = p; return acc; }, {});
            let reportText = `NAME   : ${s.name.toUpperCase()}\nCLASS  : ${s.class}\nADM NO : ${s.adm||'-'}\n`;
            let mText = '', cText = '';
            feeItems.forEach(i => { const p = paysByItem[i.key]; if (p) { const rStr = p.receiptNo ? p.receiptNo.toString().padEnd(6,' ') : '-     '; if (i.type === 'month') mText += `RCPT : ${rStr} | ${normalizeFeeItemName(i.name)}\n`; else cText += `RCPT : ${rStr} | ${normalizeFeeItemName(i.name)} (₹${p.amount})\n`; } });
            if (mText) reportText += `\n--- MONTHS ---\n${mText}`; if (cText) reportText += `\n--- OTHER FEES ---\n${cText}`; if (!mText && !cText) reportText += `\nNo data.\n`;
            cont.innerHTML = `<div class="report-card whitespace-pre-wrap text-sm md:text-base bg-gray-50 border border-gray-200 p-4 rounded-xl"><div class="flex justify-between items-start border-b pb-3 mb-3"><h3 class="text-lg font-bold">Student Report</h3><button id="back-to-monthly-view-btn" class="py-1 px-3 bg-gray-200 rounded-lg text-sm font-semibold">Back</button></div><pre class="font-mono">${escapeHtml(reportText)}</pre></div><div class="mt-5 text-center"><button id="share-whatsapp-btn-monthly" data-share-text="${encodeURIComponent('*Student Payment Report*\n-----------------------\n'+reportText)}" class="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 transition text-white font-bold py-3 px-6 rounded-xl shadow-md w-full md:w-auto justify-center"><i class="fab fa-whatsapp text-xl"></i> <span>Share on WhatsApp</span></button></div>`; return;
        } else if (matching.length > 1) {
            cont.innerHTML = `<div class="p-4 bg-gray-50 border rounded-xl"><h3 class="font-bold text-lg mb-1">Search Results</h3><p class="text-sm text-gray-500 mb-4">Click to view report</p><ul class="space-y-2">${matching.map(s => `<li><button class="w-full text-left p-3 rounded-lg bg-white border hover:border-blue-400 font-medium monthly-student-select flex justify-between" data-student-name="${escapeHtml(s.name)}"><span>${escapeHtml(s.name)} <span class="text-gray-500 text-sm font-normal">(${escapeHtml(s.class)})</span></span><span class="text-xs text-gray-400 font-mono">Adm: ${escapeHtml(s.adm||'-')}</span></button></li>`).join('')}</ul></div>`; return;
        }
    }

    const pays = searchTerm
        ? combinedEntries.filter((entry) => {
            if (entry.entryType === 'donation') {
                return (entry.donorName || '').toLowerCase().includes(lowerTerm)
                    || (entry.description || '').toLowerCase().includes(lowerTerm)
                    || (entry.receiptNo && entry.receiptNo.toString().includes(lowerTerm));
            }
            const student = getStudentById(entry.studentId);
            return student && (student.class.toLowerCase().includes(lowerTerm) || (entry.receiptNo && entry.receiptNo.toString().includes(lowerTerm)));
        })
        : combinedEntries;
    const sortedKeys = Object.keys(pays.reduce((a, p) => { if (p.paymentDate) { const mk = p.paymentDate.substring(0, 7); if (!a[mk]) a[mk] = []; a[mk].push(p); } return a; }, {})).sort().reverse();
    if (sortedKeys.length === 0) { cont.innerHTML = buildEmptyState('No monthly report data found for the selected filter.', 'fa-chart-column'); return; }

    const currentMK = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const receiptSort = (a, b) => {
        const aNum = Number(a?.receiptNo ?? a ?? 0);
        const bNum = Number(b?.receiptNo ?? b ?? 0);
        const aValid = Number.isFinite(aNum);
        const bValid = Number.isFinite(bNum);
        if (aValid && bValid) return aNum - bNum;
        if (aValid) return -1;
        if (bValid) return 1;
        return String(a?.receiptNo ?? a ?? '').localeCompare(String(b?.receiptNo ?? b ?? ''), undefined, { numeric: true });
    };

    sortedKeys.forEach(mk => {
        const monthPays = pays.filter(p => p.paymentDate.substring(0,7) === mk), uTxns = {};
        monthPays.forEach(p => {
            const tid = p.transactionId || p.receiptNo;
            if (!uTxns[tid]) {
                const pt = monthPays.filter(pay => (pay.transactionId || pay.receiptNo) === tid);
                const m = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'month');
                const c = sumReportPaymentsOnce(pt, (pay) => getPaymentItemType(pay) === 'custom');
                uTxns[tid] = { m, c };
            }
        });
        const mTot = Object.values(uTxns).reduce((s, d) => s + d.m, 0);
        const cTot = Object.values(uTxns).reduce((s, d) => s + d.c, 0);
        const donationPays = monthPays.filter((entry) => entry.entryType === 'donation');
        const feePays = monthPays.filter((entry) => entry.entryType !== 'donation');
        const mF = feePays.filter((p) => getPaymentItemType(p) === 'month');
        const studentDonationPays = feePays.filter((p) => p.itemKey === STUDENT_DONATION_ITEM_KEY);
        const cF = feePays.filter((p) => getPaymentItemType(p) === 'custom' && p.itemKey !== STUDENT_DONATION_ITEM_KEY);
        const defaultTotal = roundMoney(mTot);
        const donationTotal = roundMoney(donationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
            + studentDonationPays.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        const otherTotal = roundMoney(cTot);
        const grandTotal = roundMoney(defaultTotal + donationTotal + otherTotal);

        let html = `<div class="bg-gray-50 border p-4 rounded-xl"><div class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 cursor-pointer month-header"><div><h3 class="text-base font-bold">${formatMonthLabel(mk)}</h3><p class="text-xs text-gray-500 font-medium mt-1">${Object.keys(uTxns).length} receipt groups • ${new Set(monthPays.map((payment) => payment.studentId)).size} students</p></div><div class="flex flex-wrap items-center gap-2 text-[11px] font-bold"><span class="bg-white px-2 py-1 rounded border">Default: ${formatCurrency(defaultTotal)}</span><span class="bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-200">Donation: ${formatCurrency(donationTotal)}</span><span class="bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">Other: ${formatCurrency(otherTotal)}</span><span class="bg-indigo-50 text-indigo-700 px-2 py-1 rounded border border-indigo-200">Total: ${formatCurrency(grandTotal)}</span><i class="fas fa-chevron-down month-toggle-icon text-gray-400 ${mk === currentMK ? 'rotate-180' : ''} transition ml-1"></i></div></div><div class="month-details-container overflow-x-auto mt-4 pt-4 border-t ${mk === currentMK ? '' : 'hidden'}">`;
        if (mF.length > 0) {
            const monthlyTxnRows = Object.values(mF.reduce((acc, payment) => {
                const txnKey = payment.transactionId || payment.receiptNo || `tx-${payment.timestamp || Math.random()}`;
                if (!acc[txnKey]) acc[txnKey] = { receiptNo: payment.receiptNo || '-', total: 0, students: {}, seenBilling: new Set() };
                const billingKey = payment.billingGroupId
                    ? `${txnKey}__${payment.itemKey || ''}__${payment.academicYear || ''}__${payment.billingGroupId}`
                    : '';
                if (!(billingKey && acc[txnKey].seenBilling.has(billingKey))) {
                    acc[txnKey].total = roundMoney(acc[txnKey].total + getMonthlyReportPaymentAmount(payment));
                    if (billingKey) acc[txnKey].seenBilling.add(billingKey);
                }
                const student = getStudentById(payment.studentId) || {};
                acc[txnKey].students[payment.studentId || txnKey] = {
                    name: student.name || 'Unknown',
                    class: student.class || '-',
                    adm: student.adm || '-'
                };
                return acc;
            }, {})).sort(receiptSort);
            html += `<table class="w-full text-sm text-left mb-4"><thead class="bg-gray-100"><tr><th class="p-2">Rcpt</th><th class="p-2">Students</th><th class="p-2">Amount</th></tr></thead><tbody>${monthlyTxnRows.map((row) => {
                const studentLines = Object.values(row.students).map((student) => `<div class="leading-tight">${escapeHtml(student.name)} <span class="text-[11px] text-gray-500">(${escapeHtml(student.class)} · Adm: ${escapeHtml(student.adm)})</span></div>`).join('');
                return `<tr class="border-b hover:bg-white align-top"><td class="p-2">${row.receiptNo}</td><td class="p-2">${studentLines}</td><td class="p-2 font-semibold">₹${row.total.toFixed(0)}</td></tr>`;
            }).join('')}</tbody></table>`;
        }
        const sortedCustomFees = [...cF].sort(receiptSort);
        if (sortedCustomFees.length > 0) html += `<h4 class="text-sm font-bold mt-4 mb-2 bg-gray-200 inline-block px-3 py-1 rounded-lg">Other Fees</h4><table class="w-full text-sm text-left whitespace-nowrap"><thead class="bg-gray-100"><tr><th class="p-2">Rcpt</th><th class="p-2">Student</th><th class="p-2">Item</th><th class="p-2">Amount</th></tr></thead><tbody>` + sortedCustomFees.map(p => `<tr class="border-b hover:bg-white"><td class="p-2">${p.receiptNo||'-'}</td><td class="p-2">${getStudentById(p.studentId)?.name||'Unknown'}</td><td class="p-2">${normalizeFeeItemName(feeItems.find(fi => fi.key === p.itemKey)?.name||p.itemKey)}</td><td class="p-2 font-semibold">₹${Number(p.amount || 0).toFixed(0)}</td></tr>`).join('') + `</tbody><tfoot class="font-bold border-t"><tr><td colspan="3" class="p-2 text-right">Total</td><td class="p-2 text-green-700">₹${otherTotal.toFixed(0)}</td></tr></tfoot></table>`;
        if (donationPays.length > 0 || studentDonationPays.length > 0) {
            const donationRows = [
                ...donationPays.map((entry) => ({
                    receiptNo: entry.receiptNo || '-',
                    name: entry.donorName || '-',
                    description: entry.description || '-',
                    amount: Number(entry.amount || 0),
                    by: getStaffName(entry.collectedBy, entry.collectedByName)
                })),
                ...studentDonationPays.map((entry) => {
                    const student = getStudentById(entry.studentId) || {};
                    return {
                        receiptNo: entry.receiptNo || '-',
                        name: student.name ? `${student.name} (Student)` : 'Student Donation',
                        description: `Class: ${student.class || '-'} · Adm: ${student.adm || '-'}`,
                        amount: Number(entry.amount || 0),
                        by: getStaffName(entry.collectedBy, entry.collectedByName)
                    };
                })
            ];
            const sortedDonationRows = donationRows.sort(receiptSort);
            html += `<h4 class="text-sm font-bold mt-4 mb-2 bg-emerald-100 text-emerald-700 inline-block px-3 py-1 rounded-lg">Donation</h4><table class="w-full text-sm text-left whitespace-nowrap"><thead class="bg-emerald-50"><tr><th class="p-2">Rcpt</th><th class="p-2">Name</th><th class="p-2">Description</th><th class="p-2">Amount</th><th class="p-2">Collected By</th></tr></thead><tbody>${sortedDonationRows.map((entry) => `<tr class="border-b hover:bg-white"><td class="p-2">${entry.receiptNo}</td><td class="p-2">${escapeHtml(entry.name)}</td><td class="p-2">${escapeHtml(entry.description)}</td><td class="p-2 font-semibold">₹${entry.amount.toFixed(0)}</td><td class="p-2">${escapeHtml(entry.by)}</td></tr>`).join('')}</tbody><tfoot class="font-bold border-t"><tr><td colspan="3" class="p-2 text-right">Donation Total</td><td class="p-2 text-emerald-700">₹${donationTotal.toFixed(0)}</td><td></td></tr></tfoot></table>`;
        }
        cont.innerHTML += html + `</div></div>`;
    });
};
document.getElementById('monthly-collected-search-input').addEventListener('input', e => renderMonthlyCollectedPage(e.target.value));
document.getElementById('monthly-report-download-btn').addEventListener('click', () => exportMonthlySummaryCsv(document.getElementById('monthly-collected-search-input').value));
document.getElementById('monthly-collected-container').addEventListener('click', e => {
    const h = e.target.closest('.month-header'), sel = e.target.closest('.monthly-student-select'), back = e.target.closest('#back-to-monthly-view-btn'), share = e.target.closest('#share-whatsapp-btn-monthly');
    if(h) { h.nextElementSibling.classList.toggle('hidden'); h.querySelector('.month-toggle-icon').classList.toggle('rotate-180'); }
    else if(sel) { document.getElementById('monthly-collected-search-input').value = sel.dataset.studentName; renderMonthlyCollectedPage(sel.dataset.studentName); }
    else if(back) { document.getElementById('monthly-collected-search-input').value = ''; renderMonthlyCollectedPage(''); }
    else if(share) window.open(`https://wa.me/?text=${share.dataset.shareText}`, '_blank');
});

const renderCollectorWiseMonthlyPage = () => {
    const container = document.getElementById('collector-wise-monthly-container');
    if (!container) return;
    if (!isCurrentAdmin) {
        container.innerHTML = `<div class="text-sm text-gray-500 bg-gray-50 border rounded-xl p-4">Admin access required.</div>`;
        return;
    }
    const groupedByMonth = [...allPayments, ...allDonations].reduce((acc, payment) => {
        if (!payment?.paymentDate) return acc;
        const monthKey = payment.paymentDate.substring(0, 7);
        if (!acc[monthKey]) acc[monthKey] = [];
        acc[monthKey].push(payment);
        return acc;
    }, {});
    const monthKeys = Object.keys(groupedByMonth).sort().reverse();
    if (!monthKeys.length) {
        container.innerHTML = buildEmptyState('No collector-wise monthly data available.', 'fa-users');
        return;
    }
    container.innerHTML = monthKeys.map((monthKey) => {
        const monthPayments = groupedByMonth[monthKey];
        const collectorRows = Object.values(monthPayments.reduce((acc, payment) => {
            const collectorKey = payment.collectedBy || 'unknown';
            if (!acc[collectorKey]) {
                acc[collectorKey] = {
                    collectorLabel: getStaffName(payment.collectedBy, payment.collectedByName),
                    monthlyDefaultTotal: 0,
                    monthlyOthersTotal: 0
                };
            }
            if (payment.entryType === 'donation') acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            else {
                const feeItem = feeItems.find((item) => item.key === payment.itemKey);
                if ((feeItem?.type || 'month') === 'month') acc[collectorKey].monthlyDefaultTotal += Number(payment.amount || 0);
                else acc[collectorKey].monthlyOthersTotal += Number(payment.amount || 0);
            }
            return acc;
        }, {})).sort((a, b) => (b.monthlyDefaultTotal + b.monthlyOthersTotal) - (a.monthlyDefaultTotal + a.monthlyOthersTotal));
        const monthTotalDefault = collectorRows.reduce((sum, row) => sum + row.monthlyDefaultTotal, 0);
        const monthTotalOthers = collectorRows.reduce((sum, row) => sum + row.monthlyOthersTotal, 0);
        return `
            <div class="bg-white border border-gray-200 rounded-xl p-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-3 mb-3">
                    <h3 class="font-bold text-gray-800">${formatMonthLabel(monthKey)}</h3>
                    <div class="text-xs text-gray-500 font-semibold">Default: ${formatCurrency(monthTotalDefault)} • Others: ${formatCurrency(monthTotalOthers)}</div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left whitespace-nowrap">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="p-2">Collector</th>
                                <th class="p-2 text-right">Default Fee Total</th>
                                <th class="p-2 text-right">Others Fee Total</th>
                                <th class="p-2 text-right">Grand Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${collectorRows.map((row) => `
                                <tr class="border-b hover:bg-gray-50">
                                    <td class="p-2 font-semibold text-gray-800">${escapeHtml(row.collectorLabel)}</td>
                                    <td class="p-2 text-right">${formatCurrency(row.monthlyDefaultTotal)}</td>
                                    <td class="p-2 text-right">${formatCurrency(row.monthlyOthersTotal)}</td>
                                    <td class="p-2 text-right font-bold text-indigo-700">${formatCurrency(row.monthlyDefaultTotal + row.monthlyOthersTotal)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
};

// --- STUDENTS INFO RENDER ---
const renderStudentInfoList = () => {
    const fCls = document.getElementById('stu-info-class').value;
    const fGen = document.getElementById('stu-info-gender').value;
    const sTerm = document.getElementById('stu-info-search').value.toLowerCase();
    const cont = document.getElementById('stu-info-list');
    const emptyState = document.getElementById('stu-info-empty');

    if (!fCls && !sTerm) {
        emptyState.classList.remove('hidden'); cont.classList.add('hidden'); return;
    }
    emptyState.classList.add('hidden'); cont.classList.remove('hidden');

    const fil = students.filter(s => {
        let match = true;
        if(fCls) match = match && s.class === fCls;
        if(fGen !== 'all') match = match && s.gender === fGen;
        if(sTerm) match = match && (s.name.toLowerCase().includes(sTerm) || (s.adm && s.adm.toLowerCase().includes(sTerm)));
        return match;
    });

    if(fil.length === 0) { cont.innerHTML = '<p class="text-gray-500 p-4 text-center font-medium">No students found.</p>'; return; }
    fil.sort((a, b) => a.name.localeCompare(b.name));

    cont.innerHTML = fil.map(s => `
        <div class="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:border-blue-400 hover:shadow-md transition" onclick="window.openStudentProfile('${s.id}')">
            <div>
                <div class="font-bold text-gray-900 text-lg">${s.name}</div>
                <div class="text-sm text-gray-500">${s.class} (${s.gender}) | Adm: ${s.adm||'-'}</div>
            </div>
            <i class="fas fa-chevron-right text-gray-300"></i>
        </div>
    `).join('');
};
document.getElementById('stu-info-class').addEventListener('change', renderStudentInfoList);
document.getElementById('stu-info-gender').addEventListener('change', renderStudentInfoList);
document.getElementById('stu-info-search').addEventListener('input', renderStudentInfoList);


// --- INIT LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    const staffAccess = window.AppSession?.getStaffAccess?.() || null;
    const isDirectoryCollector = staffAccess?.source === 'directory';
    currentUserEmail = getEffectiveStaffEmail();
    currentCollectorKey = getCollectorKey();
    setupDonationEntryUI();
    selectedDutyClasses = [];
    collectorPaymentDetails = { accountName: '', upiNumber: '', upiId: '' };
    if (currentUserEmail) {
        selectedDutyClasses = readDutyClassesFromLocal();
        const savedDutyPayment = readDutyPaymentFromLocal();
        if (savedDutyPayment && typeof savedDutyPayment === 'object') {
            collectorPaymentDetails = { ...collectorPaymentDetails, ...savedDutyPayment };
        }
    }

    if (isDirectoryCollector) {
        isCurrentAdmin = false;
    } else {
        const adminRef = doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
        const adminSnap = await getDoc(adminRef);

        const adminData = adminSnap.exists() ? adminSnap.data() : {};
        const adminEmail = (adminData.email || '').toLowerCase();
        const adminAccounts = SINGLE_ADMIN_MODE ? [] : (Array.isArray(adminData.admins) ? adminData.admins : []);
        if(adminEmail === (currentUserEmail || '').toLowerCase() || adminAccounts.some((account) => (account.email || '').toLowerCase() === (currentUserEmail || '').toLowerCase() && account.isActive !== false)) {
            isCurrentAdmin = true;
            window.AppSession?.startAdmin();
        } else {
            isCurrentAdmin = false;
            window.AppSession?.startStaff(window.AppSession?.getStaffName?.() || '', currentUserEmail);
        }
    }

    const displayEl = document.getElementById('staff-name-display');
    setResultPageNavVisibility(isCurrentAdmin || staffAccess?.result === true);
    document.getElementById('collector-wise-monthly-tab')?.classList.toggle('hidden', !isCurrentAdmin);
    if (isCurrentAdmin) { displayEl.textContent = "ADMINISTRATOR"; }

    onSnapshot(collection(db, `${BASE_PATH}/staff`), (snap) => {
        allStaff = snap.docs.map(d => ({id: d.id, ...d.data()}));
        if (!isCurrentAdmin) {
            const myData = allStaff.find((staff) => normalizeEmail(staff.email) === normalizeEmail(currentUserEmail));
            if(myData && myData.isActive && myData.canCollect !== false) {
                currentUserEmail = normalizeEmail(myData.email || currentUserEmail || getEffectiveStaffEmail());
                currentCollectorKey = normalizeEmail(window.AppSession?.getStaffAccess?.()?.userKey || myData.email || currentUserEmail);
                displayEl.textContent = myData.name;
                window.AppSession?.startStaff(myData.name, currentUserEmail);
                const localDutyClasses = readDutyClassesFromLocal();
                const serverDutyClasses = Array.isArray(myData.dutyClasses) ? myData.dutyClasses.filter(Boolean) : [];
                selectedDutyClasses = localDutyClasses.length ? localDutyClasses : serverDutyClasses;
                localStorage.setItem(getDutyStorageKey(), JSON.stringify(selectedDutyClasses));

                const localDutyPayment = readDutyPaymentFromLocal();
                const serverDutyPayment = (myData.dutyPaymentDetails && typeof myData.dutyPaymentDetails === 'object') ? myData.dutyPaymentDetails : {};
                const preferredDutyPayment = hasDutyPaymentDetails(localDutyPayment) ? localDutyPayment : serverDutyPayment;
                collectorPaymentDetails = { ...collectorPaymentDetails, ...preferredDutyPayment };
                localStorage.setItem(getDutyPaymentStorageKey(), JSON.stringify(collectorPaymentDetails));
                setResultPageNavVisibility(myData.canManageResults === true || staffAccess?.result === true);
            } else {
                if (isDirectoryCollector) {
                    displayEl.textContent = window.AppSession?.getStaffName?.() || 'COLLECTOR';
                    setDutyPaymentDetailsInputs(collectorPaymentDetails);
                    renderStaffDirectory();
                    return;
                }
                window.AppSession?.clearAll({ purgeClientData: true });
                signOut(auth).finally(() => { window.location.href = 'index.html'; });
                return;
            }
        }
        if (isCurrentAdmin) setResultPageNavVisibility(true);
        if (isDirectoryCollector) {
            displayEl.textContent = window.AppSession?.getStaffName?.() || 'COLLECTOR';
        }
        setDutyPaymentDetailsInputs(collectorPaymentDetails);
        populateClassDropdowns();
        renderStaffDirectory();
        updateHistoryStaffFilter();
        if(document.getElementById('history-page').classList.contains('hidden') === false) prepareHistoryData();
        if(document.getElementById('collector-wise-monthly-page').classList.contains('hidden') === false) renderCollectorWiseMonthlyPage();
    });
    onSnapshot(collection(db, `${BASE_PATH}/publicDirectory`), (snap) => {
        directoryEntries = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        renderStaffDirectory();
    });
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), (contentSnap) => {
        const payload = contentSnap.exists() ? contentSnap.data() : {};
        directoryCategories = Array.isArray(payload.directoryCategories) ? payload.directoryCategories : [];
        renderStaffDirectory();
    });
    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), (accessSnap) => {
        const payload = accessSnap.exists() ? accessSnap.data() : {};
        pageAccessConfig = payload && typeof payload === 'object' ? { categories: {}, overrides: {}, ...payload } : { categories: {}, overrides: {} };
        renderStaffDirectory();
    });
    onSnapshot(getSessionRegistryRef(), (sessionSnap) => {
        const registry = sessionSnap.exists() ? sessionSnap.data() : {};
        const deviceId = getLocalDeviceId();
        const sessionEntry = registry?.sessions?.[deviceId] || null;
        if (!sessionEntry) return;
        if (sessionEntry.isBlocked === true || sessionEntry.forceLogout === true) {
            alert('This collection session is blocked or logged out by admin.');
            window.AppSession?.clearAll({ purgeClientData: true });
            signOut(auth).finally(() => { window.location.href = 'index.html'; });
        }
    });
    startCollectionSessionHeartbeat();
    window.AppSession?.touchSession();

    const sessionControlRef = doc(db, `${BASE_PATH}/settings`, 'sessionControl');
    onSnapshot(sessionControlRef, (sessionSnap) => {
        const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};
        const startedAt = window.AppSession?.getStartedAt?.() || 0;
        const forcedAt = sessionData?.lastForcedLogoutAt ? new Date(sessionData.lastForcedLogoutAt).getTime() : 0;
        if (forcedAt && startedAt && forcedAt > startedAt) {
            alert(sessionData.message || 'An administrator ended this session. Please sign in again.');
            window.AppSession?.clearAll({ purgeClientData: true });
            signOut(auth).finally(() => { window.location.href = 'index.html'; });
        }
    });

    const confRef = doc(db, `${BASE_PATH}/settings`, 'config');
    onSnapshot(confRef, (docSnap) => {
        if (docSnap.exists()) {
            const d = docSnap.data();

            applyInstitutionBranding(d, {
                defaultAppName: 'Fee Collection',
                logoIds: ['header-logo', 'splash-logo-img'],
                updateDocumentTitle: true,
                documentTitleSuffix: 'Fee Collection'
            });
            renderVersionInfo();
            setTimeout(() => { fitTextToContainer('header-title'); }, 50);

            defaultFee = d.defaultFee || 200;
            feeStatusTitle = d.feeStatusTitle || '';
            feeItems = sortFeeItemsForDisplay(d.feeItems || []);
            defaultReceiptMandatory = d.defaultReceiptMandatory || false;

            const fsh = document.getElementById('fee-status-title-header');
            if(fsh && feeStatusTitle) fsh.textContent = feeStatusTitle;

            if(!isEditMode && document.getElementById('home-page').classList.contains('hidden') === false) {
                setupFeeEntryUI();
            }
            if(document.getElementById('fee-page').classList.contains('hidden') === false) {
                renderFeeTable();
            }
        }
    });

    onSnapshot(collection(db, `${BASE_PATH}/students`), (snap) => {
        allStudentsRaw = snap.docs.map(d => ({id: d.id, ...d.data()}));
        applyCurrentYearStudentScope();
        populateClassDropdowns();
        updateDashboardMetrics();
        if(document.getElementById('fee-page').classList.contains('hidden') === false) renderFeeTable();
        if(document.getElementById('students-page').classList.contains('hidden') === false) renderStudentInfoList();
    });

    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'academicYears'), (snap) => {
        const payload = snap.exists() ? snap.data() : {};
        academicYearSettings = Array.isArray(payload.years) ? payload.years : [];
        currentWorkingAcademicYear = payload.currentYear || currentWorkingAcademicYear || '';
        applyCurrentYearStudentScope();
        populateClassDropdowns();
        updateDashboardMetrics();
        if(document.getElementById('fee-page').classList.contains('hidden') === false) renderFeeTable();
        if(document.getElementById('students-page').classList.contains('hidden') === false) renderStudentInfoList();
    });

    onSnapshot(collection(db, `${BASE_PATH}/studentGroups`), (snap) => {
        studentGroups = snap.docs.map(d => ({id: d.id, ...d.data()}));
    });

    onSnapshot(collection(db, `${BASE_PATH}/payments`), (snap) => {
        allPayments = snap.docs.map(d => ({id: d.id, ...d.data()}));
        updateDashboardMetrics();
        updateHistoryStaffFilter();

        if(!isEditMode && document.getElementById('home-page').classList.contains('hidden') === false) {
            if(!document.getElementById('entry-receipt').value) {
                 document.getElementById('entry-receipt').value = getNextReceiptNoForStaff();
            }
        }

        if(document.getElementById('history-page').classList.contains('hidden') === false) prepareHistoryData();
        if(document.getElementById('monthly-collected-page').classList.contains('hidden') === false) renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input').value);
        if(document.getElementById('collector-wise-monthly-page').classList.contains('hidden') === false) renderCollectorWiseMonthlyPage();
        if(document.getElementById('fee-page').classList.contains('hidden') === false) renderFeeTable();
    });

    onSnapshot(collection(db, `${BASE_PATH}/donations`), (snap) => {
        allDonations = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        updateDashboardMetrics();
        if(document.getElementById('history-page').classList.contains('hidden') === false) prepareHistoryData();
        if(document.getElementById('monthly-collected-page').classList.contains('hidden') === false) renderMonthlyCollectedPage(document.getElementById('monthly-collected-search-input').value);
        if(document.getElementById('collector-wise-monthly-page').classList.contains('hidden') === false) renderCollectorWiseMonthlyPage();
    });
});

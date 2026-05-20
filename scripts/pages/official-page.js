import { signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { db, auth } from '../../config/firebase-config.js';
import { BASE_PATH, applyCachedInstitutionLogo, escapeHtml, rememberInstitutionLogo, sanitizeUrl } from '../shared/app-common.js';
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

let allStudents = [];
let allStaff = [];
let studentGroups = [];
let directoryEntries = [];
let directoryCategories = [];
let institutionConfig = {};
let categoryAuthConfig = { categories: {} };
let pageAccessConfig = { categories: {}, overrides: {} };
let userSession = null;
let authReady = false;
const OFFICIAL_SESSION_KEY = 'official_portal_session_v1';
applyCachedInstitutionLogo(['header-logo', 'header-logo-right', 'official-login-modal-logo']);

const officialFilters = {
  studentClass: '',
  studentGender: 'ALL',
  studentInfo: 'ALL',
  studentSearch: '',
  staffType: 'ALL',
  staffStatus: 'ALL',
  staffSearch: ''
};
const worksheetState = {
  className: '',
  sortBy: 'NAME_ASC',
  groupBy: 'MIXED',
  heading: '',
  orientation: 'portrait',
  margin: 'normal',
  showHeader: true,
  repeatHeader: true,
  selected: { row: 0, col: 0 },
  columns: [
    { key: 'sno', label: 'S.No', width: 90, editable: false, source: 'AUTO_SNO' },
    { key: 'name', label: 'Student Name', width: 240, editable: false, source: 'NAME' },
    { key: 'custom1', label: 'Heading', width: 160, editable: true, source: 'CUSTOM' }
  ],
  rows: [],
  history: [],
  historyIndex: -1,
  isApplyingHistory: false
};
const WORKSHEET_TEMPLATE_KEY = 'official_worksheet_template_v1';
const WORKSHEET_TEMPLATE_SYNC_ENDPOINT = '/api/worksheet/template';
const WORKSHEET_VIRTUAL_WINDOW = 250;
const cloneWorksheetState = () => JSON.parse(JSON.stringify({
  columns: worksheetState.columns,
  rows: worksheetState.rows,
  selected: worksheetState.selected
}));
const pushWorksheetHistory = () => {
  const snap = cloneWorksheetState();
  worksheetState.history = worksheetState.history.slice(0, worksheetState.historyIndex + 1);
  worksheetState.history.push(snap);
  worksheetState.historyIndex = worksheetState.history.length - 1;
};
const restoreWorksheetHistory = (index = 0) => {
  const snap = worksheetState.history[index];
  if (!snap) return;
  worksheetState.columns = snap.columns;
  worksheetState.rows = snap.rows;
  worksheetState.selected = snap.selected;
  worksheetState.historyIndex = index;
};

const resolveInstitutionName = (conf = {}) => String(
  conf.appName
  || conf.institutionName
  || conf.institution
  || conf.schoolName
  || conf.school
  || conf.name
  || ''
).trim();

const applyOfficialBranding = (conf = {}) => {
  institutionConfig = conf || {};
  const institutionName = resolveInstitutionName(conf) || 'Official Portal';
  const effectiveLogo = rememberInstitutionLogo(conf.logoUrl || '') || 'assets/images/logo.png';
  ['header-logo', 'header-logo-right', 'official-login-modal-logo'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.src = effectiveLogo;
    el.onerror = () => { el.onerror = null; el.src = 'assets/images/logo.png'; };
  });
  document.getElementById('header-title').textContent = institutionName;
  const loginInstitutionName = document.getElementById('official-login-institution-name');
  if (loginInstitutionName) loginInstitutionName.textContent = institutionName;
};

const hashCredentialValue = async (rawValue = '') => {
  const value = String(rawValue || '');
  if (!value) return '';
  if (!(window.crypto?.subtle)) return value;
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const showMsg = (m = '') => { document.getElementById('official-login-msg').textContent = m; };
const toLabel = (key = '') => String(key || '').replace(/([A-Z])/g, ' $1').replace(/[_.-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase());
const normalizeText = (value = '') => String(value || '').trim().toLowerCase();
const formatDate = (value = '') => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
};
const valueToDisplay = (value) => {
  if (value === undefined || value === null || value === '') return '--';
  if (Array.isArray(value)) return value.map(valueToDisplay).join(', ');
  if (typeof value === 'object') {
    if (value.seconds) return formatDate(value.seconds * 1000);
    return Object.entries(value)
      .filter(([, nested]) => nested !== undefined && nested !== null && String(nested).trim() !== '')
      .map(([key, nested]) => `${toLabel(key)}: ${valueToDisplay(nested)}`)
      .join(' • ') || '--';
  }
  return String(value);
};
const SENSITIVE_PROFILE_KEYS = new Set(['id', 'password', 'passwordhash', 'password_hash', 'username', 'user_name', 'usernameraw', 'username_raw', 'authmeta', 'source', 'email']);
const isSensitiveProfileField = (key = '', label = '') => {
  const parts = [key, label].map((item) => String(item || '').toLowerCase().replace(/[\s.-]+/g, '_'));
  return parts.some((part) => SENSITIVE_PROFILE_KEYS.has(part) || /(^|_)pass(word)?($|_)/.test(part) || /(^|_)user(name)?($|_)/.test(part) || part.includes('credential') || part.includes('auth'));
};
const renderEntriesGrid = (entries = []) => {
  const visibleEntries = entries.filter((entry) => entry && !isSensitiveProfileField(entry.key, entry.label) && valueToDisplay(entry.value) !== '--');
  if (!visibleEntries.length) return '<div class="text-sm text-slate-500">No details available.</div>';
  return `<div class="details-grid">${visibleEntries.map((entry) => `<div class="detail-item"><div class="detail-label">${escapeHtml(entry.label || toLabel(entry.key))}</div><div class="detail-value">${escapeHtml(valueToDisplay(entry.value))}</div></div>`).join('')}</div>`;
};
const getVisibleEntries = (obj = {}, skipKeys = []) => Object.entries(obj || {}).filter(([k, v]) => !skipKeys.includes(k) && v !== undefined && v !== null && String(valueToDisplay(v)).trim() !== '');
const renderKeyValueGrid = (obj = {}, skipKeys = []) => renderEntriesGrid(getVisibleEntries(obj, skipKeys).map(([key, value]) => ({ key, label: toLabel(key), value })));
const getPhoto = (obj = {}) => sanitizeUrl(obj.photo || obj.image || obj.logo || '') || 'assets/images/logo.png';
const getStudentClass = (student = {}) => String(student.class || '--').trim() || '--';
const getStudentGender = (student = {}) => String(student.gender || '').trim();
const getStudentStatus = (student = {}) => student.isActive === false || student.status === 'inactive' || student.left === true ? 'Inactive' : 'Active';
const hasStudentConcession = (student = {}) => student.concessionFee !== undefined && student.concessionFee !== null && student.concessionFee !== '';
const getStudentGroup = (studentId = '') => studentGroups.find((group) => Array.isArray(group.memberIds) && group.memberIds.includes(studentId));
const getGroupMemberRows = (group = {}) => (group.memberIds || []).map((memberId) => allStudents.find((student) => student.id === memberId)).filter(Boolean);

const mobileToggle = document.getElementById('mobile-menu-btn');
const navMenu = document.querySelector('.nav-menu');
const setMobileMenuState = (isOpen) => {
  navMenu?.classList.toggle('active', isOpen);
  mobileToggle?.classList.toggle('active-toggle', isOpen);
  mobileToggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};
const setTab = (tab = 'dashboard') => {
  const requested = document.getElementById(`official-tab-${tab}`) ? tab : 'dashboard';
  const target = document.getElementById(`official-tab-${requested}`) ? requested : 'students';
  document.querySelectorAll('.official-tab').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`official-tab-${target}`)?.classList.remove('hidden');
  document.querySelectorAll('.tab-link').forEach((btn) => {
    const active = btn.dataset.tab === target;
    btn.classList.toggle('active', active);
    btn.classList.toggle('text-indigo-700', active);
  });
  setMobileMenuState(false);
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
};

const openOfficialDetailModal = (title = 'Details', bodyHtml = '') => {
  const titleEl = document.getElementById('official-detail-title');
  const bodyEl = document.getElementById('official-detail-body');
  const modal = document.getElementById('official-detail-modal');
  if (!titleEl || !bodyEl || !modal) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');
};
const closeOfficialDetailModal = () => {
  const modal = document.getElementById('official-detail-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');
};

document.getElementById('official-detail-close')?.addEventListener('click', closeOfficialDetailModal);
document.getElementById('official-detail-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeOfficialDetailModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOfficialDetailModal();
});

document.querySelectorAll('.tab-link').forEach((btn) => btn.addEventListener('click', (event) => { event.preventDefault(); setTab(btn.dataset.tab); }));
mobileToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  setMobileMenuState(!navMenu.classList.contains('active'));
});
document.addEventListener('click', (e) => {
  if (!navMenu?.contains(e.target) && !mobileToggle?.contains(e.target)) setMobileMenuState(false);
});

const summaryStats = () => {
  const totalStudents = allStudents.length;
  const boys = allStudents.filter((student) => normalizeText(student.gender) === 'male').length;
  const girls = allStudents.filter((student) => normalizeText(student.gender) === 'female').length;
  const classCount = new Set(allStudents.map(getStudentClass)).size;
  const teachers = allStaff.filter((staff) => staff.isActive !== false && staff.type === 'Teacher').length;
  const management = allStaff.filter((staff) => staff.isActive !== false && staff.type === 'Management').length;
  const activeStaff = allStaff.filter((staff) => staff.isActive !== false).length;
  const categoryMembers = directoryEntries.length;
  const groupedStudents = new Set(studentGroups.flatMap((group) => group.memberIds || [])).size;
  const concessionStudents = allStudents.filter(hasStudentConcession).length;
  return { totalStudents, boys, girls, classCount, teachers, management, activeStaff, categoryMembers, groupedStudents, concessionStudents };
};
const metricCard = (label, value, tone = 'blue', icon = 'fa-circle-info') => `
  <div class="official-metric-card ${tone}">
    <div><div class="official-metric-label">${escapeHtml(label)}</div><div class="official-metric-value">${escapeHtml(String(value))}</div></div>
    <i class="fas ${icon}"></i>
  </div>`;

const renderDashboard = () => {
  const stats = summaryStats();
  document.getElementById('official-tab-dashboard').innerHTML = `
    <div class="space-y-4">
      <div class="card p-4 rounded-2xl shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h3 class="font-extrabold text-lg">Official Overview</h3><p class="text-sm text-slate-500 font-semibold">Read-only institution register and directory.</p></div>
          <span class="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700">${escapeHtml(resolveInstitutionName(institutionConfig) || 'Institution')}</span>
        </div>
        <div class="official-metric-grid">
          ${metricCard('Students', stats.totalStudents, 'blue', 'fa-user-graduate')}
          ${metricCard('Classes', stats.classCount, 'indigo', 'fa-school')}
          ${metricCard('Boys', stats.boys, 'green', 'fa-person')}
          ${metricCard('Girls', stats.girls, 'teal', 'fa-person-dress')}
          ${metricCard('Teachers', stats.teachers, 'amber', 'fa-chalkboard-user')}
          ${metricCard('Management', stats.management, 'purple', 'fa-users-gear')}
          ${metricCard('Grouped Students', stats.groupedStudents, 'blue', 'fa-people-arrows')}
          ${metricCard('Concessions', stats.concessionStudents, 'green', 'fa-hand-holding-dollar')}
        </div>
      </div>
      <div class="grid md:grid-cols-3 gap-4">
        <button type="button" class="official-quick-card" data-open-tab="students"><i class="fas fa-users"></i><b>View Students</b><span>Search and open full student details.</span></button>
        <button type="button" class="official-quick-card" data-open-tab="summary"><i class="fas fa-table"></i><b>Class Summary</b><span>Class-wise boys, girls, totals and data checks.</span></button>
        <button type="button" class="official-quick-card" data-open-tab="staff"><i class="fas fa-id-card"></i><b>Staff & Categories</b><span>Teachers, management and directory profiles.</span></button>
      </div>
    </div>`;
  document.querySelectorAll('[data-open-tab]').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.openTab)));
};

const buildStudentDetailHtml = (student = {}) => {
  const group = getStudentGroup(student.id);
  const groupHtml = group ? `
    <div class="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-3">
      <div class="flex items-center justify-between gap-2 mb-2"><h4 class="font-extrabold text-blue-900">Group Members</h4><span class="badge">₹${escapeHtml(String(group.fee || 0))}/month</span></div>
      <div class="space-y-1">${getGroupMemberRows(group).map((member, index) => `<div class="flex items-center justify-between rounded-lg bg-white border border-blue-100 px-3 py-2 text-sm"><span class="font-bold ${member.id === student.id ? 'text-blue-800' : 'text-slate-800'}">${index + 1}. ${escapeHtml(member.name || '--')}</span><span class="text-slate-500">${escapeHtml(member.class || '--')}</span></div>`).join('')}</div>
    </div>` : '';
  return `
    <div class="flex items-start gap-4 mb-4">
      <img src="${escapeHtml(getPhoto(student))}" onerror="this.src='assets/images/logo.png'" class="w-20 h-20 rounded-2xl object-cover border border-slate-200">
      <div><h3 class="text-xl font-extrabold text-slate-900">${escapeHtml(student.name || '--')}</h3><p class="text-sm font-bold text-blue-700">Class ${escapeHtml(student.class || '--')} • Adm: ${escapeHtml(student.adm || '--')}</p><span class="mt-2 inline-flex badge">${escapeHtml(getStudentStatus(student))}</span></div>
    </div>
    ${renderKeyValueGrid(student, ['id', 'photo', 'image'])}
    ${hasStudentConcession(student) ? `<div class="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 font-bold text-emerald-800">Fee Concession: ₹${escapeHtml(String(student.concessionFee))}</div>` : ''}
    ${groupHtml}`;
};

const renderStudents = () => {
  const classOptions = [...new Set(allStudents.map(getStudentClass))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const hasSelectedClass = Boolean(officialFilters.studentClass);
  const filteredStudents = hasSelectedClass ? allStudents
    .filter((student) => {
      const cls = getStudentClass(student);
      const gender = normalizeText(student.gender);
      const searchable = Object.values(student || {}).map(valueToDisplay).join(' ').toLowerCase();
      const group = getStudentGroup(student.id);
      const classOk = cls === officialFilters.studentClass;
      const genderOk = officialFilters.studentGender === 'ALL' || gender === normalizeText(officialFilters.studentGender);
      const searchOk = !officialFilters.studentSearch || searchable.includes(officialFilters.studentSearch.toLowerCase());
      const infoOk = officialFilters.studentInfo === 'ALL'
        || (officialFilters.studentInfo === 'GROUPED' && Boolean(group))
        || (officialFilters.studentInfo === 'CONCESSION' && hasStudentConcession(student))
        || (officialFilters.studentInfo === 'MISSING_MOBILE' && !student.mobile)
        || (officialFilters.studentInfo === 'MISSING_UID' && !student.uid);
      return classOk && genderOk && searchOk && infoOk;
    })
    .sort((a, b) => getStudentClass(a).localeCompare(getStudentClass(b), undefined, { numeric: true }) || String(a.name || '').localeCompare(String(b.name || ''))) : [];
  const emptyStudentMessage = hasSelectedClass ? 'No students found for the selected class and filters' : 'Please select a class to view students';

  const primaryColumns = ['class', 'adm', 'name', 'gender', 'uid', 'father', 'mobile'];
  const extraKeys = [...new Set(filteredStudents.flatMap((student) => Object.keys(student || {})))].filter((key) => !['id', 'photo', 'image', ...primaryColumns].includes(key));
  const columns = [...primaryColumns, ...extraKeys];
  const headerCells = columns.map((key) => `<th class="border p-2 whitespace-nowrap">${escapeHtml(toLabel(key))}</th>`).join('');
  const rows = filteredStudents.map((student, index) => {
    const group = getStudentGroup(student.id);
    return `<tr class="hover:bg-blue-50 cursor-pointer official-student-row" data-student-id="${escapeHtml(student.id)}"><td class="border p-2 text-center font-semibold">${index + 1}</td>${columns.map((key) => `<td class="border p-2 align-top">${escapeHtml(valueToDisplay(student?.[key]))}</td>`).join('')}<td class="border p-2 align-top">${group ? `<span class="badge">Group ₹${escapeHtml(String(group.fee || 0))}</span>` : '-'}</td></tr>`;
  }).join('');
  const cardRows = filteredStudents.map((student) => `<button type="button" class="official-student-card" data-student-id="${escapeHtml(student.id)}"><div class="font-extrabold text-slate-900">${escapeHtml(student.name || '--')}</div><div class="text-xs font-bold text-blue-700">Class ${escapeHtml(student.class || '--')} • Adm ${escapeHtml(student.adm || '--')}</div><div class="mt-2 text-xs text-slate-500">${escapeHtml(student.father || 'Father not added')}</div></button>`).join('');
  document.getElementById('official-tab-students').innerHTML = `
    <div class="card p-2 sm:p-4 rounded-2xl shadow-sm w-full">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h3 class="font-extrabold text-lg">Students Register</h3><p class="text-xs text-slate-500 font-semibold">Select a class first to view read-only student details. Click any row/card for full profile.</p></div><span class="text-xs font-bold px-3 py-1 rounded-full bg-blue-50 text-blue-700">${hasSelectedClass ? `${filteredStudents.length} records` : 'Class required'}</span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <select id="official-student-class" class="p-2.5 rounded-lg border bg-white text-sm font-semibold"><option value="">Select Class</option>${classOptions.map((className) => `<option value="${escapeHtml(className)}" ${officialFilters.studentClass === className ? 'selected' : ''}>${escapeHtml(className)}</option>`).join('')}</select>
        <select id="official-student-gender" class="p-2.5 rounded-lg border bg-white text-sm font-semibold"><option value="ALL">All Genders</option><option value="Male" ${officialFilters.studentGender === 'Male' ? 'selected' : ''}>Male</option><option value="Female" ${officialFilters.studentGender === 'Female' ? 'selected' : ''}>Female</option></select>
        <select id="official-student-info" class="p-2.5 rounded-lg border bg-white text-sm font-semibold"><option value="ALL">All Info</option><option value="GROUPED" ${officialFilters.studentInfo === 'GROUPED' ? 'selected' : ''}>Grouped</option><option value="CONCESSION" ${officialFilters.studentInfo === 'CONCESSION' ? 'selected' : ''}>Concession</option><option value="MISSING_MOBILE" ${officialFilters.studentInfo === 'MISSING_MOBILE' ? 'selected' : ''}>Missing Mobile</option><option value="MISSING_UID" ${officialFilters.studentInfo === 'MISSING_UID' ? 'selected' : ''}>Missing UID</option></select>
        <input id="official-student-search" value="${escapeHtml(officialFilters.studentSearch)}" class="p-2.5 rounded-lg border bg-white text-sm font-semibold lg:col-span-2" placeholder="Search name / adm / phone / any detail">
      </div>
      <div class="overflow-auto w-full"><table class="w-full text-xs md:text-sm border-collapse min-w-[1000px]"><thead><tr class="bg-slate-100"><th class="border p-2">#</th>${headerCells}<th class="border p-2">Group</th></tr></thead><tbody>${rows || `<tr><td colspan="${columns.length + 2}" class="border p-3 text-center text-slate-500">${emptyStudentMessage}</td></tr>`}</tbody></table></div>
      <div class="official-mobile-card-list mt-4">${cardRows || `<div class="text-sm text-slate-500">${emptyStudentMessage}</div>`}</div>
    </div>`;
  document.getElementById('official-student-class')?.addEventListener('change', (e) => { officialFilters.studentClass = e.target.value; renderStudents(); });
  document.getElementById('official-student-gender')?.addEventListener('change', (e) => { officialFilters.studentGender = e.target.value; renderStudents(); });
  document.getElementById('official-student-info')?.addEventListener('change', (e) => { officialFilters.studentInfo = e.target.value; renderStudents(); });
  document.getElementById('official-student-search')?.addEventListener('input', (e) => { officialFilters.studentSearch = e.target.value; renderStudents(); });
  document.querySelectorAll('[data-student-id]').forEach((el) => el.addEventListener('click', () => {
    const student = allStudents.find((item) => item.id === el.dataset.studentId);
    if (student) openOfficialDetailModal('Student Profile', buildStudentDetailHtml(student));
  }));
};

const buildClassSummary = () => {
  const map = new Map();
  allStudents.forEach((student) => {
    const cls = getStudentClass(student);
    if (!map.has(cls)) map.set(cls, { boys: 0, girls: 0, total: 0, active: 0, inactive: 0, missingMobile: 0, missingUid: 0, grouped: 0, concession: 0 });
    const row = map.get(cls);
    row.total += 1;
    const gender = normalizeText(student.gender);
    if (gender === 'male') row.boys += 1;
    else if (gender === 'female') row.girls += 1;
    if (getStudentStatus(student) === 'Active') row.active += 1;
    else row.inactive += 1;
    if (!student.mobile) row.missingMobile += 1;
    if (!student.uid) row.missingUid += 1;
    if (getStudentGroup(student.id)) row.grouped += 1;
    if (hasStudentConcession(student)) row.concession += 1;
  });
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const totals = { boys: 0, girls: 0, total: 0, active: 0, inactive: 0, missingMobile: 0, missingUid: 0, grouped: 0, concession: 0 };
  const rows = keys.map((cls) => {
    const row = map.get(cls);
    Object.keys(totals).forEach((key) => { totals[key] += row[key]; });
    return `<tr class="hover:bg-indigo-50"><td class="border p-2 font-semibold"><button type="button" class="text-blue-700 font-extrabold class-filter-btn" data-class="${escapeHtml(cls)}">${escapeHtml(cls)}</button></td><td class="border p-2 text-center">${row.boys}</td><td class="border p-2 text-center">${row.girls}</td><td class="border p-2 text-center font-bold">${row.total}</td><td class="border p-2 text-center">${row.active}</td><td class="border p-2 text-center">${row.inactive}</td><td class="border p-2 text-center">${row.grouped}</td><td class="border p-2 text-center">${row.concession}</td><td class="border p-2 text-center">${row.missingMobile}</td><td class="border p-2 text-center">${row.missingUid}</td></tr>`;
  }).join('');
  document.getElementById('official-tab-summary').innerHTML = `
    <div class="card p-4 rounded-2xl shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h3 class="font-extrabold text-lg">Class-wise Summary</h3><p class="text-xs text-slate-500 font-semibold">Click a class name to open students from that class.</p></div><span class="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700">Institution Total: ${totals.total}</span></div>
      <div class="overflow-x-auto"><table class="w-full text-sm border-collapse min-w-[900px]"><thead><tr class="bg-slate-100"><th class="border p-2 text-left">Class</th><th class="border p-2">Boys</th><th class="border p-2">Girls</th><th class="border p-2">Total</th><th class="border p-2">Active</th><th class="border p-2">Inactive</th><th class="border p-2">Grouped</th><th class="border p-2">Concession</th><th class="border p-2">No Mobile</th><th class="border p-2">No UID</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="border p-3 text-center text-slate-500">No students available</td></tr>'}<tr class="bg-indigo-50 font-bold"><td class="border p-2">Grand Total</td><td class="border p-2 text-center">${totals.boys}</td><td class="border p-2 text-center">${totals.girls}</td><td class="border p-2 text-center">${totals.total}</td><td class="border p-2 text-center">${totals.active}</td><td class="border p-2 text-center">${totals.inactive}</td><td class="border p-2 text-center">${totals.grouped}</td><td class="border p-2 text-center">${totals.concession}</td><td class="border p-2 text-center">${totals.missingMobile}</td><td class="border p-2 text-center">${totals.missingUid}</td></tr></tbody></table></div>
    </div>`;
  document.querySelectorAll('.class-filter-btn').forEach((btn) => btn.addEventListener('click', () => {
    officialFilters.studentClass = btn.dataset.class || '';
    renderStudents();
    setTab('students');
  }));
};

const normalizeConfiguredFields = (fields = []) => (Array.isArray(fields) ? fields : [])
  .map((field) => ({ ...field, key: String(field.key || ''), label: String(field.label || field.key || ''), order: Number(field.order || 999) }))
  .filter((field) => field.key && !isSensitiveProfileField(field.key, field.label))
  .sort((a, b) => a.order - b.order);
const getDirectoryCategory = (categoryId = '') => directoryCategories.find((category) => category.id === categoryId);
const getCategoryAuthItem = (categoryId = '') => {
  const raw = categoryAuthConfig?.categories?.[categoryId] || {};
  return {
    enabled: raw.enabled === true,
    targetPage: raw.targetPage === 'student' ? 'student' : 'collection',
    usernameField: String(raw.usernameField || ''),
    passwordField: String(raw.passwordField || '')
  };
};
const getPageAccessItem = (categoryId = '', entryId = '') => {
  const categoryAccess = pageAccessConfig?.categories?.[categoryId] || {};
  const override = pageAccessConfig?.overrides?.[entryId] || {};
  if (override.blocked === true) return { collection: false, student: false, blocked: true };
  return {
    collection: typeof override.collection === 'boolean' ? override.collection : categoryAccess.collection === true,
    student: typeof override.student === 'boolean' ? override.student : categoryAccess.student === true,
    blocked: false
  };
};
const getStaffProfileEntries = (staff = {}) => {
  const entries = [
    { key: 'name', label: 'Name', value: staff.name },
    { key: 'role', label: 'Role', value: staff.role },
    { key: 'phone', label: 'Phone Number', value: staff.phone },
    { key: 'address', label: 'Address', value: staff.address }
  ];
  if (staff.msr) entries.push({ key: 'msr', label: 'MSR Number', value: staff.msr });
  if (Array.isArray(staff.dutyClasses) && staff.dutyClasses.length) entries.push({ key: 'dutyClasses', label: 'Duty Class', value: staff.dutyClasses.join(', ') });
  return entries;
};
const getDirectoryProfileEntries = (entry = {}, category = getDirectoryCategory(entry.categoryId)) => {
  const authItem = getCategoryAuthItem(entry.categoryId);
  const hiddenKeys = new Set([authItem.usernameField, authItem.passwordField].filter(Boolean));
  return normalizeConfiguredFields(category?.fields || [])
    .filter((field) => !hiddenKeys.has(field.key))
    .map((field) => ({ key: field.key, label: field.label, value: entry.values?.[field.key] }));
};
const buildProfileCard = (person = {}, titleFallback = 'Profile', subtitleFallback = 'Member', detailEntries = null) => {
  const title = person.name || person.title || person.fullName || titleFallback;
  const subtitle = person.role || person.designation || person.type || person.subtitle || subtitleFallback;
  const entries = Array.isArray(detailEntries) ? detailEntries : getVisibleEntries(person, ['photo', 'image', 'logo']).map(([key, value]) => ({ key, label: toLabel(key), value }));
  return `<article class="id-card official-profile-card" data-profile-title="${escapeHtml(title)}"><div class="id-card-top"><img src="${escapeHtml(getPhoto(person))}" onerror="this.src='assets/images/logo.png'" class="id-photo" alt="${escapeHtml(title)}"><div><div class="font-extrabold text-slate-900">${escapeHtml(title)}</div><div class="text-xs text-slate-600">${escapeHtml(subtitle)}</div></div></div>${renderEntriesGrid(entries)}</article>`;
};
const buildStaffProfileCard = (staff = {}) => buildProfileCard(staff, 'Staff', staff.type || 'Staff', getStaffProfileEntries(staff));
const buildDirectoryProfileCard = (entry = {}) => {
  const category = getDirectoryCategory(entry.categoryId);
  return buildProfileCard(entry.values || {}, 'Profile', category?.name || 'Category Member', getDirectoryProfileEntries(entry, category));
};

const renderStaffTab = () => {
  const filteredStaff = allStaff.filter((staff) => {
    const type = String(staff.type || '--');
    const status = staff.isActive === false ? 'inactive' : 'active';
    const search = Object.values(staff || {}).map(valueToDisplay).join(' ').toLowerCase();
    const typeOk = officialFilters.staffType === 'ALL' || type === officialFilters.staffType;
    const statusOk = officialFilters.staffStatus === 'ALL' || status === officialFilters.staffStatus;
    const searchOk = !officialFilters.staffSearch || search.includes(officialFilters.staffSearch.toLowerCase());
    return typeOk && statusOk && searchOk;
  });
  const teachers = filteredStaff.filter((staff) => staff.type === 'Teacher');
  const management = filteredStaff.filter((staff) => staff.type === 'Management');
  const others = filteredStaff.filter((staff) => !['Teacher', 'Management'].includes(staff.type));
  const staffList = (list) => list.sort((a, b) => Number(a.displayOrder || 999) - Number(b.displayOrder || 999)).map((staff) => `<button type="button" class="official-card-button" data-staff-id="${escapeHtml(staff.id)}">${buildStaffProfileCard(staff)}</button>`).join('') || '<div class="text-sm text-slate-400">No records</div>';
  const catBlocks = directoryCategories.map((cat) => {
    const entries = directoryEntries.filter((entry) => entry.categoryId === cat.id).sort((a, b) => Number(a.displayOrder || 999) - Number(b.displayOrder || 999));
    return `<div class="border rounded-2xl p-3 bg-white shadow-sm"><h4 class="font-extrabold text-slate-800">${escapeHtml(cat.name || 'Category')}</h4><div class="text-xs text-slate-500 mb-2">${entries.length} entries</div>${entries.map((entry) => `<button type="button" class="official-card-button" data-dir-id="${escapeHtml(entry.id)}">${buildDirectoryProfileCard(entry)}</button>`).join('') || '<div class="text-sm text-slate-400">No entries</div>'}</div>`;
  }).join('');
  const staffTypes = [...new Set(allStaff.map((staff) => String(staff.type || '--')))].sort((a, b) => a.localeCompare(b));
  document.getElementById('official-tab-staff').innerHTML = `
    <div class="card p-4 rounded-2xl shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4"><div><h3 class="font-extrabold text-lg">Staff & Categories</h3><p class="text-xs text-slate-500 font-semibold">Read-only complete staff, management and directory details.</p></div><span class="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700">${filteredStaff.length} staff</span></div>
      <div class="grid sm:grid-cols-3 gap-3 mb-4"><select id="official-staff-type" class="p-2.5 rounded-lg border bg-white text-sm font-semibold"><option value="ALL">All Types</option>${staffTypes.map((type) => `<option value="${escapeHtml(type)}" ${officialFilters.staffType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select><select id="official-staff-status" class="p-2.5 rounded-lg border bg-white text-sm font-semibold"><option value="ALL">All Status</option><option value="active" ${officialFilters.staffStatus === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${officialFilters.staffStatus === 'inactive' ? 'selected' : ''}>Inactive</option></select><input id="official-staff-search" value="${escapeHtml(officialFilters.staffSearch)}" class="p-2.5 rounded-lg border bg-white text-sm font-semibold" placeholder="Search any staff detail"></div>
      <div class="grid xl:grid-cols-4 md:grid-cols-2 gap-4"><div><h3 class="font-bold mb-2">Teachers</h3>${staffList(teachers)}</div><div><h3 class="font-bold mb-2">Management</h3>${staffList(management)}</div><div><h3 class="font-bold mb-2">Other Staff</h3>${staffList(others)}</div><div><h3 class="font-bold mb-2">Other Categories</h3>${catBlocks || '<div class="text-sm text-slate-400">No categories</div>'}</div></div>
    </div>`;
  document.getElementById('official-staff-type')?.addEventListener('change', (e) => { officialFilters.staffType = e.target.value; renderStaffTab(); });
  document.getElementById('official-staff-status')?.addEventListener('change', (e) => { officialFilters.staffStatus = e.target.value; renderStaffTab(); });
  document.getElementById('official-staff-search')?.addEventListener('input', (e) => { officialFilters.staffSearch = e.target.value; renderStaffTab(); });
  document.querySelectorAll('[data-staff-id]').forEach((button) => button.addEventListener('click', () => {
    const staff = allStaff.find((item) => item.id === button.dataset.staffId);
    if (staff) openOfficialDetailModal('Staff Profile', `<div class="mb-4">${buildStaffProfileCard(staff)}</div>`);
  }));
  document.querySelectorAll('[data-dir-id]').forEach((button) => button.addEventListener('click', () => {
    const entry = directoryEntries.find((item) => item.id === button.dataset.dirId);
    if (entry) openOfficialDetailModal('Category Profile', `<div class="mb-4">${buildDirectoryProfileCard(entry)}</div>`);
  }));
};

const getCurrentSessionProfile = () => {
  if (userSession?.source === 'staff') {
    return allStaff.find((staff) => staff.id === userSession.id || normalizeText(staff.email) === normalizeText(userSession.username) || normalizeText(staff.name) === normalizeText(userSession.name)) || userSession;
  }
  if (userSession?.source === 'directory') {
    const entry = directoryEntries.find((item) => item.id === userSession.id);
    if (entry) return entry;
  }
  return userSession || {};
};
const getAllowedPageLabels = () => {
  const labels = ['Official Portal'];
  if (userSession?.source === 'firebase' || userSession?.source === 'legacy-admin') return [...labels, 'Admin Dashboard', 'Collection Page', 'Student Page', 'Result Management'];
  if (userSession?.source === 'staff') {
    const profile = getCurrentSessionProfile();
    if (profile.canCollect !== false) labels.push('Collection Page');
    if (profile.canManageResults === true) labels.push('Result Management');
    return labels;
  }
  if (userSession?.source === 'directory') {
    const entry = directoryEntries.find((item) => item.id === userSession.id);
    const access = getPageAccessItem(entry?.categoryId || userSession.categoryId, entry?.id || userSession.id);
    const authItem = getCategoryAuthItem(entry?.categoryId || userSession.categoryId);
    if (!access.blocked) {
      if (access.collection || (authItem.enabled && authItem.targetPage === 'collection')) labels.push('Collection Page');
      if (access.student || (authItem.enabled && authItem.targetPage === 'student')) labels.push('Student Page');
    }
    return labels;
  }
  return labels;
};
const renderHome = () => {
  const profile = getCurrentSessionProfile();
  const isDirectory = userSession?.source === 'directory';
  const label = isDirectory ? (profile.values?.name || userSession?.name || 'User') : (profile.name || userSession?.name || 'User');
  const photo = isDirectory ? getPhoto(profile.values || {}) : getPhoto(profile || {});
  const userType = isDirectory ? (getDirectoryCategory(profile.categoryId)?.name || userSession?.type || 'Category User') : (profile.type || userSession?.type || '--');
  const entries = isDirectory ? getDirectoryProfileEntries(profile) : (userSession?.source === 'staff' ? getStaffProfileEntries(profile) : renderKeyValueGrid(profile, ['photo', 'image', 'logo']));
  const detailHtml = Array.isArray(entries) ? renderEntriesGrid(entries) : entries;
  const access = getAllowedPageLabels();
  document.getElementById('official-user-line').textContent = `${label}`;
  document.getElementById('official-tab-home').innerHTML = `<div class="official-me-card max-w-5xl mx-auto overflow-hidden rounded-3xl shadow-xl">
      <div class="official-me-hero p-5 sm:p-7 text-white">
        <div class="grid md:grid-cols-[180px_1fr] gap-5 items-center">
          <div class="text-center">
            <img src="${escapeHtml(photo)}" onerror="this.src='assets/images/logo.png'" class="official-me-photo mx-auto" alt="${escapeHtml(label)}">
          </div>
          <div>
            <div class="inline-flex px-3 py-1 rounded-full text-xs font-black bg-white/20 border border-white/25 backdrop-blur">Read-only Official Profile</div>
            <h3 class="text-3xl sm:text-4xl font-black mt-3 leading-tight">${escapeHtml(label)}</h3>
            <p class="text-sm sm:text-base font-bold text-white/85 mt-1">${escapeHtml(userType)}</p>
            <div class="mt-4 flex flex-wrap gap-2">${access.map((item) => `<span class="official-access-pill"><i class="fas fa-check-circle"></i>${escapeHtml(item)}</span>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="bg-white p-4 sm:p-6">
        <div class="flex items-center gap-2 mb-4"><span class="h-10 w-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center"><i class="fas fa-id-card"></i></span><div><h4 class="font-black text-slate-900">Profile Details</h4><p class="text-xs font-bold text-slate-500">Only admin-entered profile fields are shown. Login credentials are hidden.</p></div></div>
        ${detailHtml}
      </div>
    </div>`;
};

const getWorksheetClassOptions = () => [...new Set(allStudents.map(getStudentClass))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const applyWorksheetClass = () => {
  const classStudents = allStudents.filter((student) => !worksheetState.className || getStudentClass(student) === worksheetState.className);
  const sorted = [...classStudents].sort((a, b) => {
    if (worksheetState.sortBy === 'ADM_ASC') return String(a.adm || '').localeCompare(String(b.adm || ''), undefined, { numeric: true });
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  let rows = sorted.map((student, index) => ({
    studentId: student.id,
    sno: index + 1,
    name: student.name || '--',
    gender: normalizeText(student.gender),
    values: {}
  }));
  if (worksheetState.groupBy === 'BOYS_FIRST') rows = rows.sort((a, b) => (a.gender === 'male' ? -1 : 1) - (b.gender === 'male' ? -1 : 1));
  if (worksheetState.groupBy === 'GIRLS_FIRST') rows = rows.sort((a, b) => (a.gender === 'female' ? -1 : 1) - (b.gender === 'female' ? -1 : 1));
  rows.forEach((row, index) => { row.sno = index + 1; });
  worksheetState.rows = rows;
};
const worksheetCellValue = (row, col) => {
  if (!col || !row) return '';
  if (col.key === 'sno') return row.sno;
  if (col.key === 'name') return row.name;
  return row.values?.[col.key] || '';
};
const setWorksheetCellValue = (rowIndex, colKey, value) => {
  if (!worksheetState.rows[rowIndex]) return;
  worksheetState.rows[rowIndex].values[colKey] = value;
};
const persistWorksheetTemplate = () => {
  const payload = {
    className: worksheetState.className,
    sortBy: worksheetState.sortBy,
    groupBy: worksheetState.groupBy,
    heading: worksheetState.heading,
    orientation: worksheetState.orientation,
    margin: worksheetState.margin,
    columns: worksheetState.columns
  };
  localStorage.setItem(WORKSHEET_TEMPLATE_KEY, JSON.stringify(payload));
};
const syncWorksheetTemplateToServer = async () => {
  const payload = {
    className: worksheetState.className,
    sortBy: worksheetState.sortBy,
    groupBy: worksheetState.groupBy,
    heading: worksheetState.heading,
    orientation: worksheetState.orientation,
    margin: worksheetState.margin,
    columns: worksheetState.columns
  };
  try {
    await fetch(WORKSHEET_TEMPLATE_SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (_error) {}
};
const loadWorksheetTemplate = () => {
  try {
    const raw = localStorage.getItem(WORKSHEET_TEMPLATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    worksheetState.className = parsed.className || worksheetState.className;
    worksheetState.sortBy = parsed.sortBy || worksheetState.sortBy;
    worksheetState.groupBy = parsed.groupBy || worksheetState.groupBy;
    worksheetState.heading = parsed.heading || worksheetState.heading;
    worksheetState.orientation = parsed.orientation || worksheetState.orientation;
    worksheetState.margin = parsed.margin || worksheetState.margin;
    if (Array.isArray(parsed.columns) && parsed.columns.length >= 2) {
      const normalized = parsed.columns.map((col, idx) => ({
        key: col.key || `custom_restored_${idx}`,
        label: col.label || `Column ${idx + 1}`,
        width: Number(col.width || 150),
        editable: col.editable !== false,
        source: col.source || 'CUSTOM'
      }));
      const hasSerial = normalized.some((col) => col.key === 'sno');
      const hasName = normalized.some((col) => col.key === 'name');
      worksheetState.columns = [
        ...(hasSerial ? [] : [{ key: 'sno', label: 'S.No', width: 90, editable: false, source: 'AUTO_SNO' }]),
        ...(hasName ? [] : [{ key: 'name', label: 'Student Name', width: 240, editable: false, source: 'NAME' }]),
        ...normalized
      ];
    }
  } catch (_error) {
    localStorage.removeItem(WORKSHEET_TEMPLATE_KEY);
  }
};
const exportWorksheetXlsx = async () => {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const header = worksheetState.columns.map((col) => col.label);
  const body = worksheetState.rows.map((row) => worksheetState.columns.map((col) => worksheetCellValue(row, col)));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  worksheetState.columns.forEach((col, idx) => {
    const key = XLSX.utils.encode_col(idx);
    if (!ws['!cols']) ws['!cols'] = [];
    ws['!cols'][idx] = { wch: Math.max(10, Math.round((Number(col.width) || 150) / 10)) };
    const headAddr = `${key}1`;
    if (ws[headAddr]) ws[headAddr].s = { font: { bold: true, color: { rgb: '1F2937' } }, fill: { fgColor: { rgb: 'E2E8F0' } }, border: { top: { style: 'thin', color: { rgb: 'CBD5E1' } }, left: { style: 'thin', color: { rgb: 'CBD5E1' } }, right: { style: 'thin', color: { rgb: 'CBD5E1' } }, bottom: { style: 'thin', color: { rgb: 'CBD5E1' } } } };
  });
  for (let r = 2; r <= body.length + 1; r += 1) {
    for (let c = 0; c < worksheetState.columns.length; c += 1) {
      const addr = `${XLSX.utils.encode_col(c)}${r}`;
      if (!ws[addr]) continue;
      ws[addr].s = ws[addr].s || {};
      ws[addr].s.border = { top: { style: 'thin', color: { rgb: 'E2E8F0' } }, left: { style: 'thin', color: { rgb: 'E2E8F0' } }, right: { style: 'thin', color: { rgb: 'E2E8F0' } }, bottom: { style: 'thin', color: { rgb: 'E2E8F0' } } };
      ws[addr].s.alignment = { vertical: 'top', wrapText: true };
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Worksheet');
  XLSX.writeFile(wb, `class-worksheet-${worksheetState.className || 'all'}.xlsx`);
};
const renderWorksheet = () => {
  if (!Array.isArray(worksheetState.columns) || worksheetState.columns.length < 2) {
    worksheetState.columns = [
      { key: 'sno', label: 'S.No', width: 90, editable: false, source: 'AUTO_SNO' },
      { key: 'name', label: 'Student Name', width: 240, editable: false, source: 'NAME' },
      { key: 'custom1', label: 'Heading', width: 160, editable: true, source: 'CUSTOM' }
    ];
  }
  if (worksheetState.selected.col >= worksheetState.columns.length) worksheetState.selected.col = 0;
  if (worksheetState.selected.row < 0) worksheetState.selected.row = 0;
  if (!worksheetState.className) worksheetState.className = getWorksheetClassOptions()[0] || '';
  applyWorksheetClass();
  const pageEl = document.getElementById('official-tab-worksheet');
  const classOptions = getWorksheetClassOptions();
  const classStudents = allStudents.filter((student) => getStudentClass(student) === worksheetState.className);
  const fieldOptions = [...new Set(classStudents.flatMap((student) => Object.keys(student || {})))].filter((key) => !['id'].includes(key));
  const colLetter = (index) => {
    let n = index + 1; let out = '';
    while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };
  const visibleRows = worksheetState.rows.slice(0, WORKSHEET_VIRTUAL_WINDOW);
  pageEl.innerHTML = `
    <div class="card rounded-2xl shadow-sm p-3 sm:p-4 worksheet-shell ws-${worksheetState.orientation} ws-margin-${worksheetState.margin}">
      <div class="worksheet-tabbar"><button class="ws-tab active">Home</button><button class="ws-tab">Data</button><button class="ws-tab">Page Layout</button></div>
      <div class="worksheet-ribbon">
        <div class="worksheet-group"><b>Font</b><select id="ws-font"><option>Arial</option><option>Calibri</option><option>Times New Roman</option><option>Verdana</option></select></div>
        <div class="worksheet-group"><b>Size</b><select id="ws-font-size"><option>10</option><option selected>12</option><option>14</option><option>16</option><option>18</option></select></div>
        <button type="button" class="worksheet-btn" id="ws-bold"><b>B</b></button>
        <button type="button" class="worksheet-btn" id="ws-italic"><i>I</i></button>
        <button type="button" class="worksheet-btn" id="ws-underline"><u>U</u></button>
        <div class="worksheet-group"><b>Text Color</b><input type="color" id="ws-text-color" value="#111827"></div>
        <div class="worksheet-group"><b>Fill Color</b><input type="color" id="ws-fill-color" value="#ffffff"></div>
        <div class="worksheet-group"><b>Data Source</b><select id="ws-class">${classOptions.map((item) => `<option value="${escapeHtml(item)}" ${worksheetState.className === item ? 'selected' : ''}>Class ${escapeHtml(item)}</option>`)}</select></div>
        <div class="worksheet-group"><b>Sort</b><select id="ws-sort"><option value="NAME_ASC" ${worksheetState.sortBy === 'NAME_ASC' ? 'selected' : ''}>Name A-Z</option><option value="ADM_ASC" ${worksheetState.sortBy === 'ADM_ASC' ? 'selected' : ''}>Admission No</option></select></div>
        <div class="worksheet-group"><b>Group</b><select id="ws-group"><option value="MIXED" ${worksheetState.groupBy === 'MIXED' ? 'selected' : ''}>Mixed</option><option value="BOYS_FIRST" ${worksheetState.groupBy === 'BOYS_FIRST' ? 'selected' : ''}>Boys First</option><option value="GIRLS_FIRST" ${worksheetState.groupBy === 'GIRLS_FIRST' ? 'selected' : ''}>Girls First</option><option value="SEPARATE_PAGES" ${worksheetState.groupBy === 'SEPARATE_PAGES' ? 'selected' : ''}>Separate Pages</option></select></div>
        <div class="worksheet-group"><b>Orientation</b><select id="ws-orientation"><option value="portrait" ${worksheetState.orientation === 'portrait' ? 'selected' : ''}>Portrait</option><option value="landscape" ${worksheetState.orientation === 'landscape' ? 'selected' : ''}>Landscape</option></select></div>
        <div class="worksheet-group"><b>Margin</b><select id="ws-margin"><option value="normal" ${worksheetState.margin === 'normal' ? 'selected' : ''}>Normal</option><option value="narrow" ${worksheetState.margin === 'narrow' ? 'selected' : ''}>Narrow</option><option value="wide" ${worksheetState.margin === 'wide' ? 'selected' : ''}>Wide</option></select></div>
        <div class="worksheet-group"><b>Heading</b><input id="ws-heading" value="${escapeHtml(worksheetState.heading)}" placeholder="e.g. Term 1 Attendance"></div>
        <button type="button" class="worksheet-btn" id="ws-save-template"><i class="fas fa-floppy-disk"></i> Save Template</button>
        <button type="button" class="worksheet-btn" id="ws-add-col"><i class="fas fa-plus"></i> New Column</button>
        <button type="button" class="worksheet-btn" id="ws-del-col"><i class="fas fa-minus"></i> Delete Column</button>
        <button type="button" class="worksheet-btn" id="ws-add-row"><i class="fas fa-plus"></i> Add Row</button>
        <button type="button" class="worksheet-btn" id="ws-del-row"><i class="fas fa-minus"></i> Delete Row</button>
        <button type="button" class="worksheet-btn" id="ws-undo"><i class="fas fa-rotate-left"></i> Undo</button>
        <button type="button" class="worksheet-btn" id="ws-redo"><i class="fas fa-rotate-right"></i> Redo</button>
        <button type="button" class="worksheet-btn worksheet-btn-red" id="ws-pdf"><i class="fas fa-file-pdf"></i> PDF</button>
        <button type="button" class="worksheet-btn worksheet-btn-green" id="ws-xlsx"><i class="fas fa-file-excel"></i> Export Excel</button>
      </div>
      <div class="worksheet-formula">
        <div class="name-box">${escapeHtml(String.fromCharCode(65 + worksheetState.selected.col))}${worksheetState.selected.row + 1}</div>
        <input id="ws-formula" value="${escapeHtml(worksheetCellValue(worksheetState.rows[worksheetState.selected.row] || {}, worksheetState.columns[worksheetState.selected.col] || worksheetState.columns[0]) || '')}" />
      </div>
      <div class="worksheet-grid-wrap"><table class="worksheet-grid"><thead>
      <tr><th class="corner-cell"></th>${worksheetState.columns.map((col, idx) => `<th class="ws-col-index" data-select-col="${idx}">${colLetter(idx)}</th>`).join('')}</tr>
      <tr><th>#</th>${worksheetState.columns.map((col, idx) => `<th style="min-width:${col.width}px" data-col="${idx}"><div class="ws-col-title">${escapeHtml(col.label)}</div>${col.editable ? `<select class="ws-col-source" data-col-source="${idx}"><option value="BLANK" ${col.source === 'BLANK' ? 'selected' : ''}>Blank</option><option value="CUSTOM" ${col.source === 'CUSTOM' ? 'selected' : ''}>Custom Heading</option>${fieldOptions.map((field) => `<option value="${escapeHtml(field)}" ${col.source === field ? 'selected' : ''}>${escapeHtml(toLabel(field))}</option>`).join('')}</select><input class="ws-col-input" data-col-heading="${idx}" value="${escapeHtml(col.label)}">` : ''}<div class="ws-resize-handle" data-resize-col="${idx}"></div></th>`).join('')}</tr></thead><tbody>
      ${visibleRows.map((row, rowIndex) => `<tr class="${worksheetState.groupBy === 'SEPARATE_PAGES' && rowIndex > 0 && row.gender !== visibleRows[rowIndex - 1].gender ? 'ws-page-break' : ''}"><td class="ws-row-index" data-select-row="${rowIndex}">${rowIndex + 1}<div class="ws-row-resize" data-resize-row="${rowIndex}"></div></td>${worksheetState.columns.map((col, colIndex) => `<td class="ws-cell ${worksheetState.selected.row === rowIndex && worksheetState.selected.col === colIndex ? 'active' : ''}" data-row="${rowIndex}" data-col="${colIndex}" ${col.editable ? 'contenteditable="true"' : ''}>${escapeHtml(String(worksheetCellValue(row, col) || ''))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${worksheetState.rows.length > WORKSHEET_VIRTUAL_WINDOW ? `<div class="ws-virtual-note">Showing first ${WORKSHEET_VIRTUAL_WINDOW} rows for performance. Full data is kept for export/print.</div>` : ''}
    </div>`;
  document.getElementById('ws-class')?.addEventListener('change', (e) => { worksheetState.className = e.target.value; renderWorksheet(); });
  document.getElementById('ws-sort')?.addEventListener('change', (e) => { worksheetState.sortBy = e.target.value; persistWorksheetTemplate(); renderWorksheet(); });
  document.getElementById('ws-group')?.addEventListener('change', (e) => { worksheetState.groupBy = e.target.value; persistWorksheetTemplate(); renderWorksheet(); });
  document.getElementById('ws-orientation')?.addEventListener('change', (e) => { worksheetState.orientation = e.target.value; persistWorksheetTemplate(); renderWorksheet(); });
  document.getElementById('ws-margin')?.addEventListener('change', (e) => { worksheetState.margin = e.target.value; persistWorksheetTemplate(); renderWorksheet(); });
  document.getElementById('ws-heading')?.addEventListener('input', (e) => { worksheetState.heading = e.target.value; persistWorksheetTemplate(); });
  document.getElementById('ws-save-template')?.addEventListener('click', async () => { persistWorksheetTemplate(); await syncWorksheetTemplateToServer(); alert('Worksheet template saved.'); });
  document.getElementById('ws-add-col')?.addEventListener('click', () => {
    pushWorksheetHistory();
    worksheetState.columns.push({ key: `custom${Date.now()}`, label: 'New Column', width: 150, editable: true, source: 'CUSTOM' });
    persistWorksheetTemplate();
    renderWorksheet();
  });
  document.getElementById('ws-del-col')?.addEventListener('click', () => {
    const col = worksheetState.columns[worksheetState.selected.col];
    if (!col?.editable) return;
    pushWorksheetHistory();
    worksheetState.columns.splice(worksheetState.selected.col, 1);
    worksheetState.rows.forEach((row) => { delete row.values[col.key]; });
    worksheetState.selected.col = Math.max(0, worksheetState.selected.col - 1);
    persistWorksheetTemplate();
    renderWorksheet();
  });
  document.getElementById('ws-add-row')?.addEventListener('click', () => {
    pushWorksheetHistory();
    worksheetState.rows.push({ studentId: `manual-${Date.now()}`, sno: worksheetState.rows.length + 1, name: 'Manual Row', gender: 'unknown', values: {} });
    renderWorksheet();
  });
  document.getElementById('ws-del-row')?.addEventListener('click', () => {
    if (!worksheetState.rows[worksheetState.selected.row]) return;
    pushWorksheetHistory();
    worksheetState.rows.splice(worksheetState.selected.row, 1);
    worksheetState.rows.forEach((row, i) => { row.sno = i + 1; });
    worksheetState.selected.row = Math.max(0, worksheetState.selected.row - 1);
    renderWorksheet();
  });
  document.getElementById('ws-undo')?.addEventListener('click', () => {
    if (worksheetState.historyIndex <= 0) return;
    restoreWorksheetHistory(worksheetState.historyIndex - 1);
    renderWorksheet();
  });
  document.getElementById('ws-redo')?.addEventListener('click', () => {
    if (worksheetState.historyIndex >= worksheetState.history.length - 1) return;
    restoreWorksheetHistory(worksheetState.historyIndex + 1);
    renderWorksheet();
  });
  document.getElementById('ws-pdf')?.addEventListener('click', () => window.print());
  document.getElementById('ws-xlsx')?.addEventListener('click', async () => {
    try {
      await exportWorksheetXlsx();
    } catch (_err) {
      const headers = worksheetState.columns.map((col) => `"${String(col.label).replaceAll('"', '""')}"`).join(',');
      const body = worksheetState.rows.map((row) => worksheetState.columns.map((col) => `"${String(worksheetCellValue(row, col) || '').replaceAll('"', '""')}"`).join(',')).join('\n');
      const csv = `${headers}\n${body}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `class-worksheet-${worksheetState.className || 'all'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
  document.querySelectorAll('[data-col-heading]').forEach((input) => input.addEventListener('input', (e) => {
    const index = Number(e.target.dataset.colHeading);
    if (!worksheetState.columns[index] || !worksheetState.columns[index].editable) return;
    worksheetState.columns[index].label = e.target.value || 'Column';
    persistWorksheetTemplate();
    const titleEl = e.target.closest('th')?.querySelector('.ws-col-title');
    if (titleEl) titleEl.textContent = worksheetState.columns[index].label;
  }));
  document.querySelectorAll('[data-col-source]').forEach((select) => select.addEventListener('change', (e) => {
    const index = Number(e.target.dataset.colSource);
    const source = e.target.value;
    const col = worksheetState.columns[index];
    if (!col || !col.editable) return;
    col.source = source;
    if (source !== 'CUSTOM' && source !== 'BLANK') {
      col.label = toLabel(source);
      worksheetState.rows.forEach((row) => {
        const student = allStudents.find((s) => s.id === row.studentId) || {};
        row.values[col.key] = student[source] ?? '';
      });
    }
    if (source === 'BLANK') {
      col.label = 'Blank';
      worksheetState.rows.forEach((row) => { row.values[col.key] = ''; });
    }
    persistWorksheetTemplate();
    renderWorksheet();
  }));
  document.querySelectorAll('[data-select-col]').forEach((th) => th.addEventListener('click', () => {
    worksheetState.selected.col = Number(th.dataset.selectCol);
    renderWorksheet();
  }));
  document.querySelectorAll('[data-select-row]').forEach((td) => td.addEventListener('click', () => {
    worksheetState.selected.row = Number(td.dataset.selectRow);
    renderWorksheet();
  }));
  document.querySelectorAll('.ws-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      worksheetState.selected = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
      renderWorksheet();
    });
    cell.addEventListener('input', () => {
      const row = Number(cell.dataset.row);
      const colIndex = Number(cell.dataset.col);
      const col = worksheetState.columns[colIndex];
      if (!col?.editable) return;
      pushWorksheetHistory();
      setWorksheetCellValue(row, col.key, cell.textContent || '');
    });
    cell.addEventListener('paste', (event) => {
      const paste = event.clipboardData?.getData('text/plain') || '';
      if (!paste.includes('\n') && !paste.includes('\t')) return;
      event.preventDefault();
      const startRow = Number(cell.dataset.row);
      const startCol = Number(cell.dataset.col);
      const rows = paste.split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split('\t'));
      pushWorksheetHistory();
      rows.forEach((cellsRow, r) => {
        const targetRow = startRow + r;
        if (!worksheetState.rows[targetRow]) return;
        cellsRow.forEach((cellValue, c) => {
          const targetCol = startCol + c;
          const col = worksheetState.columns[targetCol];
          if (!col?.editable) return;
          setWorksheetCellValue(targetRow, col.key, cellValue);
        });
      });
      renderWorksheet();
    });
  });
  document.querySelectorAll('[data-resize-col]').forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const colIndex = Number(handle.dataset.resizeCol);
      const initialX = event.clientX;
      const initialWidth = worksheetState.columns[colIndex]?.width || 150;
      const move = (ev) => {
        const next = Math.max(70, initialWidth + (ev.clientX - initialX));
        worksheetState.columns[colIndex].width = next;
        const th = document.querySelector(`th[data-col="${colIndex}"]`);
        if (th) th.style.minWidth = `${next}px`;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persistWorksheetTemplate();
        renderWorksheet();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
  document.querySelectorAll('[data-resize-row]').forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const tr = handle.closest('tr');
      if (!tr) return;
      const startY = event.clientY;
      const startH = tr.getBoundingClientRect().height;
      const move = (ev) => { tr.style.height = `${Math.max(26, startH + (ev.clientY - startY))}px`; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
  const applyTextStyle = (fn) => {
    const cell = document.querySelector(`.ws-cell[data-row="${worksheetState.selected.row}"][data-col="${worksheetState.selected.col}"]`);
    if (!cell) return;
    fn(cell);
    const col = worksheetState.columns[worksheetState.selected.col];
    if (col?.editable) setWorksheetCellValue(worksheetState.selected.row, col.key, cell.innerHTML);
  };
  document.getElementById('ws-bold')?.addEventListener('click', () => applyTextStyle((cell) => { cell.style.fontWeight = cell.style.fontWeight === '700' ? '400' : '700'; }));
  document.getElementById('ws-italic')?.addEventListener('click', () => applyTextStyle((cell) => { cell.style.fontStyle = cell.style.fontStyle === 'italic' ? 'normal' : 'italic'; }));
  document.getElementById('ws-underline')?.addEventListener('click', () => applyTextStyle((cell) => { cell.style.textDecoration = cell.style.textDecoration === 'underline' ? 'none' : 'underline'; }));
  document.getElementById('ws-font')?.addEventListener('change', (e) => applyTextStyle((cell) => { cell.style.fontFamily = e.target.value; }));
  document.getElementById('ws-font-size')?.addEventListener('change', (e) => applyTextStyle((cell) => { cell.style.fontSize = `${e.target.value}px`; }));
  document.getElementById('ws-text-color')?.addEventListener('input', (e) => applyTextStyle((cell) => { cell.style.color = e.target.value; }));
  document.getElementById('ws-fill-color')?.addEventListener('input', (e) => applyTextStyle((cell) => { cell.style.backgroundColor = e.target.value; }));
  document.getElementById('ws-formula')?.addEventListener('input', (e) => {
    const col = worksheetState.columns[worksheetState.selected.col];
    if (!col?.editable) return;
    pushWorksheetHistory();
    setWorksheetCellValue(worksheetState.selected.row, col.key, e.target.value || '');
    renderWorksheet();
  });
  if (worksheetState.historyIndex < 0) pushWorksheetHistory();
};

const renderAll = () => {
  loadWorksheetTemplate();
  renderDashboard();
  renderStudents();
  buildClassSummary();
  try {
    renderWorksheet();
  } catch (error) {
    console.error('Worksheet render failed, resetting template state.', error);
    localStorage.removeItem(WORKSHEET_TEMPLATE_KEY);
    worksheetState.columns = [
      { key: 'sno', label: 'S.No', width: 90, editable: false, source: 'AUTO_SNO' },
      { key: 'name', label: 'Student Name', width: 240, editable: false, source: 'NAME' },
      { key: 'custom1', label: 'Heading', width: 160, editable: true, source: 'CUSTOM' }
    ];
    worksheetState.selected = { row: 0, col: 0 };
    renderWorksheet();
  }
  renderStaffTab();
  renderHome();
};

const loadData = async () => {
  const [studentsSnap, staffSnap, groupsSnap, dirSnap, contentSnap, configSnap, authConfigSnap, pageAccessSnap] = await Promise.all([
    getDocs(collection(db, `${BASE_PATH}/students`)),
    getDocs(collection(db, `${BASE_PATH}/staff`)),
    getDocs(collection(db, `${BASE_PATH}/studentGroups`)),
    getDocs(collection(db, `${BASE_PATH}/publicDirectory`)),
    getDoc(doc(db, `${BASE_PATH}/settings`, 'content')),
    getDoc(doc(db, `${BASE_PATH}/settings`, 'config')),
    getDoc(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig')),
    getDoc(doc(db, `${BASE_PATH}/settings`, 'pageAccess'))
  ]);
  allStudents = studentsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  allStaff = staffSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  studentGroups = groupsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  directoryEntries = dirSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const content = contentSnap.exists() ? contentSnap.data() : {};
  directoryCategories = Array.isArray(content.directoryCategories) ? content.directoryCategories : [];
  categoryAuthConfig = authConfigSnap.exists() ? { categories: {}, ...(authConfigSnap.data() || {}) } : { categories: {} };
  pageAccessConfig = pageAccessSnap.exists() ? { categories: {}, overrides: {}, ...(pageAccessSnap.data() || {}) } : { categories: {}, overrides: {} };
  const conf = configSnap.exists() ? configSnap.data() : {};
  applyOfficialBranding(conf);
};

const preloadOfficialBranding = async () => {
  try {
    const configSnap = await getDoc(doc(db, `${BASE_PATH}/settings`, 'config'));
    if (!configSnap.exists()) return;
    applyOfficialBranding(configSnap.data() || {});
  } catch (_error) {}
};

const showApp = () => {
  document.getElementById('official-login-screen').classList.add('hidden');
  document.getElementById('official-app').classList.remove('hidden');
  renderAll();
  setTab('dashboard');
};

const tryLogin = async () => {
  if (!authReady) return showMsg('Initializing authentication... please try again.');
  const username = String(document.getElementById('official-username').value || '').trim();
  const password = String(document.getElementById('official-password').value || '').trim();
  if (!username || !password) return showMsg('Username, password required');
  showMsg('');
  const uname = username.toLowerCase();
  const passHash = await hashCredentialValue(password);
  let session = null;

  if (uname.includes('@')) {
    try {
      const cred = await signInWithEmailAndPassword(auth, username, password);
      if (cred?.user?.email && String(cred.user.email).toLowerCase() === uname) {
        session = { name: 'Super Admin', username: cred.user.email, type: 'Admin', source: 'firebase', photo: 'assets/images/logo.png' };
      }
    } catch (_error) {}
  }

  const adminAuthSnap = await getDoc(doc(db, `${BASE_PATH}/settings`, 'adminAuth'));
  const adminAuth = adminAuthSnap.exists() ? adminAuthSnap.data() : {};
  if (!session && String(adminAuth.email || '').toLowerCase() === uname && String(adminAuth.password || '').trim() === password) {
    session = { name: 'Super Admin', username, type: 'Admin', source: 'legacy-admin', photo: 'assets/images/logo.png' };
  }

  if (!session) {
    const staffSnap = await getDocs(collection(db, `${BASE_PATH}/staff`));
    const staff = staffSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).find((item) => {
      if (item.isActive === false) return false;
      const usernames = [
        item.email, item.username, item.userName, item.loginId, item.login, item.staffId
      ].map((v) => String(v || '').toLowerCase()).filter(Boolean);
      const passwordMatches = [
        String(item.password || '').trim() === password,
        String(item.passwordHash || '').trim() === passHash
      ].some(Boolean);
      return usernames.includes(uname) && passwordMatches;
    });
    if (staff) session = { ...staff, name: staff.name || 'Staff', username, type: staff.type || 'Staff', source: 'staff', photo: staff.photo || '' };
  }

  if (!session) {
    const authConfigSnap = await getDoc(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig'));
    const authConfig = authConfigSnap.exists() ? { categories: {}, ...(authConfigSnap.data() || {}) } : { categories: {} };
    const dirSnap = await getDocs(collection(db, `${BASE_PATH}/publicDirectory`));
    let directoryUser = null;
    for (const entry of dirSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))) {
      const meta = entry.authMeta || {};
      const categoryAuth = authConfig?.categories?.[entry.categoryId] || {};
      const usernameField = String(categoryAuth.usernameField || '').trim();
      const passwordField = String(categoryAuth.passwordField || '').trim();
      const values = entry.values || {};
      const configuredUsername = usernameField ? String(values[usernameField] || '').toLowerCase() : '';
      const configuredPasswordRaw = passwordField ? String(values[passwordField] || '').trim() : '';
      const configuredPasswordHash = configuredPasswordRaw ? await hashCredentialValue(configuredPasswordRaw) : '';
      const userMatch = [
        String(meta.username || '').toLowerCase(),
        configuredUsername
      ].includes(uname);
      const passMatch = [
        String(meta.passwordHash || '') === passHash,
        configuredPasswordRaw === password,
        configuredPasswordHash === passHash
      ].some(Boolean);
      if (userMatch && passMatch) {
        directoryUser = entry;
        break;
      }
    }
    if (directoryUser) session = { id: directoryUser.id, ...(directoryUser.values || {}), name: String(directoryUser.values?.name || 'Directory User'), username, type: 'Category User', source: 'directory', categoryId: directoryUser.categoryId, photo: String(directoryUser.values?.photo || directoryUser.values?.image || '') };
  }

  if (!session) return showMsg('Invalid credentials / access denied');
  userSession = session;
  await loadData();
  localStorage.setItem(OFFICIAL_SESSION_KEY, JSON.stringify(userSession));
  showApp();
};

onAuthStateChanged(auth, async (user) => {
  if (!user) await signInAnonymously(auth);
  authReady = true;
});

document.getElementById('official-login-btn').addEventListener('click', tryLogin);
document.getElementById('official-password').addEventListener('keydown', (event) => { if (event.key === 'Enter') tryLogin(); });
document.getElementById('official-username').addEventListener('keydown', (event) => { if (event.key === 'Enter') tryLogin(); });
document.getElementById('official-toggle-password').addEventListener('click', () => {
  const input = document.getElementById('official-password');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  document.getElementById('official-toggle-password').className = isPassword ? 'fas fa-eye-slash trailing-icon' : 'fas fa-eye trailing-icon';
});
document.getElementById('official-logout-btn').addEventListener('click', () => {
  localStorage.removeItem(OFFICIAL_SESSION_KEY);
  window.location.reload();
});

const restoreOfficialSession = async () => {
  try {
    const raw = localStorage.getItem(OFFICIAL_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.username) return;
    userSession = parsed;
    await loadData();
    showApp();
  } catch (_error) {}
};

preloadOfficialBranding();
restoreOfficialSession();
      <div class="worksheet-print-header">
        <img src="${escapeHtml(rememberInstitutionLogo(institutionConfig.logoUrl || '') || 'assets/images/logo.png')}" onerror="this.style.display='none'" alt="logo">
        <div>
          <div class="title">${escapeHtml(resolveInstitutionName(institutionConfig) || 'Institution')}</div>
          <div class="sub">${escapeHtml(worksheetState.heading || `Class ${worksheetState.className} Worksheet`)}</div>
        </div>
      </div>

import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { BASE_PATH, applyInstitutionBranding, buildEmptyState, enableSmartSelectWindowing, escapeHtml, formatCurrency, formatDateDisplay, hardenExternalLinks, registerServiceWorker, renderVersionInfo, sanitizeUrl } from '../shared/app-common.js';

window.AppSession?.guardStudentPage?.();

        hardenExternalLinks();
        enableSmartSelectWindowing(document, { visibleCount: 6 });

        // Hamburger Menu Logic with 'X' Animation
        const mobileToggle = document.getElementById('mobile-menu-btn');
        const navMenu = document.querySelector('.nav-menu');
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

        const links = Array.from(document.querySelectorAll('.tab-link'));
        const pages = Array.from(document.querySelectorAll('.page-content'));
        const defaultTabId = 'home-page';
        let hasPublishedResults = false;
        const getLinkForTarget = (targetId) => links.find((link) => link.dataset.target === targetId);
        const getTargetFromHash = (hashValue) => {
            if (!hashValue) return defaultTabId;
            const normalizedHash = hashValue.startsWith('#') ? hashValue : `#${hashValue}`;
            const matchedLink = links.find((link) => link.getAttribute('href') === normalizedHash);
            return matchedLink?.dataset.target || defaultTabId;
        };
        const activateStudentTab = (targetId, { updateHash = true } = {}) => {
            const safeTargetId = document.getElementById(targetId) ? targetId : defaultTabId;
            const activeLink = getLinkForTarget(safeTargetId);
            if (!activeLink) return;
            links.forEach((link) => {
                const isActive = link === activeLink;
                link.classList.toggle('active', isActive);
                link.setAttribute('aria-current', isActive ? 'page' : 'false');
            });
            pages.forEach((page) => page.classList.toggle('hidden', page.id !== safeTargetId));
            if (updateHash) {
                const nextHash = activeLink.getAttribute('href');
                if (nextHash && window.location.hash !== nextHash) {
                    history.pushState({ studentTab: safeTargetId }, '', nextHash);
                }
            }
            setMobileMenuState(false);
            window.scrollTo(0,0);
            document.querySelectorAll('.student-bottom-nav-btn[data-target]').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.target === safeTargetId);
            });
        };
        
        window.activateStudentTab = activateStudentTab;

        links.forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                activateStudentTab(link.dataset.target);
            });
        });
        window.addEventListener('hashchange', () => activateStudentTab(getTargetFromHash(window.location.hash), { updateHash: false }));
        window.addEventListener('popstate', () => activateStudentTab(getTargetFromHash(window.location.hash), { updateHash: false }));
        activateStudentTab(getTargetFromHash(window.location.hash), { updateHash: false });

        // Inline Accordion Expansion (No Popup)
        window.toggleReceipt = (element) => {
            const isShowing = element.classList.contains('show-details');
            document.querySelectorAll('.fee-card.show-details').forEach(el => el.classList.remove('show-details'));
            if (!isShowing) {
                element.classList.add('show-details');
                setTimeout(() => { element.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 150);
            }
        };

        let copyButtonBound = false;
        const bindCopyButtons = () => {
            if (copyButtonBound) return;
            copyButtonBound = true;
            document.addEventListener('click', async (event) => {
                const copyBtn = event.target.closest('.copy-pay-detail-btn');
                if (!copyBtn) return;
                event.stopPropagation();
                const rawValue = decodeURIComponent(copyBtn.dataset.copyValue || '');
                if (!rawValue) return;
                const originalLabel = copyBtn.textContent;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(rawValue);
                    } else {
                        const tempInput = document.createElement('textarea');
                        tempInput.value = rawValue;
                        document.body.appendChild(tempInput);
                        tempInput.select();
                        document.execCommand('copy');
                        tempInput.remove();
                    }
                    copyBtn.textContent = 'Copied';
                    setTimeout(() => { copyBtn.textContent = originalLabel; }, 1200);
                } catch (error) {
                    console.warn('Copy failed', error);
                }
            });
        };
        bindCopyButtons();

        const confirmLogout = () => confirm('Logout ചെയ്യണോ?');
        async function logoutStudent({ skipConfirm = false } = {}) {
            if(!skipConfirm && !confirmLogout()) return;
            window.AppSession?.logoutStudent(window.AppSession?.getStudentId?.(), { removeAccount: true });
            window.location.href = 'index.html';
        }
        window.logoutStudent = logoutStudent;
        document.getElementById('student-logout-btn')?.addEventListener('click', () => logoutStudent());
        document.getElementById('student-public-btn')?.addEventListener('click', () => { window.location.href = 'index.html'; });
        document.querySelectorAll('.student-bottom-nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.action === 'public') { window.location.href = 'index.html'; return; }
                if (btn.dataset.target) activateStudentTab(btn.dataset.target);
            });
        });
        document.querySelectorAll('.student-public-nav-link').forEach((link) => {
            link.addEventListener('click', () => {
                setMobileMenuState(false);
            });
        });

        const accountSwitcher = document.getElementById('student-account-switcher');
        const accountList = document.getElementById('student-account-list');
        const renderAccountSwitcher = () => {
            const accounts = window.AppSession?.getStudentAccounts?.() || [];
            const activeId = window.AppSession?.getStudentId?.();
            accountList.innerHTML = accounts.length ? accounts.map((account) => {
                const isActive = account.studentId === activeId;
                return `<div class="rounded-xl border ${isActive ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white'} px-3 py-2.5 flex items-center justify-between gap-2 transition">
                    <button class="text-left flex-grow account-switch-btn" data-id="${account.studentId}">
                        <div class="font-semibold ${isActive ? 'text-blue-700' : 'text-slate-800'}">${escapeHtml(account.name || 'Student')}</div>
                        <div class="text-xs ${isActive ? 'text-blue-600' : 'text-slate-500'}">${escapeHtml(account.class || '--')} • Adm: ${escapeHtml(account.adm || '--')}</div>
                    </button>
                    <div class="flex items-center gap-1.5">
                        ${isActive ? '<span class="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-2 py-1 rounded-full">Active</span>' : ''}
                        <button class="text-red-600 hover:text-red-700 text-xs font-bold account-remove-btn" data-id="${account.studentId}">Remove</button>
                    </div>
                </div>`;
            }).join('') : '<p class="text-sm text-gray-500">No saved accounts.</p>';
        };
        const switchToStudentAccount = (targetStudentId = '') => {
            if (!targetStudentId) return false;
            const switched = window.AppSession?.switchStudent?.(targetStudentId);
            if (!switched) return false;
            window.location.reload();
            return true;
        };
        const handleQuickProfileSwitch = () => {
            const accounts = window.AppSession?.getStudentAccounts?.() || [];
            const activeId = window.AppSession?.getStudentId?.();
            if (accounts.length === 2) {
                const target = accounts.find((account) => account.studentId !== activeId);
                if (target?.studentId && switchToStudentAccount(target.studentId)) return true;
            }
            return false;
        };
        const openAccountSwitcher = ({ forceList = false } = {}) => {
            const accounts = window.AppSession?.getStudentAccounts?.() || [];
            if (!forceList && accounts.length === 2 && handleQuickProfileSwitch()) return;
            renderAccountSwitcher();
            accountSwitcher.classList.remove('hidden');
            accountSwitcher.classList.add('flex');
        };
        const closeAccountSwitcher = () => {
            accountSwitcher.classList.add('hidden');
            accountSwitcher.classList.remove('flex');
        };
        let longPressTimer = null;
        const bindLongPress = (element) => {
            if (!element) return;
            element.addEventListener('pointerdown', () => {
                longPressTimer = setTimeout(() => openAccountSwitcher({ forceList: true }), 650);
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
                element.addEventListener(eventName, () => {
                    if (longPressTimer) clearTimeout(longPressTimer);
                    longPressTimer = null;
                });
            });
        };
        const bindProfileDoubleTap = (element) => {
            if (!element) return;
            element.addEventListener('dblclick', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!handleQuickProfileSwitch()) {
                    openAccountSwitcher({ forceList: true });
                }
            });
        };
        const profileTabLink = document.querySelector('.tab-link[data-target="home-page"]');
        const bottomProfileBtn = document.getElementById('bottom-profile-btn');
        bindLongPress(profileTabLink);
        bindLongPress(bottomProfileBtn);
        bindProfileDoubleTap(profileTabLink);
        bindProfileDoubleTap(bottomProfileBtn);
        document.getElementById('close-account-switcher')?.addEventListener('click', closeAccountSwitcher);
        accountSwitcher?.addEventListener('click', (e) => {
            if (e.target === accountSwitcher) closeAccountSwitcher();
        });
        accountList?.addEventListener('click', (e) => {
            const switchBtn = e.target.closest('.account-switch-btn');
            const removeBtn = e.target.closest('.account-remove-btn');
            if (switchBtn) {
                switchToStudentAccount(switchBtn.dataset.id);
            }
            if (removeBtn) {
                if (!confirm('ഈ അക്കൗണ്ട് remove ചെയ്യട്ടെ?')) return;
                const activeId = window.AppSession?.getStudentId?.() || '';
                window.AppSession?.logoutStudent(removeBtn.dataset.id, { removeAccount: true });
                if (activeId === removeBtn.dataset.id) window.location.href = 'index.html';
                else renderAccountSwitcher();
            }
        });
        document.getElementById('account-switcher-logout-btn')?.addEventListener('click', () => logoutStudent());
        document.getElementById('account-switcher-add-btn')?.addEventListener('click', () => {
            window.location.href = 'index.html?addStudent=1';
        });

        // ----------------------------------------------------
        // NOTIFICATION ENGINE LOGIC
        // ----------------------------------------------------
        let notifState = { lastMarkedAllReadAt: 0, readIds: [] };
        let rawSysNotifs = [];
        let rawNotices = [];
        let rawFeeAlerts = [];
        let rawResultAlerts = [];
        let latestMergedNotifications = [];

        const toggleNotifyPanel = (show) => {
            const panel = document.getElementById('student-notify-panel');
            const backdrop = document.getElementById('student-notify-backdrop');
            if (!panel || !backdrop) return;
            panel.classList.toggle('active', Boolean(show));
            backdrop.classList.toggle('opacity-0', !show);
            backdrop.classList.toggle('pointer-events-none', !show);
        };
        const openStudentDetailModal = (title = 'Details', html = '') => {
            const modal = document.getElementById('student-detail-modal');
            if (!modal) return;
            document.getElementById('student-detail-modal-title').textContent = title;
            document.getElementById('student-detail-modal-body').innerHTML = html;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.classList.add('overflow-hidden');
        };
        const closeStudentDetailModal = () => {
            const modal = document.getElementById('student-detail-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
        };
        const latestFeeInsightState = { paid: [], pending: [], payments: [] };
        const buildFeeListModalHtml = (items = [], emptyText = 'No items found.') => {
            if (!items.length) return `<div class="shared-empty-state"><i class="fas fa-circle-info"></i><span>${escapeHtml(emptyText)}</span></div>`;
            return `<div class="space-y-3">${items.map((item) => `
                <div class="fee-modal-list-item ${item.status === 'paid' ? 'paid' : 'pending'}">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <div class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">${escapeHtml(item.academicYear || '--')}</div>
                            <div class="text-sm font-extrabold text-slate-800 mt-1">${escapeHtml(item.name || 'Fee Item')}</div>
                        </div>
                        <div class="text-right font-mono font-extrabold ${item.status === 'paid' ? 'text-emerald-700' : 'text-red-600'}">${formatCurrency(item.amount || 0)}</div>
                    </div>
                    ${item.meta ? `<div class="mt-2 text-xs font-semibold text-slate-500">${item.meta}</div>` : ''}
                </div>
            `).join('')}</div>`;
        };
        window.openFeeDetailModal = (cardEl) => {
            const feeCard = cardEl?.closest?.('.fee-card') || cardEl;
            const title = feeCard?.querySelector('.fee-month')?.textContent?.trim() || 'Fee Details';
            const detailHtml = feeCard?.querySelector('.fee-details-panel')?.innerHTML || '<p>No details available.</p>';
            openStudentDetailModal(title, `<div class="space-y-3">${detailHtml}</div>`);
        };
        window.openFeeInsightModal = (type) => {
            if (type === 'paid') {
                openStudentDetailModal('Paid Items', buildFeeListModalHtml(latestFeeInsightState.paid, 'No paid fee items in this academic year.'));
            } else if (type === 'pending') {
                openStudentDetailModal('Pending Items', buildFeeListModalHtml(latestFeeInsightState.pending, 'No pending fee items in this academic year.'));
            } else if (type === 'last') {
                openStudentDetailModal('Last Payment', buildFeeListModalHtml(latestFeeInsightState.payments, 'No payment has been recorded yet.'));
            }
        };

        const stableNotificationHash = (value = '') => {
            const str = String(value || '');
            let hash = 0;
            for (let i = 0; i < str.length; i += 1) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash).toString(36);
        };
        const getNoticeTimestamp = (notice = {}, fallbackIndex = 0, field = 'createdAt') => {
            const numericValue = Number(notice[field] || 0);
            if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
            const dateValue = notice.date ? new Date(notice.date).getTime() : 0;
            return Number.isFinite(dateValue) && dateValue > 0 ? dateValue + fallbackIndex : Date.now() - fallbackIndex;
        };
        const buildPublicNoticeNotifications = () => {
            const alerts = [];
            rawNotices.forEach((notice = {}, idx) => {
                const heading = notice.heading || notice.title || 'Update';
                const text = notice.text || notice.content || '';
                const baseKey = notice.id || `${heading}|${notice.date || ''}|${text}`;
                const fallbackTs = Number(notice.createdAt || notice.updatedAt || notice.pinnedAt || 0)
                    || (notice.date ? new Date(notice.date).getTime() : 0)
                    || (1704067200000 + (stableNotificationHash(baseKey).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 1000));
                alerts.push({
                    id: `notice-new-${stableNotificationHash(baseKey)}`,
                    type: 'notice',
                    icon: 'fa-bullhorn',
                    title: `New Notice: ${heading}`,
                    message: text,
                    timestamp: getNoticeTimestamp({ ...notice, createdAt: fallbackTs }, idx, 'createdAt'),
                    target: 'index.html#notices'
                });
                if (notice.pinned === true) {
                    alerts.push({
                        id: `notice-pinned-${stableNotificationHash(baseKey)}-${notice.pinnedAt || 'active'}`,
                        type: 'notice',
                        icon: 'fa-thumbtack',
                        title: `Pinned Notice: ${heading}`,
                        message: text || 'An important notice has been pinned on the public page.',
                        timestamp: getNoticeTimestamp({ ...notice, pinnedAt: fallbackTs }, idx, 'pinnedAt'),
                        target: 'index.html#notices'
                    });
                }
            });
            return alerts;
        };
        const buildResultNotificationAlerts = (profile = {}, results = []) => {
            const alerts = [];
            const classLabel = profile?.class || '';
            const activeYear = currentAcademicYear || profile?.academicYear || selectedFeeAcademicYear || '';
            const visibleResults = results.filter((result) => {
                if (result.published === false) return false;
                if (!activeYear) return true;
                return (result.academicYear || profile?.academicYear || '') === activeYear;
            });
            visibleResults.forEach((result, idx) => {
                const resultClass = result.classLabel || classByYear[result.academicYear] || classLabel;
                if (resultCenterSettings.blockedClasses?.includes(resultClass)) return;
                const examLabel = result.examLabel || examLabels[result.examType] || result.examId || 'Exam';
                const academicYear = result.academicYear || profile?.academicYear || '--';
                alerts.push({
                    id: `result-published-${result.id || stableNotificationHash(`${result.studentId || studentId}|${academicYear}|${examLabel}`)}`,
                    type: 'result',
                    icon: 'fa-square-poll-vertical',
                    title: `${examLabel} Result Published`,
                    message: `${academicYear} academic year result is now available for ${resultClass || 'your class'}.`,
                    timestamp: Number(result.publishedAt || result.updatedAt || 0) || 0,
                    target: 'results-page'
                });
            });

            const publishTs = resultCenterSettings.publishAt ? new Date(resultCenterSettings.publishAt).getTime() : 0;
            const countdownActive = (resultCenterSettings.locked === true) || (Number.isFinite(publishTs) && publishTs > Date.now());
            if (countdownActive && !resultCenterSettings.blockedClasses?.includes(classLabel)) {
                const examLabel = resultCenterSettings.examLabel || 'Upcoming Exam';
                const publishLabel = formatPublishDateTime(resultCenterSettings.publishAt);
                alerts.push({
                    id: `result-countdown-${stableNotificationHash(`${examLabel}|${resultCenterSettings.publishAt || 'locked'}`)}`,
                    type: 'result',
                    icon: 'fa-hourglass-half',
                    title: 'Result Countdown Started',
                    message: `${examLabel} result countdown has started. Scheduled publish time: ${publishLabel}.`,
                    timestamp: Number(resultCenterSettings.countdownStartedAt || resultCenterSettings.updatedAt || 0) || (Number.isFinite(publishTs) ? publishTs : 0),
                    target: 'results-page'
                });
            }
            return alerts;
        };

        const renderNotificationPanel = () => {
            const allNotifs = [];
            
            rawSysNotifs.forEach(n => {
                if (n.expiryDate && n.expiryDate < Date.now()) return;
                if (n.audience === 'students' || n.audience === 'all' || (n.audience === 'specific' && n.audienceIds?.includes(studentId))) {
                    allNotifs.push({
                        id: n.id, type: 'sys', icon: n.icon || 'fa-info-circle',
                        title: n.title, message: n.message, timestamp: n.createdAt || 0,
                        target: n.target || 'home-page'
                    });
                }
            });

            allNotifs.push(...buildPublicNoticeNotifications());

            const merged = [...allNotifs, ...rawFeeAlerts, ...rawResultAlerts].reduce((acc, curr) => {
                if (!acc.some(x => x.id === curr.id)) acc.push(curr);
                return acc;
            }, []).sort((a, b) => b.timestamp - a.timestamp);
            latestMergedNotifications = merged;
            const visibleNotifications = merged.filter((notification) => {
                const isRead = notification.type === 'fee'
                    ? false
                    : (notification.timestamp <= notifState.lastMarkedAllReadAt || notifState.readIds.includes(notification.id));
                notification.isRead = isRead;
                return !isRead;
            });

            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const shouldCountForBadge = (notification) => {
                if (notification.type === 'fee') return true;
                return Number(notification.timestamp || 0) >= oneWeekAgo;
            };
            let unreadCount = visibleNotifications.filter((notification) => shouldCountForBadge(notification)).length;
            const listContainer = document.getElementById('student-notify-list');
            listContainer.innerHTML = '';
            
            if(visibleNotifications.length === 0) {
                listContainer.innerHTML = `<div class="notify-empty-state"><i class="fas fa-bell-slash"></i><span>No notifications yet</span></div>`;
                document.getElementById('student-notify-badge').classList.add('hidden');
                return;
            }

            const todayStart = new Date().setHours(0,0,0,0);
            const yesterdayStart = todayStart - 86400000;
            let currentGroup = '';

            visibleNotifications.forEach(n => {

                let groupLabel = 'Older';
                if(n.timestamp >= todayStart) groupLabel = 'Today';
                else if(n.timestamp >= yesterdayStart) groupLabel = 'Yesterday';

                if(groupLabel !== currentGroup) {
                    currentGroup = groupLabel;
                    listContainer.innerHTML += `<div class="notify-group-label">${groupLabel}</div>`;
                }

                const iconClass = n.type === 'sys' ? 'sys' : (n.type === 'fee' ? 'fee' : (n.type === 'result' ? 'result' : 'notice'));
                const timeAgoStr = n.timestamp ? new Date(n.timestamp).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'Just now';

                const showUnreadDot = !n.isRead && shouldCountForBadge(n);
                listContainer.innerHTML += `
                    <button type="button" class="notify-item ${n.isRead ? '' : 'unread'}" onclick="handleNotifyClick('${n.id}', '${n.target}')">
                        <div class="notify-icon ${iconClass}"><i class="fas ${n.icon}"></i></div>
                        <div class="notify-content">
                            <div class="notify-title">${escapeHtml(n.title)}</div>
                            <div class="notify-msg">${escapeHtml(n.message)}</div>
                            <div class="notify-time"><i class="far fa-clock text-[9px]"></i> ${timeAgoStr}</div>
                        </div>
                        ${showUnreadDot ? `<div class="notify-unread-dot"></div>` : ''}
                    </button>
                `;
            });

            const badge = document.getElementById('student-notify-badge');
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        };

        window.handleNotifyClick = async (notifId, targetStr) => {
            const notification = latestMergedNotifications.find((item) => item.id === notifId);
            if (notification?.type === 'fee') {
                renderNotificationPanel();
            } else if (!notifState.readIds.includes(notifId)) {
                notifState.readIds.push(notifId);
                if(notifState.readIds.length > 150) notifState.readIds.shift();
                renderNotificationPanel();
                try {
                    await setDoc(doc(db, BASE_PATH + '/studentNotificationState', studentId), {
                        readIds: notifState.readIds
                    }, { merge: true });
                } catch(e) { console.warn('Failed to update read state', e); }
            }
            toggleNotifyPanel(false);
            if (targetStr && targetStr.includes('.html')) window.location.href = targetStr;
            else if (targetStr) activateStudentTab(targetStr);
        };

        document.getElementById('student-notify-mark-all')?.addEventListener('click', async () => {
            const nonFeeIds = latestMergedNotifications
                .filter((notification) => notification.type !== 'fee')
                .map((notification) => notification.id)
                .filter(Boolean);
            notifState.lastMarkedAllReadAt = Date.now();
            notifState.readIds = [...new Set([...notifState.readIds, ...nonFeeIds])].slice(-150);
            renderNotificationPanel();
            try {
                await setDoc(doc(db, BASE_PATH + '/studentNotificationState', studentId), {
                    lastMarkedAllReadAt: notifState.lastMarkedAllReadAt,
                    readIds: notifState.readIds
                }, { merge: true });
            } catch(e) { console.warn('Failed to mark all as read', e); }
        });

        document.getElementById('student-notify-trigger')?.addEventListener('click', () => toggleNotifyPanel(true));
        document.getElementById('student-notify-close')?.addEventListener('click', () => toggleNotifyPanel(false));
        document.getElementById('student-notify-backdrop')?.addEventListener('click', () => toggleNotifyPanel(false));
        document.getElementById('student-detail-modal-close')?.addEventListener('click', () => closeStudentDetailModal());
        document.getElementById('student-detail-modal')?.addEventListener('click', (event) => {
            if (event.target?.id === 'student-detail-modal') closeStudentDetailModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeStudentDetailModal();
                toggleNotifyPanel(false);
            }
            if ((event.key === 'Enter' || event.key === ' ') && event.target?.classList?.contains('fee-card')) {
                event.preventDefault();
                window.openFeeDetailModal(event.target);
            }
        });
        window.triggerNotificationUpdate = () => renderNotificationPanel();

        function fitText(elementId) {
            const el = document.getElementById(elementId);
            if(!el) return;
            const parent = el.parentElement;
            el.style.fontSize = ''; 
            let fontSize = parseInt(window.getComputedStyle(el).fontSize);
            el.style.whiteSpace = 'nowrap';
            while (el.scrollWidth > parent.clientWidth && fontSize > 12) {
                fontSize -= 1;
                el.style.fontSize = fontSize + 'px';
            }
        }
        window.addEventListener('resize', () => { fitText('header-title'); });


        registerServiceWorker();
        const studentId = window.AppSession?.getStudentId?.() || '';
        let feeItems = [], allPayments = [], studentGroups = [], allStaff = [];
        let groupMemberProfileMap = {};
        let defaultFee = 200;
        let paymentDetails = {};
        let resultSchemas = [];
        let resultCenterSettings = { locked: false, blockedClasses: [] };
        let studentPhotoSubmission = {};
        const STUDENT_DONATION_ITEM_KEY = '__student_donation__';
        const MONTH_SEQUENCE = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        let availableAcademicYears = [];
        let selectedFeeAcademicYear = '';
        let selectedResultAcademicYear = '';
        let studentProfile = null;
        let studentResultsCache = [];
        let resultCountdownTimer = null;
        let academicYearSettings = [];
        let currentAcademicYear = '';
        let sessionRegistryHeartbeat = null;
        const getStudentSessionRegistryRef = () => doc(db, `${BASE_PATH}/settings`, 'sessionRegistry');
        const getStudentDeviceId = () => {
            const key = 'fee_student_device_id';
            const existing = localStorage.getItem(key);
            if (existing) return existing;
            const generated = `stu-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
            localStorage.setItem(key, generated);
            return generated;
        };
        const updateStudentSessionRegistry = async (profile = {}) => {
            if (!studentId) return;
            const deviceId = getStudentDeviceId();
            await setDoc(getStudentSessionRegistryRef(), {
                sessions: {
                    [deviceId]: {
                        deviceId,
                        role: 'student',
                        userKey: studentId,
                        userName: profile?.name || studentId,
                        deviceLabel: navigator.userAgent.includes('Android') ? 'Android Device' : navigator.userAgent.includes('iPhone') ? 'iOS Device' : 'Browser Device',
                        platform: navigator.platform || '',
                        lastSeenAt: new Date().toISOString(),
                        forceLogout: false
                    }
                }
            }, { merge: true });
        };
        const startStudentSessionHeartbeat = (profile = {}) => {
            if (sessionRegistryHeartbeat) clearInterval(sessionRegistryHeartbeat);
            updateStudentSessionRegistry(profile).catch((error) => console.warn('Student session registry update failed.', error));
            sessionRegistryHeartbeat = setInterval(() => {
                updateStudentSessionRegistry(profile).catch((error) => console.warn('Student session registry update failed.', error));
            }, 60000);
        };
        const defaultCollectorLabel = 'School Office';
        const getCollectorPaymentContext = (classLabel = '') => {
            const normalizedClass = String(classLabel || '').trim();
            const collector = allStaff.find((staff) => {
                if (!staff || staff.isActive === false || staff.canCollect === false) return false;
                const dutyClasses = Array.isArray(staff.dutyClasses) ? staff.dutyClasses : [];
                return dutyClasses.includes(normalizedClass);
            });
            const collectorDetails = (collector && collector.dutyPaymentDetails && typeof collector.dutyPaymentDetails === 'object')
                ? collector.dutyPaymentDetails
                : {};
            const hasCollectorDetails = Object.values(collectorDetails).some((value) => String(value || '').trim() !== '');
            return {
                collectorName: collector?.name || '',
                ownerLabel: collector?.name || defaultCollectorLabel,
                details: hasCollectorDetails ? collectorDetails : paymentDetails
            };
        };
        const formatPublishDateTime = (value = '') => {
            if (!value) return 'Not scheduled';
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) return value;
            return parsed.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        };
        const examOrder = ['quarterly', 'halfYearly', 'annual'];
        const examLabels = { quarterly: 'Quarterly', halfYearly: 'Half-Yearly', annual: 'Annual' };
        const stringifyResultLabel = (value, fallback = 'Exam') => {
            if (typeof value === 'string' || typeof value === 'number') return String(value || fallback);
            if (value && typeof value === 'object') {
                return String(value.label || value.name || value.title || value.examLabel || value.examName || fallback);
            }
            return fallback;
        };
        const getConfiguredExamNoticeItems = (academicYear = '', classLabel = '') => {
            const schema = resultSchemas.find((item) => {
                const yearMatch = !academicYear || item.academicYear === academicYear || !item.academicYear;
                const classMatch = !classLabel || item.classLabel === classLabel || !item.classLabel;
                return yearMatch && classMatch;
            });
            const configured = schema?.examConfigs && typeof schema.examConfigs === 'object'
                ? examOrder.map((key) => ({ key, label: stringifyResultLabel(schema.examConfigs[key], examLabels[key] || key) }))
                : [];
            const items = configured.length ? configured : examOrder.map((key) => ({ key, label: examLabels[key] || key }));
            return items.slice(0, 3);
        };
        const classByYear = {};

        const getSortedAcademicYears = (years = []) => [...new Set(years.filter(Boolean))]
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const getMonthIndexFromName = (name = '') => {
            const normalized = String(name || '').trim().toLowerCase();
            const matchedMonth = MONTH_SEQUENCE.find((month) => new RegExp(`(^|[^a-z])${month}([^a-z]|$)`).test(normalized));
            return matchedMonth ? MONTH_SEQUENCE.indexOf(matchedMonth) : -1;
        };
        const formatMonthFeeCardName = (name = '') => {
            const monthIndex = getMonthIndexFromName(name);
            if (monthIndex < 0) return String(name || 'Monthly Fee');
            return MONTH_SEQUENCE[monthIndex].charAt(0).toUpperCase() + MONTH_SEQUENCE[monthIndex].slice(1);
        };
        const getAcademicYearRecord = (label = '') => academicYearSettings.find((year) => year?.label === label) || null;
        const getAcademicYearStatus = (label = '') => String(getAcademicYearRecord(label)?.status || 'active').toLowerCase();
        const isYearVisibleInStudent = (label = '') => getAcademicYearStatus(label) !== 'archived';
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
        const getStudentBaseMonthlyFee = (st = {}) => {
            if(st.concessionFee !== undefined && st.concessionFee !== null && st.concessionFee !== "") return st.concessionFee;
            const group = studentGroups.find(g => g.memberIds.includes(studentId));
            return group && group.fee > 0 ? group.fee : defaultFee;
        };
        const getFeeItemAmount = (item = {}, classLabel = '--', baseFee = defaultFee) => {
            if(item.type === 'custom') {
                if(item.scope === 'global') return item.amount || 0;
                if(item.scope === 'class-wise' && item.classValues) return item.classValues[classLabel] || 0;
                if(item.scope === 'specific') return item.amount || 0;
            }
            return baseFee;
        };
        const getFeeYearSummary = (st = {}, academicYear = '') => {
            const classLabel = classByYear[academicYear] || st?.class || '--';
            const baseFee = getStudentBaseMonthlyFee(st);
            const currentYearFeeItems = feeItems.filter((item) => (item.academicYear || st.academicYear || '') === academicYear);
            const yearPayments = allPayments.filter((payment) => {
                const item = currentYearFeeItems.find((feeItem) => feeItem.key === payment.itemKey);
                const paymentYear = payment.academicYear || item?.academicYear || '';
                return paymentYear === academicYear;
            });
            const paymentsByItem = new Map(yearPayments.map((payment) => [payment.itemKey, payment]));
            const visibleItems = currentYearFeeItems.filter((item) => {
                if(item.isVisible === false) return false;
                if(item.key === STUDENT_DONATION_ITEM_KEY) return false;
                if(item.type === 'custom' && item.scope === 'specific' && item.targetClass !== classLabel) return false;
                return true;
            });
            const dueItems = visibleItems
                .filter((item) => !paymentsByItem.has(item.key))
                .map((item) => ({
                    item,
                    name: item.name || 'Fee Item',
                    amount: getFeeItemAmount(item, classLabel, baseFee),
                    monthIndex: (!item.type || item.type === 'month') ? getMonthIndexFromName(item.name) : -1
                }));
            return {
                academicYear,
                totalDue: dueItems.reduce((sum, due) => sum + (Number(due.amount) || 0), 0),
                dueItems
            };
        };
        const buildFeeNotificationAlerts = (st = {}) => {
            const alerts = [];
            const now = new Date();
            const nowTs = Date.now();
            const currentYear = currentAcademicYear || st?.academicYear || selectedFeeAcademicYear || '';

            if (currentYear) {
                const currentSummary = getFeeYearSummary(st, currentYear);
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
                const currentMonthDue = currentSummary.dueItems.find((due) => due.monthIndex === now.getMonth());
                if (currentMonthDue) {
                    alerts.push({
                        id: `fee-current-due-${currentYear}-${now.getMonth() + 1}-${currentMonthDue.item?.key || currentMonthDue.name}`,
                        type: 'fee',
                        icon: 'fa-calendar-check',
                        title: `${formatMonthFeeCardName(currentMonthDue.name)} Fee Pending`,
                        message: `${formatMonthFeeCardName(currentMonthDue.name)} fee of ${formatCurrency(currentMonthDue.amount)} is pending for this month. This notification will clear after payment is recorded.`,
                        timestamp: monthStart.getTime(),
                        target: 'fees-page'
                    });
                }

                const monthOrder = getAcademicMonthSequence(currentYear);
                const currentMonthOrderIndex = monthOrder.indexOf(now.getMonth());
                currentSummary.dueItems.forEach((due) => {
                    // Keep non-default/custom fee reminders active until they are paid.
                    if (due.monthIndex < 0) {
                        alerts.push({
                            id: `fee-custom-due-${currentYear}-${due.item?.key || due.name}`,
                            type: 'fee',
                            icon: 'fa-triangle-exclamation',
                            title: `${normalizeFeeItemName(due.name)} Pending`,
                            message: `${normalizeFeeItemName(due.name)} fee of ${formatCurrency(due.amount)} is still unpaid. Please pay it at the earliest.`,
                            timestamp: nowTs,
                            target: 'fees-page'
                        });
                        return;
                    }

                    // If monthly fee remains unpaid after that month has passed in academic order,
                    // keep showing overdue notification until settled.
                    const dueMonthOrderIndex = monthOrder.indexOf(due.monthIndex);
                    const isOverdueMonthly = currentMonthOrderIndex >= 0 && dueMonthOrderIndex >= 0 && dueMonthOrderIndex < currentMonthOrderIndex;
                    if (isOverdueMonthly) {
                        alerts.push({
                            id: `fee-overdue-${currentYear}-${due.monthIndex}-${due.item?.key || 'month'}`,
                            type: 'fee',
                            icon: 'fa-clock',
                            title: `${formatMonthFeeCardName(due.name)} Fee Overdue`,
                            message: `${formatMonthFeeCardName(due.name)} fee of ${formatCurrency(due.amount)} is overdue. Please clear it before the next month cycle.`,
                            timestamp: nowTs,
                            target: 'fees-page'
                        });
                    }
                });
            }
            return alerts;
        };
        const sortMonthlyItemsByAcademicYear = (items = [], academicYear = '') => {
            const monthOrder = getAcademicMonthSequence(academicYear || selectedFeeAcademicYear);
            return [...items].sort((a, b) => {
                const aName = String(a?.name || '').trim();
                const bName = String(b?.name || '').trim();
                const aOrder = monthOrder.indexOf(getMonthIndexFromName(aName));
                const bOrder = monthOrder.indexOf(getMonthIndexFromName(bName));
                if (aOrder === -1 && bOrder === -1) return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
                if (aOrder === -1) return 1;
                if (bOrder === -1) return -1;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
            });
        };
        const buildAvailableAcademicYears = (profile, payments = [], results = []) => {
            const yearsFromFeeItems = feeItems.map((item) => item.academicYear).filter(Boolean);
            const yearsFromPayments = payments.map((item) => item.academicYear).filter(Boolean);
            const yearsFromResults = results.map((item) => item.academicYear).filter(Boolean);
            const paidYears = new Set(yearsFromPayments);
            const allYears = getSortedAcademicYears([profile?.academicYear, ...yearsFromFeeItems, ...yearsFromPayments, ...yearsFromResults]);
            const filtered = allYears.filter((year) => {
                const status = getAcademicYearStatus(year);
                if (status === 'archived') return false;
                if (status === 'planning') return paidYears.has(year);
                return isYearVisibleInStudent(year);
            });
            return filtered.length ? filtered : [profile?.academicYear || '--'];
        };

        const updateYearNavigatorState = (prevId, nextId, currentYear) => {
            const idx = availableAcademicYears.indexOf(currentYear);
            const prevBtn = document.getElementById(prevId);
            const nextBtn = document.getElementById(nextId);
            const prevLabel = document.getElementById(prevId.replace('-btn', '-label'));
            const nextLabel = document.getElementById(nextId.replace('-btn', '-label'));
            if (prevBtn) prevBtn.disabled = idx <= 0;
            if (nextBtn) nextBtn.disabled = idx === -1 || idx >= availableAcademicYears.length - 1;
            if (prevLabel) prevLabel.textContent = idx > 0 ? availableAcademicYears[idx - 1] : '--';
            if (nextLabel) nextLabel.textContent = idx >= 0 && idx < availableAcademicYears.length - 1 ? availableAcademicYears[idx + 1] : '--';
        };
        const renderAcademicYearSelect = (selectId, activeYear) => {
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = availableAcademicYears.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join('');
            select.value = activeYear || availableAcademicYears[0] || '';
        };
        const resolveAcademicClass = (year = '', profile = {}) => {
            if (year && classByYear[year]) return classByYear[year];
            if (year) {
                const resultMatch = (studentResultsCache || []).find((item) => (item.academicYear || '') === year && item.classLabel);
                if (resultMatch?.classLabel) return resultMatch.classLabel;
                const paymentMatch = (allPayments || []).find((item) => (item.academicYear || '') === year && (item.classLabel || item.class));
                if (paymentMatch) return paymentMatch.classLabel || paymentMatch.class;
            }
            return profile?.class || '--';
        };

        const resolveSubjectLabel = (schema, subjectKey) => {
            const normalizedKey = String(subjectKey || '').trim().toLowerCase();
            const subjects = Array.isArray(schema?.subjectRows) && schema.subjectRows.length ? schema.subjectRows : (Array.isArray(schema?.subjects) ? schema.subjects : []);
            const matchedSubject = subjects.find((subject) => {
                const code = String(subject?.code || subject?.id || '').trim().toLowerCase();
                const name = typeof subject === 'string' ? subject.trim().toLowerCase() : String(subject?.name || '').trim().toLowerCase();
                return normalizedKey === code || normalizedKey === name;
            });
            return (typeof matchedSubject === 'string' ? matchedSubject : matchedSubject?.name) || subjectKey || '--';
        };
        const displayResultMark = (mark) => {
            if (mark && typeof mark === 'object') return String(mark.value ?? mark.mark ?? '-');
            return String(mark ?? '-');
        };
        const normalizeFeeItemDisplayName = (name = '') => String(name || '').replace(/\s*\((?:\d{4}\s*-\s*\d{2,4}|\d{4}\s*-\s*\d{4})\)\s*$/i, '').trim();
        const computeDisplayGrade = (markValue, subjectMax = 100) => {
            const raw = String(markValue ?? '').trim();
            const num = Number(raw);
            if (!Number.isFinite(num)) return raw || '-';
            const scale = Number(resultCenterSettings.gradeScaleTotal || 100) === 50 ? 50 : 100;
            const score = (num / Math.max(1, Number(subjectMax || 100))) * scale;
            const rules = Array.isArray(resultCenterSettings.gradeRules) ? resultCenterSettings.gradeRules : [];
            const matched = rules.find((rule) => score >= Number(rule.min || 0) && score <= Number(rule.max || 0));
            if (matched?.grade) return matched.grade;
            if (scale === 50) return score >= 45 ? 'A+' : score >= 40 ? 'A' : score >= 30 ? 'B' : score >= 18 ? 'C' : 'F';
            return score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 35 ? 'C' : 'F';
        };
        const buildResultPosterBlob = async (result, cardEl = null) => {
            const conf = window.institutionConfig || {};
            const examLabel = result.examLabel || examLabels[result.examType || result.examKey] || result.examType || 'Exam';
            const classLabel = result.classLabel || studentProfile?.class || '--';
            const showMarks = result.showMarksToStudents !== false;
            const showGrades = true;
            const subjectKeys = Object.keys(result.grades || result.marks || {});
            const colLabels = ['Subject', ...(showMarks ? ['Mark'] : []), ...(showGrades ? ['Grade'] : [])];
            const colWidth = [420, ...(showMarks ? [140] : []), ...(showGrades ? [140] : [])];
            const rowHeight = 48;
            const headerHeight = 330;
            const summaryHeight = 210;
            const tableHeight = 62 + (Math.max(1, subjectKeys.length) * rowHeight);
            const designWidth = 1080;
            const designHeight = Math.max(1080, headerHeight + tableHeight + summaryHeight + 70);
            const pixelRatio = 2;
            const canvas = document.createElement('canvas');
            canvas.width = designWidth * pixelRatio;
            canvas.height = designHeight * pixelRatio;
            canvas.style.width = `${designWidth}px`;
            canvas.style.height = `${designHeight}px`;
            const ctx = canvas.getContext('2d');
            ctx.scale(pixelRatio, pixelRatio);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, designWidth, designHeight);
            const regAndPlace = [conf.place || '', conf.regNo ? `Reg No: ${conf.regNo}` : ''].filter(Boolean).join(' • ');
            const institutionName = conf.appName || conf.institutionName || document.getElementById('header-title')?.textContent?.trim() || 'Institution';

            const grad = ctx.createLinearGradient(0, 0, designWidth, 280);
            grad.addColorStop(0, '#312e81');
            grad.addColorStop(1, '#0f766e');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, designWidth, 250);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = '800 42px Arial';
            ctx.fillText(institutionName, designWidth / 2, 70);
            ctx.font = '600 22px Arial';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(regAndPlace || '--', designWidth / 2, 106);
            ctx.font = '900 52px Arial';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(studentProfile?.name || 'Student', designWidth / 2, 175);
            ctx.font = '700 28px Arial';
            ctx.fillStyle = '#dbeafe';
            ctx.fillText(`Class: ${classLabel}  |  Exam: ${examLabel}`, designWidth / 2, 216);
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(60, 262); ctx.lineTo(designWidth - 60, 262); ctx.stroke();

            let y = 265;
            let x = 120;
            ctx.textAlign = 'left';
            colLabels.forEach((label, idx) => {
                ctx.fillStyle = '#1f2937';
                ctx.font = '700 20px Arial';
                ctx.fillText(label, x + 10, y);
                x += colWidth[idx];
            });
            y += 18;
            ctx.strokeStyle = '#d1d5db';
            ctx.beginPath(); ctx.moveTo(90, y); ctx.lineTo(canvas.width - 90, y); ctx.stroke();

            const rows = subjectKeys.length ? subjectKeys : ['--'];
            rows.forEach((key, rowIdx) => {
                const markValue = key === '--' ? '-' : displayResultMark(result.marks?.[key]);
                const gradeValue = key === '--' ? '-' : computeDisplayGrade(markValue, Number(result.marks?.[key]?.maxMarks || 100));
                const isFailed = String(gradeValue).trim().toUpperCase() === 'F' || String(result.marks?.[key]?.status || '').toUpperCase() === 'FAIL';
                const rowData = [key === '--' ? 'No subject entries' : resolveSubjectLabel(null, key), ...(showMarks ? [markValue] : []), ...(showGrades ? [gradeValue] : [])];
                const rowY = y + 36 + (rowIdx * rowHeight);
                let colX = 120;
                rowData.forEach((cell, idx) => {
                    ctx.fillStyle = (isFailed && idx > 0) ? '#dc2626' : (idx === 0 ? '#111827' : '#374151');
                    ctx.font = idx === 0 ? '600 18px Arial' : '500 18px Arial';
                    ctx.fillText(String(cell), colX + 10, rowY);
                    colX += colWidth[idx];
                });
                ctx.strokeStyle = '#e5e7eb';
                ctx.beginPath(); ctx.moveTo(110, rowY + 16); ctx.lineTo(designWidth - 110, rowY + 16); ctx.stroke();
            });

            const summaryY = headerHeight + tableHeight + 20;
            const cards = [
                `Total\n${result.totals?.obtained ?? '-'} / ${result.totals?.maximum ?? '-'}`,
                `Attendance\n${result.attendance?.presentDays ?? 0} / ${result.attendance?.workingDays ?? 0}`,
                `Status\n${result.totals?.passStatus || '--'}`
            ];
            cards.forEach((text, idx) => {
                const cardX = 110 + (idx * 290);
                ctx.fillStyle = '#f8fafc';
                ctx.fillRect(cardX, summaryY, 250, 130);
                ctx.strokeStyle = '#e5e7eb';
                ctx.strokeRect(cardX, summaryY, 250, 130);
                const [title, value] = text.split('\n');
                ctx.fillStyle = '#6b7280';
                ctx.font = '700 18px Arial';
                ctx.fillText(title, cardX + 14, summaryY + 34);
                ctx.fillStyle = '#111827';
                ctx.font = '800 24px Arial';
                ctx.fillText(value, cardX + 14, summaryY + 78);
            });
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Failed to generate image blob');
            return blob;
        };
        const downloadRankPoster = async (result, cardEl = null) => {
            const blob = await buildResultPosterBlob(result, cardEl);
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `result_card_${(studentProfile?.name || 'student').replace(/\s+/g, '_')}_${result.examType || 'exam'}.png`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
        };
        const shareRankPoster = async (result, cardEl = null) => {
            const blob = await buildResultPosterBlob(result, cardEl);
            const fileName = `result_card_${(studentProfile?.name || 'student').replace(/\s+/g, '_')}_${result.examType || 'exam'}.png`;
            const imageFile = new File([blob], fileName, { type: 'image/png' });
            if (navigator.share && navigator.canShare?.({ files: [imageFile] })) {
                await navigator.share({
                    title: `${studentProfile?.name || 'Student'} - ${result.examLabel || examLabels[result.examType] || 'Exam Result'}`,
                    text: 'Result card',
                    files: [imageFile]
                });
                return;
            }
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(blob);
            anchor.download = fileName;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
        };

        const syncResultTabVisibility = (showResults = false) => {
            const navItem = document.getElementById('results-nav-item');
            const bottomBtn = document.getElementById('results-bottom-btn');
            navItem?.classList.remove('hidden');
            bottomBtn?.classList.remove('hidden');
        };
        const renderStudentResults = (profile, results = [], targetYear = '') => {
            try {
            const activeYear = targetYear || profile?.academicYear || '--';
            const classLabel = resolveAcademicClass(activeYear, profile);
            document.getElementById('results-year-label').textContent = ``;
            document.getElementById('results-class-label').textContent = `Class: ${classLabel}`;
            renderAcademicYearSelect('results-year-select', activeYear);

            const container = document.getElementById('results-container');
            if (resultCountdownTimer) {
                clearInterval(resultCountdownTimer);
                resultCountdownTimer = null;
            }
            if (resultCenterSettings.blockedClasses?.includes(classLabel)) {
                container.innerHTML = buildEmptyState({ icon: 'fa-eye-slash', title: 'Class Blocked', message: 'Result visibility is temporarily blocked for your class.' });
                return;
            }
            const filteredResults = results.filter((result) => (result.academicYear || '') === activeYear);
            const examSelect = document.getElementById('results-exam-select');
            const examOptions = [...new Set(filteredResults.map((result) => result.examType || result.examKey || ''))].filter(Boolean);
            if (examSelect) {
                const defaultExam = resultCenterSettings.publishExamKey || examOptions[0] || '';
                const prev = examSelect.value || defaultExam;
                examSelect.innerHTML = `<option value="">All Exams</option>${examOptions.map((exam) => {
                    const rawLabel = filteredResults.find((row) => (row.examType || row.examKey || '') === exam)?.examLabel || examLabels[exam] || exam;
                    const label = stringifyResultLabel(rawLabel, examLabels[exam] || exam);
                    return `<option value="${escapeHtml(exam)}">${escapeHtml(label)}</option>`;
                }).join('')}`;
                examSelect.value = prev;
            }
            const selectedExam = examSelect?.value || resultCenterSettings.publishExamKey || '';
            const examScopedResults = selectedExam ? filteredResults.filter((result) => (result.examType || result.examKey || '') === selectedExam) : filteredResults;
            
            const publishTs = resultCenterSettings.publishAt ? new Date(resultCenterSettings.publishAt).getTime() : 0;
            const shouldShowCountdown = Number.isFinite(publishTs) && publishTs > Date.now() && !filteredResults.length;
            const formatCountdown = (remainingMs) => {
                const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
                const days = Math.floor(totalSeconds / 86400);
                const hours = Math.floor((totalSeconds % 86400) / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;
                const lead = days > 0 ? `${days}d ` : '';
                return `${lead}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            };
            if (resultCenterSettings.locked === true || shouldShowCountdown) {
                
                const publishAtLabel = formatPublishDateTime(resultCenterSettings.publishAt);
                const examLabel = resultCenterSettings.examLabel || 'Upcoming Exam';
                container.innerHTML = `
                    <div class="result-countdown-card">
                        <div class="result-countdown-head">
                            <div class="result-countdown-icon"><i class="fas fa-hourglass-half"></i></div>
                            <span class="result-countdown-exam">${escapeHtml(examLabel)}</span>
                        </div>
                        <h3 class="result-countdown-title">Results will be published soon</h3>
                        <p class="result-countdown-subtitle">Scheduled publish time: <strong>${escapeHtml(publishAtLabel)}</strong></p>
                        <div id="results-publish-countdown" class="result-countdown-time">--:--:--</div>
                        <p class="result-countdown-note">Please check again after the countdown ends.</p>
                    </div>
                `;
                const countdownEl = document.getElementById('results-publish-countdown');
                const tick = () => {
                    if (!countdownEl) return;
                    if (!Number.isFinite(publishTs) || publishTs <= 0) {
                        countdownEl.textContent = 'Updating soon';
                        return;
                    }
                    const remaining = publishTs - Date.now();
                    countdownEl.textContent = remaining > 0 ? formatCountdown(remaining) : 'Publishing now...';
                };
                tick();
                if (Number.isFinite(publishTs) && publishTs > Date.now()) resultCountdownTimer = setInterval(tick, 1000);
                return;
            }

            if (!examScopedResults.length) {
                const headerLogo = document.getElementById('header-logo')?.getAttribute('src') || '';
                const logo = sanitizeUrl(headerLogo) || 'assets/images/logo.png';
                const noticeItems = getConfiguredExamNoticeItems(activeYear, classLabel);
                container.innerHTML = `
                    <div class="rounded-2xl border border-indigo-100 bg-gradient-to-b from-white to-indigo-50/60 px-5 py-8 text-center shadow-sm">
                        <img src="${escapeHtml(logo)}" class="mx-auto h-24 w-24 object-contain mb-4 opacity-90" alt="Institution Logo" onerror="this.src='assets/images/logo.png'">
                        <h3 class="text-lg font-extrabold text-indigo-900 mb-2">Results will be published here</h3>
                        <p class="text-sm font-semibold text-slate-600 leading-relaxed max-w-md mx-auto">
                            ${escapeHtml(activeYear)} academic year results have not been published yet. After each exam is completed, these exam results will be available here.
                        </p>
                        <div class="mt-5 grid gap-2 sm:grid-cols-3">
                            ${noticeItems.map((exam, index) => `
                                <div class="rounded-xl border border-indigo-100 bg-white px-3 py-3 shadow-sm">
                                    <div class="text-[10px] font-black uppercase tracking-wider text-indigo-400">Exam ${index + 1}</div>
                                    <div class="mt-1 text-sm font-extrabold text-indigo-800">${escapeHtml(exam.label)} Exam Result</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
                return;
            }
            const cards = examScopedResults
                .sort((a, b) => {
                    const aIndex = examOrder.indexOf(a.examType || a.examKey);
                    const bIndex = examOrder.indexOf(b.examType || b.examKey);
                    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
                })
                .map((result) => {
                    const schema = resultSchemas.find((item) => item.academicYear === result.academicYear && item.classLabel === result.classLabel);
                    const examKey = result.examType || result.examKey || '';
                    const visibilityKey = `${result.classLabel || classLabel}__${examKey}`;
                    const rawVisibility = resultCenterSettings.resultVisibilityMap?.[visibilityKey];
                    const visibility = rawVisibility && typeof rawVisibility === 'object'
                        ? { marks: rawVisibility.marks !== false, grades: rawVisibility.grades !== false }
                        : { marks: rawVisibility !== false, grades: rawVisibility !== false };
                    const examConfigShowMarks = schema?.examConfigs?.[examKey]?.showMarksToStudents === true;
                    const showMarks = result.showMarksToStudents === false
                        ? false
                        : (visibility.marks && (result.showMarksToStudents === true || examConfigShowMarks));
                    const showGrades = visibility.grades;
                    const subjectKeys = Object.keys(result.grades || result.marks || {});
                    const rankRows = filteredResults
                        .filter((item) => (item.examType || item.examKey) === examKey)
                        .sort((a, b) => Number(b.totals?.obtained || 0) - Number(a.totals?.obtained || 0));
                    const currentRank = rankRows.findIndex((row) => row.studentId === result.studentId) + 1;
                    const tableRows = subjectKeys.map((key) => {
                        const markValue = displayResultMark(result.marks?.[key]);
                        const gradeValue = computeDisplayGrade(markValue, Number(result.marks?.[key]?.maxMarks || 100));
                        const isFailed = String(gradeValue).trim().toUpperCase() === 'F' || String(result.marks?.[key]?.status || '').trim().toUpperCase() === 'FAIL';
                        return `
                        <tr class="border-b">
                            <td class="py-2 text-sm font-semibold text-gray-700">${escapeHtml(resolveSubjectLabel(schema, key))}</td>
                            ${showMarks ? `<td class="py-2 text-sm ${isFailed ? 'text-red-600 font-bold' : 'text-gray-800'}">${escapeHtml(markValue)}</td>` : ''}
                            ${showGrades ? `<td class="py-2 text-sm font-bold ${isFailed ? 'text-red-600' : 'text-indigo-700'}">${escapeHtml(gradeValue)}</td>` : ''}
                        </tr>
                    `;
                    }).join('');
                    const colCount = 1 + (showMarks ? 1 : 0) + (showGrades ? 1 : 0);
                    return `
                        <div class="border rounded-xl p-4 mb-4 bg-white shadow-sm">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="font-bold text-gray-900 text-center flex-1">${escapeHtml(stringifyResultLabel(result.examLabel || examLabels[examKey] || examKey, 'Exam'))}</h3>
                                <div class="flex items-center gap-3">
                                    <button class="poster-download-btn text-indigo-700 font-bold" data-exam="${escapeHtml(examKey)}" data-rank="${currentRank}" title="Download Poster"><i class="fas fa-download"></i></button>
                                    <button class="poster-share-btn text-indigo-700 font-bold" data-exam="${escapeHtml(examKey)}" title="Share Poster"><i class="fas fa-share-alt"></i></button>
                                </div>
                            </div>
                            <div class="text-[12px] text-indigo-600 font-bold mb-2 uppercase tracking-wide text-center">Class - ${escapeHtml(result.classLabel || classLabel)}</div>
                            <table class="w-full text-left">
                                <thead><tr class="text-xs uppercase text-gray-500 border-b"><th class="py-2">Subject</th>${showMarks ? '<th class="py-2">Mark</th>' : ''}${showGrades ? '<th class="py-2">Grade</th>' : ''}</tr></thead>
                                <tbody>${tableRows || `<tr><td class="py-2 text-sm text-gray-500" colspan="${colCount}">No subject-wise entries.</td></tr>`}</tbody>
                            </table>
                            <div class="mt-3 grid grid-cols-3 gap-2 text-center">
                                <div class="border rounded-lg p-2 bg-gray-50 text-xs font-bold">Total<br>${escapeHtml(String(result.totals?.obtained ?? '-'))}/${escapeHtml(String(result.totals?.maximum ?? '-'))}</div>
                                <div class="border rounded-lg p-2 bg-gray-50 text-xs font-bold">Rank<br>${currentRank > 0 ? currentRank : '--'}</div>
                                <div class="border rounded-lg p-2 bg-gray-50 text-xs font-bold">Attendance<br>${escapeHtml(String(result.attendance?.presentDays ?? 0))}/${escapeHtml(String(result.attendance?.workingDays ?? 0))}</div>
                            </div>
                            <div class="mt-3 rounded-lg px-4 py-2 text-center font-bold ${result.totals?.passStatus === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                                ${escapeHtml(result.totals?.passStatus || '--')}
                            </div>
                        </div>
                    `;
                });
            container.innerHTML = cards.join('');
            container.querySelectorAll('.poster-download-btn').forEach((button) => {
                button.addEventListener('click', () => {
                    button.classList.add('animate-pulse');
                    const examType = button.dataset.exam;
                    const result = examScopedResults.find((row) => (row.examType || row.examKey) === examType);
                    if (result) downloadRankPoster(result, button.closest('.border.rounded-xl')).catch((error) => console.warn('Download failed', error));
                    setTimeout(() => button.classList.remove('animate-pulse'), 1200);
                });
            });
            container.querySelectorAll('.poster-share-btn').forEach((button) => {
                button.addEventListener('click', async () => {
                    button.classList.add('animate-pulse');
                    const examType = button.dataset.exam;
                    const result = examScopedResults.find((row) => (row.examType || row.examKey) === examType);
                    if (result) {
                        try {
                            await shareRankPoster(result, button.closest('.border.rounded-xl'));
                        } catch (error) {
                            console.warn('Share failed', error);
                        }
                    }
                    setTimeout(() => button.classList.remove('animate-pulse'), 1200);
                });
            });
            } catch (error) {
                console.error('Failed to render student results', error);
                const container = document.getElementById('results-container');
                if (container) container.innerHTML = buildEmptyState({ icon: 'fa-exclamation-triangle', title: 'Unable to load results', message: 'Please refresh and try again.' });
            }
        };
        const saveStudentPhotoSubmission = async () => {};

        const renderStudentFeeDetails = (st, targetYear = '') => {
            const activeYear = targetYear || st?.academicYear || '--';
            const classLabel = resolveAcademicClass(activeYear, st);
            document.getElementById('fee-class-label').textContent = `Class: ${classLabel}`;
            renderAcademicYearSelect('fee-year-select', activeYear);

            let baseFee = defaultFee;
            const hasConcession = st.concessionFee !== undefined && st.concessionFee !== null && st.concessionFee !== "";
            const activeGroup = studentGroups.find(g => g.memberIds.includes(studentId));
            const concGroup = document.getElementById('dash-conc-group');
            if(hasConcession) {
                baseFee = st.concessionFee;
                concGroup?.classList.add('hidden');
            } else {
                concGroup?.classList.add('hidden');
                if(activeGroup && activeGroup.fee > 0) baseFee = activeGroup.fee;
            }

            const currentYearFeeItems = feeItems.filter((item) => (item.academicYear || st.academicYear || '') === activeYear);
            const yearPayments = allPayments.filter((payment) => {
                const item = currentYearFeeItems.find((feeItem) => feeItem.key === payment.itemKey);
                const paymentYear = payment.academicYear || item?.academicYear || '';
                return paymentYear === activeYear;
            });
            const paymentsByItem = new Map(yearPayments.map((payment) => [payment.itemKey, payment]));
            const studentDonationPayments = yearPayments.filter((payment) => payment.itemKey === STUDENT_DONATION_ITEM_KEY);

            const visibleItems = currentYearFeeItems.filter(i => {
                if(i.isVisible === false) return false;
                if(i.type === 'custom' && i.scope === 'specific' && i.targetClass !== classLabel) return false;
                return true;
            });
            if (yearPayments.some((payment) => payment.itemKey === STUDENT_DONATION_ITEM_KEY) && !visibleItems.some((item) => item.key === STUDENT_DONATION_ITEM_KEY)) {
                visibleItems.push({ key: STUDENT_DONATION_ITEM_KEY, name: 'Donation', type: 'custom', scope: 'global' });
            }

            let totalPaidAmount = 0;
            let totalDueAmount = 0;
            let paidItemsCount = 0;
            let dueItemsCount = 0;
            let lastPaymentDate = '';
            const paidInsightItems = [];
            const pendingInsightItems = [];
            const paymentHistoryItems = [];

            const generateFeeCardHtml = (item) => {
                const pay = paymentsByItem.get(item.key);
                const isSpecialOptional = item.key === STUDENT_DONATION_ITEM_KEY;
                const latestDonationPayment = studentDonationPayments
                    .slice()
                    .sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')))[0];
                const donationSummary = isSpecialOptional
                    ? {
                        amount: studentDonationPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
                        paymentDate: latestDonationPayment?.paymentDate || '',
                        receiptNo: studentDonationPayments.length ? `${studentDonationPayments.length} entries` : '',
                        collectedByName: latestDonationPayment?.collectedByName || latestDonationPayment?.collectedBy || 'Admin'
                    }
                    : null;
                let amountToPay = baseFee;
                if(item.type === 'custom') {
                    if(item.scope === 'global') amountToPay = item.amount || 0;
                    else if(item.scope === 'class-wise' && item.classValues) amountToPay = item.classValues[classLabel] || 0;
                    else if(item.scope === 'specific') amountToPay = item.amount || 0;
                }

                const isMonthlyDefault = !item.type || item.type === 'month';
                const cardName = isMonthlyDefault ? formatMonthFeeCardName(item.name) : (item.name || 'Fee Item');
                const referencePaymentDate = donationSummary ? donationSummary.paymentDate : pay?.paymentDate;
                const groupCreatedAtTs = activeGroup?.createdAt ? new Date(activeGroup.createdAt).getTime() : 0;
                const paymentTs = referencePaymentDate ? new Date(referencePaymentDate).getTime() : 0;
                const groupEligible = isMonthlyDefault && Boolean(activeGroup) && (!referencePaymentDate || !groupCreatedAtTs || paymentTs >= groupCreatedAtTs);
                const concessionStartRaw = st?.concessionUpdatedAt || st?.concessionSetAt || st?.concessionAppliedAt || st?.updatedAt || 0;
                const concessionStartTs = Number.isFinite(Number(concessionStartRaw))
                    ? Number(concessionStartRaw)
                    : (concessionStartRaw ? new Date(concessionStartRaw).getTime() : 0);
                const concessionEligible = isMonthlyDefault && hasConcession && (!referencePaymentDate || !concessionStartTs || paymentTs >= concessionStartTs);
                const statusHints = isMonthlyDefault ? [groupEligible ? 'Group' : '', concessionEligible ? 'Concession' : ''].filter(Boolean).join(' • ') : '';
                const groupMembersHtml = (isMonthlyDefault && groupEligible)
                    ? `<div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                        <div class="font-bold uppercase text-[10px] tracking-wide text-slate-500 mb-1">Group Members</div>
                        ${(activeGroup.memberIds || []).map((memberId) => {
                            const member = groupMemberProfileMap[memberId];
                            const memberName = member?.name || memberId;
                            const memberClass = member?.class || classLabel;
                            const isCurrentStudent = memberId === studentId;
                            return `<div class="${isCurrentStudent ? 'font-extrabold text-slate-950' : ''}">${escapeHtml(memberName)} <span class="text-[10px] ${isCurrentStudent ? 'text-slate-700' : 'text-slate-500'}">(${escapeHtml(memberClass)})</span></div>`;
                        }).join('')}
                    </div>`
                    : '';
                const getGroupedMonthlyDisplayAmount = (paymentAmount = 0) => {
                    if (!isMonthlyDefault || !groupEligible) return Number(paymentAmount || 0);
                    if (Number(activeGroup?.fee || 0) > 0) return Number(activeGroup.fee || 0);
                    const memberCount = Math.max(1, Number(activeGroup?.memberIds?.length || 0));
                    return Number(paymentAmount || 0) * memberCount;
                };
                if(pay || donationSummary) {
                    paidItemsCount += 1;
                    const rawPaidAmount = Number(donationSummary ? donationSummary.amount : pay.amount || 0);
                    const paidAmount = donationSummary ? rawPaidAmount : getGroupedMonthlyDisplayAmount(rawPaidAmount);
                    totalPaidAmount += paidAmount;
                    const paymentDate = donationSummary ? donationSummary.paymentDate : pay.paymentDate;
                    const dateStr = formatDateDisplay(paymentDate);
                    if (paymentDate && (!lastPaymentDate || paymentDate > lastPaymentDate)) {
                        lastPaymentDate = paymentDate;
                    }
                    const staffName = donationSummary ? donationSummary.collectedByName : (pay.collectedByName || pay.collectedBy || 'Admin');
                    const receiptNo = donationSummary ? donationSummary.receiptNo : (pay.receiptNo ? String(pay.receiptNo) : 'N/A');
                    const paymentDescription = donationSummary ? '' : String(pay.description || '').trim();
                    const paymentDescriptionHtml = paymentDescription
                        ? `<div class="mb-3 border-b border-gray-100 pb-3"><div class="text-xs text-gray-500 font-bold uppercase tracking-wide mb-1">Description</div><div class="text-sm font-semibold text-gray-800 whitespace-pre-wrap break-words">${escapeHtml(paymentDescription)}</div></div>`
                        : '';
                    const paidInsight = {
                        status: 'paid',
                        academicYear: activeYear,
                        name: item.name || 'Fee Item',
                        amount: paidAmount,
                        paymentDate,
                        meta: `Paid on <b>${escapeHtml(dateStr)}</b> · Receipt: <b>${escapeHtml(receiptNo)}</b>`
                    };
                    paidInsightItems.push(paidInsight);
                    paymentHistoryItems.push({ ...paidInsight, meta: `Paid date: <b>${escapeHtml(dateStr)}</b> · Fee item: <b>${escapeHtml(item.name || 'Fee Item')}</b> · Collected by: <b>${escapeHtml(staffName)}</b>` });
                    return `
                        <div class="fee-card paid" onclick="openFeeDetailModal(this)" role="button" tabindex="0">
                            <div class="fee-status-badge">PAID</div>
                            <div class="fee-month">${escapeHtml(cardName)}</div>
                            <div class="fee-amt">${formatCurrency(paidAmount)}</div>
                            ${statusHints ? `<div class="fee-card-hint">${escapeHtml(statusHints)}</div>` : ''}
                            <div class="fee-details-panel hidden">
                                <div class="fee-modal-priority-row"><span>Academic Year</span><b>${escapeHtml(activeYear)}</b></div>
                                <div class="fee-modal-priority-row"><span>Fee Item</span><b>${escapeHtml(normalizeFeeItemDisplayName(item.name || 'Fee Item'))}</b></div>
                                ${groupMembersHtml}
                                <div class="fee-modal-priority-row amount paid"><span>Amount</span><b>${formatCurrency(paidAmount)}</b></div>
                                <div class="flex justify-between items-center mb-3 border-b border-gray-100 pb-2"><span class="text-xs text-gray-500 font-bold uppercase tracking-wide">Receipt No</span><span class="text-sm font-bold font-mono bg-green-50 text-green-700 px-3 py-1 rounded border border-green-200">${escapeHtml(receiptNo)}</span></div>
                                <div class="flex justify-between items-center mb-3 border-b border-gray-100 pb-2"><span class="text-xs text-gray-500 font-bold uppercase tracking-wide">Date Paid</span><span class="text-sm font-bold text-gray-800">${escapeHtml(dateStr)}</span></div>
                                <div class="flex justify-between items-center mb-3 border-b border-gray-100 pb-2"><span class="text-xs text-gray-500 font-bold uppercase tracking-wide">Class</span><span class="text-sm font-bold text-gray-700">${escapeHtml((pay && pay.classLabel) || classLabel)}</span></div>
                                ${paymentDescriptionHtml}
                                <div class="flex justify-between items-center pt-1"><span class="text-xs text-gray-500 font-bold uppercase tracking-wide flex-shrink-0 mr-4">Collected By</span><span class="text-xs font-bold text-blue-600 text-right w-full whitespace-normal" style="word-break: break-word;">${escapeHtml(staffName)}</span></div>
                            </div>
                        </div>`;
                }

                if (isSpecialOptional) return '';
                dueItemsCount += 1;
                totalDueAmount += parseFloat(amountToPay) || 0;
                pendingInsightItems.push({
                    status: 'pending',
                    academicYear: activeYear,
                    name: item.name || 'Fee Item',
                    amount: amountToPay,
                    meta: `Class: <b>${escapeHtml(classLabel)}</b>`
                });
                const paymentContext = getCollectorPaymentContext(classLabel);
                const duePaymentDetails = paymentContext.details || {};
                const paymentFields = [
                    { label: 'A/C Name', value: duePaymentDetails.accountName || '' },
                    { label: 'UPI Number', value: duePaymentDetails.upiNumber || '' },
                    { label: 'UPI ID', value: duePaymentDetails.upiId || '' }
                ].filter((field) => String(field.value || '').trim() !== '');
                const accountLines = paymentFields.map((field) => `
                    <div class="copy-pay-row">
                        <div><span class="text-gray-500">${escapeHtml(field.label)}:</span> ${escapeHtml(field.value)}</div>
                        <button class="copy-pay-detail-btn" data-copy-value="${encodeURIComponent(String(field.value))}" type="button">Copy</button>
                    </div>
                `).join('');
                return `
                    <div class="fee-card unpaid" onclick="openFeeDetailModal(this)" role="button" tabindex="0">
                        <div class="fee-status-badge">NOT PAID</div>
                        <div class="fee-month">${escapeHtml(cardName)}</div>
                        <div class="fee-amt">${formatCurrency(amountToPay)}</div>
                        ${statusHints ? `<div class="fee-card-hint">${escapeHtml(statusHints)}</div>` : ''}
                        <div class="fee-details-panel hidden">
                            <div class="fee-modal-priority-row"><span>Academic Year</span><b>${escapeHtml(activeYear)}</b></div>
                            <div class="fee-modal-priority-row"><span>Fee Item</span><b>${escapeHtml(normalizeFeeItemDisplayName(item.name || 'Fee Item'))}</b></div>
                            ${groupMembersHtml}
                            <div class="fee-modal-priority-row amount pending"><span>Amount</span><b>${formatCurrency(amountToPay)}</b></div>
                            <div class="text-xs text-gray-500 font-bold uppercase tracking-wide mb-3">Class: ${escapeHtml(classLabel)}</div>
                            <div class="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2 mb-3 font-semibold">Payment Account Owner: ${escapeHtml(paymentContext.ownerLabel)}</div>
                            ${accountLines ? `<div class="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2 mb-3 space-y-1">${accountLines}</div>` : `<div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Payment details are not configured. Please contact office.</div>`}
                        </div>
                    </div>`;
            };

            const monthlyItems = sortMonthlyItemsByAcademicYear(
                visibleItems.filter(i => !i.type || i.type === 'month'),
                activeYear
            );
            const donationItems = visibleItems.filter((item) => item.key === STUDENT_DONATION_ITEM_KEY);
            const otherItems = visibleItems.filter(i => i.type === 'custom' && i.key !== STUDENT_DONATION_ITEM_KEY);
            let sectionsHtml = '';
            if(monthlyItems.length > 0) {
                sectionsHtml += `<h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mt-2 mb-3 border-b border-gray-200 pb-1">Monthly Fees</h3>`;
                sectionsHtml += `<div class="fee-grid">` + monthlyItems.map(generateFeeCardHtml).join('') + `</div>`;
            }
            if(otherItems.length > 0) {
                sectionsHtml += `<h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mt-6 mb-3 border-b border-gray-200 pb-1">Other Fees</h3>`;
                sectionsHtml += `<div class="fee-grid">` + otherItems.map(generateFeeCardHtml).join('') + `</div>`;
            }
            if(donationItems.length > 0) {
                sectionsHtml += `<h3 class="text-xs font-bold text-emerald-600 uppercase tracking-widest mt-6 mb-3 border-b border-emerald-100 pb-1">Donation</h3>`;
                sectionsHtml += `<div class="fee-grid">` + donationItems.map(generateFeeCardHtml).join('') + `</div>`;
            }
            document.getElementById('fee-sections-container').innerHTML = sectionsHtml || buildEmptyState('No visible fee items are configured for this academic year.', 'fa-receipt');

            document.getElementById('fee-summary').innerHTML = `
                <div class="mt-6 border-t border-gray-200 pt-5"><div class="grid grid-cols-2 gap-4">
                    <div class="bg-green-50 border border-green-200 p-4 rounded-xl flex flex-col justify-center items-center shadow-sm"><span class="text-[11px] text-green-700 font-bold uppercase tracking-widest mb-1 text-center">Total Paid</span><span class="text-xl font-bold font-mono text-green-700">${formatCurrency(totalPaidAmount)}</span></div>
                    <div class="bg-red-50 border border-red-200 p-4 rounded-xl flex flex-col justify-center items-center shadow-sm"><span class="text-[11px] text-red-700 font-bold uppercase tracking-widest mb-1 text-center">Total Due</span><span class="text-xl font-bold font-mono text-red-700">${formatCurrency(totalDueAmount)}</span></div>
                </div></div>
            `;
            const progressPct = (paidItemsCount + dueItemsCount ? Math.round((paidItemsCount / (paidItemsCount + dueItemsCount)) * 100) : 0);
            latestFeeInsightState.paid = paidInsightItems;
            latestFeeInsightState.pending = pendingInsightItems;
            latestFeeInsightState.payments = paymentHistoryItems
                .slice()
                .sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')));
            document.getElementById('fee-status-insights').innerHTML = `
                <div class="insight-grid">
                    <div class="insight-card success cursor-pointer" onclick="openFeeInsightModal('paid')"><div class="insight-label">Paid Items</div><div class="insight-value">${paidItemsCount}</div><div class="insight-subvalue">Completed fee entries</div></div>
                    <div class="insight-card danger cursor-pointer" onclick="openFeeInsightModal('pending')"><div class="insight-label">Pending Items</div><div class="insight-value">${dueItemsCount}</div><div class="insight-subvalue">Items still unpaid</div></div>
                    <div class="insight-card info"><div class="insight-label">Payment Progress</div><div class="insight-value">${progressPct}%</div><div class="insight-subvalue">${paidItemsCount} of ${paidItemsCount + dueItemsCount} items settled</div><div class="fee-progress-track mt-3"><div class="fee-progress-fill" style="width: ${progressPct}%"></div></div></div>
                    <div class="insight-card warning cursor-pointer" onclick="openFeeInsightModal('last')"><div class="insight-label">Last Payment</div><div class="insight-value">${lastPaymentDate ? formatDateDisplay(lastPaymentDate) : '--'}</div><div class="insight-subvalue">${lastPaymentDate ? 'Tap to view date-wise list' : 'No payment recorded yet'}</div></div>
                </div>
            `;

            rawFeeAlerts = buildFeeNotificationAlerts(st);
            rawResultAlerts = buildResultNotificationAlerts(st, studentResultsCache);
            if (window.triggerNotificationUpdate) window.triggerNotificationUpdate();
        };

        async function loadDashboardData() {
            try {
                // Notif Listeners
                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), snap => {
                    rawNotices = snap.exists() && Array.isArray(snap.data().notices) ? snap.data().notices : [];
                    if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();
                });

                onSnapshot(collection(db, `${BASE_PATH}/systemNotifications`), snap => {
                    rawSysNotifs = snap.docs.map(d => ({id: d.id, ...d.data()}));
                    if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();
                });

                onSnapshot(doc(db, `${BASE_PATH}/studentNotificationState`, studentId), snap => {
                    if(snap.exists()) {
                        const data = snap.data();
                        notifState.lastMarkedAllReadAt = data.lastMarkedAllReadAt || 0;
                        notifState.readIds = data.readIds || [];
                    }
                    if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();
                });

                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'config'), snap => {
                    const conf = snap.exists() ? snap.data() : {};
                    
                    applyInstitutionBranding(conf, {
                        defaultAppName: 'Student Dashboard',
                        primaryTitleIds: ['id-school-name'],
                        subtitleIds: ['id-school-sub'],
                        logoIds: ['header-logo', 'splash-logo-img'],
                        updateDocumentTitle: true,
                        documentTitleSuffix: 'Student Dashboard'
                    });
                    setTimeout(() => { fitText('header-title'); }, 50);
                    renderVersionInfo();
                    defaultFee = conf.defaultFee || 200;
                    feeItems = conf.feeItems || [];
                    paymentDetails = {
                        accountName: conf.paymentAccountName || '',
                        upiNumber: conf.paymentUpiNumber || '',
                        upiId: conf.paymentUpiId || '',
                    };
                });

                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'sessionControl'), (sessionSnap) => {
                    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};
                    const startedAt = window.AppSession?.getStartedAt?.() || 0;
                    const forcedAt = sessionData?.lastForcedLogoutAt ? new Date(sessionData.lastForcedLogoutAt).getTime() : 0;
                    if (forcedAt && startedAt && forcedAt > startedAt) {
                        alert(sessionData.message || 'An administrator ended this session. Please sign in again.');
                        logoutStudent();
                    }
                });
                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'academicYears'), (academicYearSnap) => {
                    const academicData = academicYearSnap.exists() ? academicYearSnap.data() : {};
                    academicYearSettings = Array.isArray(academicData.years) ? academicData.years : [];
                    currentAcademicYear = academicData.currentYear || currentAcademicYear || '';
                    if (studentProfile && selectedFeeAcademicYear) {
                        availableAcademicYears = buildAvailableAcademicYears(studentProfile, allPayments, studentResultsCache);
                        if (!availableAcademicYears.includes(selectedFeeAcademicYear)) {
                            selectedFeeAcademicYear = (currentAcademicYear && availableAcademicYears.includes(currentAcademicYear))
                                ? currentAcademicYear
                                : availableAcademicYears[0];
                        }
                        if (!availableAcademicYears.includes(selectedResultAcademicYear)) {
                            selectedResultAcademicYear = (currentAcademicYear && availableAcademicYears.includes(currentAcademicYear))
                                ? currentAcademicYear
                                : availableAcademicYears[0];
                        }
                        renderStudentFeeDetails(studentProfile, selectedFeeAcademicYear);
                        renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                    }
                });

                const grpSnap = await getDocs(collection(db, `${BASE_PATH}/studentGroups`));
                studentGroups = grpSnap.docs.map(d => ({id: d.id, ...d.data()}));

                const stuSnap = await getDoc(doc(db, `${BASE_PATH}/students`, studentId));
                if (!stuSnap.exists()) { alert("Student profile not found."); logoutStudent(); return; }
                const st = stuSnap.data();
                const activeGroup = studentGroups.find((group) => group.memberIds?.includes(studentId));
                if (activeGroup?.memberIds?.length) {
                    const memberDocs = await Promise.all(activeGroup.memberIds.map((memberId) => getDoc(doc(db, `${BASE_PATH}/students`, memberId))));
                    groupMemberProfileMap = memberDocs.reduce((acc, memberDoc, idx) => {
                        if (memberDoc.exists()) acc[activeGroup.memberIds[idx]] = memberDoc.data();
                        return acc;
                    }, {});
                } else {
                    groupMemberProfileMap = {};
                }

                const [resultSchemaSnap, resultsSnap, staffSnap] = await Promise.all([
                    getDocs(collection(db, `${BASE_PATH}/resultSchemas`)),
                    getDocs(query(collection(db, `${BASE_PATH}/examResults`), where('studentId', '==', studentId))),
                    getDocs(collection(db, `${BASE_PATH}/staff`))
                ]);
                const resultCenterSnap = await getDoc(doc(db, `${BASE_PATH}/settings`, 'resultCenter'));
                resultCenterSettings = resultCenterSnap.exists() ? { blockedClasses: [], ...resultCenterSnap.data() } : { locked: false, blockedClasses: [] };
                onSnapshot(doc(db, `${BASE_PATH}/settings`, 'resultCenter'), (snap) => {
                    resultCenterSettings = snap.exists() ? { blockedClasses: [], ...snap.data() } : { locked: false, blockedClasses: [] };
                    if (studentProfile) {
                        renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                        rawResultAlerts = buildResultNotificationAlerts(studentProfile, studentResultsCache);
                        if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();
                    }
                });
                try {
                    const photoSubmissionSnap = await getDoc(doc(db, `${BASE_PATH}/studentPhotoSubmissions`, studentId));
                    studentPhotoSubmission = photoSubmissionSnap.exists() ? photoSubmissionSnap.data() : {};
                } catch (photoError) {
                    console.warn('Unable to load student photo submission state.', photoError);
                    studentPhotoSubmission = {};
                }
                resultSchemas = resultSchemaSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                allStaff = staffSnap.docs.map((d) => d.data());
                const studentResults = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((item) => item.published !== false);
                
                document.getElementById('dash-name').textContent = st.name;
                document.getElementById('dash-class').textContent = `Class: ${st.class || '-'}`;
                document.getElementById('dash-adm').textContent = st.adm || '-';
                document.getElementById('dash-uid').textContent = st.uid || '-';
                document.getElementById('dash-gender').textContent = st.gender || '-';
                document.getElementById('dash-father').textContent = st.father || '-';
                document.getElementById('dash-mobile').textContent = st.mobile || '-';
                document.getElementById('dash-addr').textContent = st.address || '-';
                
                if(st.name) document.getElementById('dash-avatar').textContent = st.name.charAt(0).toUpperCase();
                const paySnap = await getDocs(query(collection(db, `${BASE_PATH}/payments`), where('studentId', '==', studentId)));
                allPayments = paySnap.docs.map(d=>d.data());

                studentProfile = st;
                studentResultsCache = studentResults;
                classByYear[st.academicYear || '--'] = st.class || '--';
                studentResults.forEach((result) => {
                    if (result.academicYear && result.classLabel) classByYear[result.academicYear] = result.classLabel;
                });
                allPayments.forEach((payment) => {
                    if (payment.academicYear && (payment.classLabel || payment.class)) classByYear[payment.academicYear] = payment.classLabel || payment.class;
                });

                availableAcademicYears = buildAvailableAcademicYears(st, allPayments, studentResults);
                selectedFeeAcademicYear = (currentAcademicYear && availableAcademicYears.includes(currentAcademicYear))
                    ? currentAcademicYear
                    : availableAcademicYears[0];
                selectedResultAcademicYear = selectedFeeAcademicYear;

                document.getElementById('fee-year-select')?.addEventListener('change', (event) => {
                    selectedFeeAcademicYear = event.target.value;
                    renderStudentFeeDetails(studentProfile, selectedFeeAcademicYear);
                });
                document.getElementById('results-year-select')?.addEventListener('change', (event) => {
                    selectedResultAcademicYear = event.target.value;
                    renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                });
                document.getElementById('results-exam-select')?.addEventListener('change', () => {
                    renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                });

                renderStudentFeeDetails(studentProfile, selectedFeeAcademicYear);
                renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                syncResultTabVisibility(studentResultsCache.length > 0);
                rawResultAlerts = buildResultNotificationAlerts(studentProfile, studentResultsCache);
                if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();

                onSnapshot(query(collection(db, `${BASE_PATH}/examResults`), where('studentId', '==', studentId)), (snap) => {
                    studentResultsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((item) => item.published !== false);
                    availableAcademicYears = buildAvailableAcademicYears(studentProfile, allPayments, studentResultsCache);
                    renderStudentResults(studentProfile, studentResultsCache, selectedResultAcademicYear);
                    syncResultTabVisibility(studentResultsCache.length > 0);
                    rawResultAlerts = buildResultNotificationAlerts(studentProfile, studentResultsCache);
                    if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();
                });

                // Clean White Screen logic (Fade out instantly)
                const loader = document.getElementById('loading-screen');
                loader.style.opacity = '0';
                setTimeout(() => { loader.style.display = 'none'; }, 300);

            } catch (error) {
                console.error("Error loading dashboard:", error);
                alert("An error occurred. Please try again.");
                const loader = document.getElementById('loading-screen');
                if (loader) loader.style.display = 'none';
            }
        }

        onAuthStateChanged(auth, user => { if(user) { loadDashboardData(); } });
        window.AppSession?.touchSession();
        signInAnonymously(auth);

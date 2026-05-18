import { signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, onSnapshot, collection, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth } from '../../config/firebase-config.js';
import { ADMIN_AUTH_DOC_ID, SINGLE_ADMIN_MODE } from '../../config/app-config.js';
import { BASE_PATH, applyInstitutionBranding, escapeHtml, hardenExternalLinks, normalizePhone, registerServiceWorker, renderVersionInfo, sanitizePhone, sanitizeUrl } from '../shared/app-common.js';

        hardenExternalLinks();

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

        document.querySelectorAll('.nav-link').forEach(link => { 
            link.addEventListener('click', () => { 
                setMobileMenuState(false);
            }); 
        });

        const loginMessageEl = document.getElementById('login-msg');
        const showLoginMessage = (message) => {
            if (!loginMessageEl) return;
            if (!message) {
                loginMessageEl.textContent = '';
                loginMessageEl.style.display = 'none';
                return;
            }
            loginMessageEl.textContent = message;
            loginMessageEl.style.display = 'block';
        };

        const renderSavedStudents = () => {
            const list = document.getElementById('saved-student-list');
            const accounts = window.AppSession?.getStudentAccounts?.() || [];
            if (!list) return;
            list.innerHTML = accounts.length ? accounts.map((account) => `
                <div class="border border-gray-200 rounded-lg p-2 flex items-center justify-between gap-2">
                    <button class="text-left flex-grow saved-student-select" data-id="${account.studentId}">
                        <div class="font-bold text-gray-800">${escapeHtml(account.name || 'Student')}</div>
                        <div class="text-xs text-gray-500">${escapeHtml(account.class || '--')} • Adm: ${escapeHtml(account.adm || '--')}</div>
                    </button>
                    <button class="text-red-600 text-xs font-bold saved-student-remove" data-id="${account.studentId}">Remove</button>
                </div>
            `).join('') : '<p class="text-sm text-gray-500">No saved student accounts.</p>';
        };
        const openSavedStudentModal = () => {
            renderSavedStudents();
            document.getElementById('saved-student-modal').style.display = 'flex';
        };
        const openStudentLoginModal = () => {
            document.getElementById('login-modal').style.display = 'flex'; 
            setMobileMenuState(false);
            showLoginMessage('');
            const sessionNotice = window.AppSession?.consumeFlash?.();
            if (sessionNotice) showLoginMessage(sessionNotice);
        };
        window.openLogin = () => {
            const accounts = window.AppSession?.getStudentAccounts?.() || [];
            const forceAdd = new URLSearchParams(window.location.search).get('addStudent') === '1';
            if (!forceAdd && accounts.length > 0) {
                openSavedStudentModal();
                return;
            }
            openStudentLoginModal();
        }

        const setAccordionState = (accordionId = '', open = false) => {
            const content = document.getElementById(accordionId);
            if (!content) return;
            content.classList.toggle('hidden', !open);
            const icon = document.querySelector(`[data-accordion-icon="${accordionId}"]`);
            icon?.classList.toggle('fa-chevron-down', !open);
            icon?.classList.toggle('fa-chevron-up', open);
        };
        window.togglePublicAccordion = (accordionId = '') => {
            const content = document.getElementById(accordionId);
            if (!content) return;
            setAccordionState(accordionId, content.classList.contains('hidden'));
        };
        const expandAccordionForTarget = (targetId = '') => {
            if (targetId === 'management-container') setAccordionState('management-accordion', true);
            const target = document.getElementById(targetId);
            const accordionContent = target?.querySelector?.('[data-accordion-content]');
            if (accordionContent?.id) setAccordionState(accordionContent.id, true);
        };
        window.smoothScrollTo = (e, targetId) => {
            e.preventDefault();
            expandAccordionForTarget(targetId);
            const target = document.getElementById(targetId);
            if(target) window.scrollTo({ top: target.getBoundingClientRect().top + window.pageYOffset - 90, behavior: "smooth" });
        };
        
        let galleryUrls = [];
        let currentGalleryIndex = -1;
        let galleryTouchStartX = 0;

        const closePersonModal = () => {
            const modal = document.getElementById('person-modal');
            if (modal) modal.style.display = 'none';
        };

        window.openPersonModal = (name, role, phone, img, address) => {
            document.getElementById('modal-name').textContent = name;
            document.getElementById('modal-role').textContent = role;
            const modalPhone = document.getElementById('modal-phone');
            const whatsappBtn = document.getElementById('modal-whatsapp-btn');
            modalPhone.textContent = '';
            if (phone) {
                const normalizedPhone = sanitizePhone(phone);
                const phoneLink = document.createElement('a');
                phoneLink.href = `tel:${normalizedPhone}`;
                phoneLink.style.color = 'inherit';
                phoneLink.textContent = phone;
                modalPhone.appendChild(phoneLink);
                if (whatsappBtn && normalizedPhone) {
                    whatsappBtn.href = `https://wa.me/${encodeURIComponent(normalizedPhone)}?text=${encodeURIComponent('Assalamu Alaikum')}`;
                    whatsappBtn.style.display = 'inline-flex';
                } else if (whatsappBtn) {
                    whatsappBtn.style.display = 'none';
                }
            } else {
                modalPhone.textContent = 'Not Available';
                if (whatsappBtn) whatsappBtn.style.display = 'none';
            }
            document.getElementById('modal-address').textContent = address || 'Not Available';
            document.getElementById('modal-img').src = sanitizeUrl(img) || 'https://via.placeholder.com/150?text=User';
            document.getElementById('person-modal').style.display = 'flex';
        };

        document.getElementById('person-modal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) closePersonModal();
        });

        const setGalleryImage = (index = 0) => {
            if (!galleryUrls.length) return;
            currentGalleryIndex = (index + galleryUrls.length) % galleryUrls.length;
            document.getElementById('zoom-img').src = galleryUrls[currentGalleryIndex];
        };

        const closeImageModal = () => {
            const modal = document.getElementById('img-modal');
            if (!modal) return;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            currentGalleryIndex = -1;
        };

        const openImageModal = (url, index = -1) => {
            const safeUrl = sanitizeUrl(url);
            if (!safeUrl) return;
            const resolvedIndex = index >= 0 ? index : galleryUrls.indexOf(safeUrl);
            if (!galleryUrls.includes(safeUrl)) galleryUrls = [safeUrl];
            setGalleryImage(resolvedIndex >= 0 ? resolvedIndex : 0);
            const modal = document.getElementById('img-modal');
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
        };

        document.getElementById('img-modal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) closeImageModal();
        });
        document.getElementById('gallery-prev-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            setGalleryImage(currentGalleryIndex - 1);
        });
        document.getElementById('gallery-next-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            setGalleryImage(currentGalleryIndex + 1);
        });
        document.getElementById('zoom-img')?.addEventListener('click', (event) => event.stopPropagation());
        document.getElementById('img-modal')?.addEventListener('touchstart', (event) => {
            galleryTouchStartX = event.changedTouches?.[0]?.clientX || 0;
        }, { passive: true });
        document.getElementById('img-modal')?.addEventListener('touchend', (event) => {
            const endX = event.changedTouches?.[0]?.clientX || 0;
            const deltaX = endX - galleryTouchStartX;
            if (Math.abs(deltaX) < 45) return;
            setGalleryImage(currentGalleryIndex + (deltaX < 0 ? 1 : -1));
        }, { passive: true });

        function togglePassword(inputId, iconId) {
            const input = document.getElementById(inputId);
            const icon = document.getElementById(iconId);
            if (input.type === "password") {
                input.type = "text";
                icon.classList.remove("fa-eye");
                icon.classList.add("fa-eye-slash");
                icon.style.color = "#3b82f6";
            } else {
                input.type = "password";
                icon.classList.remove("fa-eye-slash");
                icon.classList.add("fa-eye");
                icon.style.color = "#94a3b8";
            }
        }
        document.getElementById('toggle-student-pass').addEventListener('click', () => togglePassword('login-phone', 'toggle-student-pass'));
        document.getElementById('saved-student-add-btn')?.addEventListener('click', () => {
            document.getElementById('saved-student-modal').style.display = 'none';
            openStudentLoginModal();
        });
        document.getElementById('saved-student-list')?.addEventListener('click', (e) => {
            const selectBtn = e.target.closest('.saved-student-select');
            const removeBtn = e.target.closest('.saved-student-remove');
            if (selectBtn) {
                const switched = window.AppSession?.switchStudent?.(selectBtn.dataset.id);
                if (switched) window.location.href = 'student.html';
            }
            if (removeBtn) {
                if (!confirm('ഈ account remove ചെയ്യട്ടേ?')) return;
                window.AppSession?.logoutStudent(removeBtn.dataset.id, { removeAccount: true });
                renderSavedStudents();
            }
        });

        function fitHeroTitle() {
            const el = document.getElementById('hero-main-title');
            if(!el) return;
            el.style.fontSize = '';
        }
        window.addEventListener('resize', fitHeroTitle);

        let deferredPrompt;
        const installContainer = document.getElementById('install-app-container');
        const installBtn = document.getElementById('install-app-btn');

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            installContainer.classList.remove('hidden');
        });

        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                }
                deferredPrompt = null;
                installContainer.classList.add('hidden');
            }
        });

        window.addEventListener('appinstalled', () => {
            installContainer.classList.add('hidden');
            deferredPrompt = null;
        });

        registerServiceWorker();
        let allStudents = [], selectedLoginStudent = null;
        let directoryCategories = [];
        let directoryEntries = [];
        let categoryAuthConfig = { categories: {} };
        let pageAccessConfig = { categories: {}, overrides: {} };
        const normalizeCategoryAuthItem = (raw = {}) => ({
            enabled: raw?.enabled === true,
            mode: raw?.mode === 'mapped' ? 'mapped' : 'manual',
            targetPage: raw?.targetPage === 'student' ? 'student' : 'collection'
        });
        const normalizeCategoryPageAccess = (raw = {}) => ({
            collection: raw?.collection === true,
            student: raw?.student === true
        });
        const hashCredentialValue = async (rawValue = '') => {
            const value = String(rawValue || '');
            if (!value) return '';
            if (!(window.crypto?.subtle)) return value;
            const encoded = new TextEncoder().encode(value);
            const digest = await window.crypto.subtle.digest('SHA-256', encoded);
            return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const resolveDirectoryLogin = async (usernameInput = '', passwordInput = '') => {
            const username = String(usernameInput || '').trim().toLowerCase();
            const passwordHash = await hashCredentialValue(passwordInput);
            if (!username || !passwordHash) return null;
            for (const entry of (Array.isArray(directoryEntries) ? directoryEntries : [])) {
                if (!entry?.categoryId) continue;
                const authConfig = normalizeCategoryAuthItem(categoryAuthConfig?.categories?.[entry.categoryId] || {});
                if (!authConfig.enabled) continue;
                const authMeta = entry?.authMeta && typeof entry.authMeta === 'object' ? entry.authMeta : {};
                if ((String(authMeta.username || '').toLowerCase() || '') !== username) continue;
                if ((String(authMeta.passwordHash || '') || '') !== passwordHash) continue;

                const categoryAccess = normalizeCategoryPageAccess(pageAccessConfig?.categories?.[entry.categoryId] || {});
                const override = pageAccessConfig?.overrides?.[entry.id] || {};
                if (override?.blocked === true) return { blocked: true };
                const access = {
                    collection: (override?.collection === true) || (override?.collection !== false && categoryAccess.collection === true),
                    student: (override?.student === true) || (override?.student !== false && categoryAccess.student === true),
                    source: 'directory',
                    categoryId: entry.categoryId,
                    entryId: entry.id
                };
                return {
                    blocked: false,
                    targetPage: authConfig.targetPage,
                    access,
                    entry
                };
            }
            return null;
        };
        let loaded = { config: false, content: false, students: false, staff: false };
        let minTimeOver = false;
        let splashHidden = false; 

        setTimeout(() => { minTimeOver = true; triggerAnim(); }, 800); 
        setTimeout(() => { forceHideSplash(); }, 3000); 

        function forceHideSplash() {
            if(splashHidden) return;
            splashHidden = true;
            const splash = document.getElementById('splash-screen');
            if(splash && splash.style.display !== 'none') {
                splash.style.opacity = '0';
                const hero = document.querySelector('.hero');
                if(hero) hero.classList.add('animate-active');
                setTimeout(() => splash.style.display = 'none', 500);
            }
        }

        function triggerAnim() {
            if (minTimeOver && loaded.config && loaded.content && loaded.staff && !splashHidden) {
                forceHideSplash();
            }
        }

        const noticeModal = document.getElementById('notice-modal');
        const noticeModalTitle = document.getElementById('notice-modal-title');
        const noticeModalDate = document.getElementById('notice-modal-date');
        const noticeModalBody = document.getElementById('notice-modal-body');
        const closeNoticeModalBtn = document.getElementById('close-notice-modal');
        const noticeListEl = document.getElementById('notices-list');
        let latestNoticeCache = [];

        const closeNoticeModal = () => {
            if (!noticeModal) return;
            noticeModal.style.display = 'none';
            noticeModal.setAttribute('aria-hidden', 'true');
        };

        closeNoticeModalBtn?.addEventListener('click', closeNoticeModal);
        noticeModal?.addEventListener('click', (event) => {
            if (event.target === noticeModal) closeNoticeModal();
        });

        const renderNoticeTextWithLinks = (rawText = '', linkLabelLength = 25) => {
            const text = String(rawText || '');
            const urlPattern = /(https?:\/\/[^\s]+)/gi;
            let cursor = 0;
            let html = '';
            text.replace(urlPattern, (url, _unused, offset) => {
                const leading = text.slice(cursor, offset);
                html += escapeHtml(leading);
                const safeHref = sanitizeUrl(url, ['https:', 'http:']);
                if (safeHref) {
                    const shortLabel = url.length > linkLabelLength
                        ? `${url.slice(0, linkLabelLength)}...`
                        : url;
                    html += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline break-all">${escapeHtml(shortLabel)}</a>`;
                } else {
                    html += escapeHtml(url);
                }
                cursor = offset + url.length;
                return url;
            });
            html += escapeHtml(text.slice(cursor));
            return html.replace(/\n/g, '<br>');
        };
        const renderDynamicDirectory = () => {
            const container = document.getElementById('dynamic-directory-container');
            const sectionsEl = document.getElementById('dynamic-directory-sections');
            const navDynamicLinks = document.getElementById('nav-dynamic-directory-links');
            if (!container || !sectionsEl) return;
            const visibleCategories = (Array.isArray(directoryCategories) ? directoryCategories : [])
                .filter((category) => category?.showPublic !== false)
                .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
            if (!visibleCategories.length) {
                container.classList.add('hidden');
                if (navDynamicLinks) {
                    navDynamicLinks.classList.add('hidden');
                    navDynamicLinks.innerHTML = '';
                }
                return;
            }
            container.classList.remove('hidden');
            if (navDynamicLinks) {
                navDynamicLinks.classList.remove('hidden');
                navDynamicLinks.innerHTML = `<ul class="space-y-1">${visibleCategories.map((category) => {
                    const sectionId = `directory-category-${category.id}`;
                    return `<li><a href="#${escapeHtml(sectionId)}" class="nav-link" onclick="smoothScrollTo(event, '${escapeHtml(sectionId)}')">${escapeHtml(category.name || 'Category')}</a></li>`;
                }).join('')}</ul>`;
            }
            sectionsEl.innerHTML = visibleCategories.map((category) => {
                const fields = (Array.isArray(category.fields) ? category.fields : []).sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0));
                const rows = directoryEntries
                    .filter((entry) => entry.categoryId === category.id)
                    .sort((a, b) => {
                        const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
                        if (orderDiff !== 0) return orderDiff;
                        return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
                    });
                const sectionId = `directory-category-${category.id}`;
                const accordionId = `accordion-${category.id}`;
                if (!rows.length) return `<div id="${escapeHtml(sectionId)}" class="container">
                    <div class="section-header">
                        <button type="button" class="accordion-heading-btn section-heading-pill" onclick="window.togglePublicAccordion('${escapeHtml(accordionId)}')">
                            <span>${escapeHtml(category.name || 'Category')}</span>
                            <i class="fas fa-chevron-down text-sm" data-accordion-icon="${escapeHtml(accordionId)}"></i>
                        </button>
                        <div></div>
                    </div>
                    <div id="${escapeHtml(accordionId)}" data-accordion-content class="hidden mt-3"><div class="about-box"><p class="text-sm text-gray-500 italic">No entries yet.</p></div></div>
                </div>`;
                return `<div id="${escapeHtml(sectionId)}" class="container">
                    <div class="section-header">
                        <button type="button" class="accordion-heading-btn section-heading-pill" onclick="window.togglePublicAccordion('${escapeHtml(accordionId)}')">
                            <span>${escapeHtml(category.name || 'Category')}</span>
                            <i class="fas fa-chevron-down text-sm" data-accordion-icon="${escapeHtml(accordionId)}"></i>
                        </button>
                        <div></div>
                    </div>
                    <div id="${escapeHtml(accordionId)}" data-accordion-content class="hidden mt-3"><div class="scroll-wrapper">${rows.map((entry) => {
                        const values = entry.values || {};
                        const nameValue = String(values.name || values.Name || values.title || 'Profile');
                        const photoValue = sanitizeUrl(values.photo || values.Photo || values.image || values.img) || 'https://via.placeholder.com/150?text=User';
                        const phoneValue = String(values.phone || values.mobile || values.contact || '');
                        const addressValue = String(values.address || values.place || '');
                        const roleField = fields.find((field) => !['name', 'role', 'photo', 'phone', 'address'].includes(String(field.key || '').toLowerCase()));
                        const roleValue = String(values.role || (roleField ? (values[roleField.key] || '') : '')).trim();
                        return `<button type="button" class="person-card" data-person-name="${escapeHtml(nameValue)}" data-person-role="${escapeHtml(roleValue || 'Role not added')}" data-person-phone="${escapeHtml(phoneValue)}" data-person-img="${escapeHtml(photoValue)}" data-person-address="${escapeHtml(addressValue)}">
                            <img src="${photoValue}" class="person-img" alt="${escapeHtml(nameValue)}">
                            <div class="person-name">${escapeHtml(nameValue)}</div>
                            <div class="person-role">${escapeHtml(roleValue || 'Role not added')}</div>
                        </button>`;
                    }).join('')}</div></div>
                </div>`;
            }).join('');
        };

        const deriveNoticeHeading = (notice = {}, index = 0) => {
            const directHeading = notice.heading || notice.title;
            if (directHeading && String(directHeading).trim()) return String(directHeading).trim();
            const baseText = String(notice.text || '').trim();
            if (!baseText) return `Notification ${index + 1}`;
            const firstLine = baseText.split('\n').map((line) => line.trim()).find(Boolean) || '';
            const firstSentence = firstLine.split(/[.!?]/).map((part) => part.trim()).find(Boolean) || '';
            const compact = firstSentence || firstLine || baseText;
            return compact.length > 70 ? `${compact.slice(0, 70)}...` : compact;
        };

        const isNoticeLong = (text = '') => String(text || '').length > 260 || String(text || '').split('\n').length > 5;

        const openNoticeModal = (noticeIndex) => {
            const selected = latestNoticeCache[noticeIndex];
            if (!selected || !noticeModal || !noticeModalBody) return;
            noticeModalTitle.textContent = selected.heading;
            noticeModalDate.textContent = selected.date ? `Posted: ${selected.date}` : 'Posted date unavailable';
            noticeModalBody.innerHTML = renderNoticeTextWithLinks(selected.text, 25);
            noticeModal.style.display = 'flex';
            noticeModal.setAttribute('aria-hidden', 'false');
        };

        noticeListEl?.addEventListener('click', (event) => {
            const expandButton = event.target.closest('.notice-expand-btn');
            if (!expandButton) return;
            const noticeIndex = Number(expandButton.dataset.noticeIndex);
            if (Number.isNaN(noticeIndex)) return;
            openNoticeModal(noticeIndex);
        });

        const fitNoticeViewportForFourCards = () => {
            if (!noticeListEl) return;
            const cards = Array.from(noticeListEl.querySelectorAll('.notice-card'));
            if (!cards.length) {
                noticeListEl.style.maxHeight = '';
                return;
            }
            const visibleCards = cards.slice(0, 4);
            const totalHeight = visibleCards.reduce((sum, card) => sum + card.offsetHeight, 0);
            const gaps = Math.max(0, visibleCards.length - 1) * 12;
            noticeListEl.style.maxHeight = `${totalHeight + gaps + 8}px`;
        };
        window.addEventListener('resize', fitNoticeViewportForFourCards);

        async function init() {
            onAuthStateChanged(auth, user => {
                if(user) {
                    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'config'), snap => {
                        const conf = snap.exists() ? snap.data() : {};
                        
                        applyInstitutionBranding(conf, {
                            defaultAppName: 'Institution',
                            primaryTitleIds: ['hero-main-title'],
                            subtitleIds: ['hero-subtitle'],
                            logoIds: ['splash-logo-img', 'hero-logo-img', 'header-logo']
                        });

                        setTimeout(() => { fitHeroTitle(); }, 50);

                        if(conf.logoUrl) {
                            document.getElementById('splash-logo-img').src = conf.logoUrl;
                            document.getElementById('hero-logo-img').src = conf.logoUrl;
                            document.getElementById('header-logo').src = conf.logoUrl;
                            document.getElementById('header-logo').style.opacity = '1';
                        }
                        
                        renderVersionInfo();
                        loaded.config = true; triggerAnim();
                    });

                    // Array validation logic for notices & gallery fixed
                    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'content'), snap => {
                        const content = snap.exists() ? snap.data() : {};
                        directoryCategories = Array.isArray(content.directoryCategories) ? content.directoryCategories : [];
                        const aboutDescEl = document.getElementById('about-desc');
                        if (aboutDescEl) {
                            aboutDescEl.innerHTML = renderNoticeTextWithLinks(content.description || 'Welcome to our institution.', 25);
                        }
                        
                        // Notices Display Logic
                        const notices = Array.isArray(content.notices) ? content.notices : [];
                        const noticesCont = document.getElementById('notices-container');
                        const navNoticesLink = document.getElementById('nav-notices-link');
                        const heroBtnNotice = document.getElementById('hero-btn-notice');
                        
                        if (notices.length === 0) {
                            noticesCont.classList.add('hidden');
                            if(navNoticesLink) navNoticesLink.classList.add('hidden');
                            if(heroBtnNotice) heroBtnNotice.classList.add('hidden');
                        } else {
                            noticesCont.classList.remove('hidden');
                            if(navNoticesLink) navNoticesLink.classList.remove('hidden');
                            if(heroBtnNotice) heroBtnNotice.classList.remove('hidden');
                            
                            const sortedNotices = notices
                                .map((notice, originalIndex) => ({ notice, originalIndex }))
                                .sort((a, b) => {
                                    const pinWeight = Number(b.notice?.pinned === true) - Number(a.notice?.pinned === true);
                                    if (pinWeight !== 0) return pinWeight;
                                    const dateA = new Date(a.notice?.date || 0).getTime() || 0;
                                    const dateB = new Date(b.notice?.date || 0).getTime() || 0;
                                    if (dateA !== dateB) return dateB - dateA;
                                    return b.originalIndex - a.originalIndex;
                                })
                                .map((entry) => entry.notice);

                            latestNoticeCache = sortedNotices.map((notice, index) => {
                                const text = String(notice?.text || '');
                                return {
                                    heading: deriveNoticeHeading(notice, index),
                                    text,
                                    date: String(notice?.date || ''),
                                    pinned: notice?.pinned === true
                                };
                            });

                            noticeListEl.innerHTML = latestNoticeCache.map((notice, index) => {
                                const longNotice = isNoticeLong(notice.text);
                                return `
                                <article class="notice-card">
                                    <h4 class="notice-title">${notice.pinned ? '<i class="fas fa-thumbtack text-amber-500 mr-1" title="Pinned"></i>' : ''}${escapeHtml(notice.heading)}</h4>
                                    <p class="notice-body ${longNotice ? 'notice-preview-clamp' : ''}">${renderNoticeTextWithLinks(notice.text, 25)}</p>
                                    <div class="notice-footer">
                                        <span class="notice-date"><i class="far fa-calendar-alt"></i> ${escapeHtml(notice.date || 'Date unavailable')}</span>
                                        ${longNotice ? `<button type="button" class="notice-expand-btn" data-notice-index="${index}">Expand</button>` : ''}
                                    </div>
                                </article>
                            `;
                            }).join('');
                            fitNoticeViewportForFourCards();
                        }

                        // Gallery Display Logic
                        const gallery = Array.isArray(content.gallery) ? content.gallery : [];
                        const galleryCont = document.getElementById('gallery-container');
                        const navGalleryLink = document.getElementById('nav-gallery-link');
                        const heroBtnGallery = document.getElementById('hero-btn-gallery');
                        
                        if (gallery.length === 0) {
                            galleryCont.classList.add('hidden');
                            if(navGalleryLink) navGalleryLink.classList.add('hidden');
                            if(heroBtnGallery) heroBtnGallery.classList.add('hidden');
                        } else {
                            galleryCont.classList.remove('hidden');
                            if(navGalleryLink) navGalleryLink.classList.remove('hidden');
                            if(heroBtnGallery) heroBtnGallery.classList.remove('hidden');
                            
                            galleryUrls = gallery.map((url) => sanitizeUrl(url)).filter(Boolean);
                            document.getElementById('gallery-list').innerHTML = galleryUrls.map((safeUrl, index) => {
                                return `<button type="button" class="gallery-item" data-gallery-index="${index}" data-gallery-url="${escapeHtml(safeUrl)}"><img src="${safeUrl}" alt="Gallery image ${index + 1}"></button>`;
                            }).join('');
                        }
                        
                        loaded.content = true; triggerAnim();
                        renderDynamicDirectory();
                    });

                    onSnapshot(collection(db, `${BASE_PATH}/publicDirectory`), snap => {
                        directoryEntries = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
                        renderDynamicDirectory();
                    });
                    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'categoryAuthConfig'), snap => {
                        const payload = snap.exists() ? snap.data() : {};
                        categoryAuthConfig = payload && typeof payload.categories === 'object' ? payload : { categories: {} };
                    });
                    onSnapshot(doc(db, `${BASE_PATH}/settings`, 'pageAccess'), snap => {
                        const payload = snap.exists() ? snap.data() : {};
                        pageAccessConfig = (payload && typeof payload === 'object') ? payload : { categories: {}, overrides: {} };
                    });

                    onSnapshot(collection(db, `${BASE_PATH}/staff`), snap => {
                        const allStaff = snap.docs.map(d => ({id: d.id, ...d.data()}));
                        const activeStaff = allStaff.filter(s => s.isActive);
                        const sortByDisplayOrder = (list = []) => [...list].sort((a, b) => {
                            const orderDiff = Number(a?.displayOrder || 999) - Number(b?.displayOrder || 999);
                            if (orderDiff !== 0) return orderDiff;
                            return String(a?.name || '').localeCompare(String(b?.name || ''));
                        });
                        const teachers = sortByDisplayOrder(activeStaff.filter(s => s.type === 'Teacher'));
                        const mgmt = sortByDisplayOrder(activeStaff.filter(s => s.type === 'Management'));
                        
                        const renderStaffList = (id, list, contId, linkId, btnId) => {
                            const cont = document.getElementById(contId);
                            const forceShow = id === 'teachers-list';
                            if(!list.length) { 
                                if (forceShow) {
                                    cont.classList.remove('hidden');
                                    if(document.getElementById(linkId)) document.getElementById(linkId).classList.remove('hidden');
                                    if(document.getElementById(btnId)) document.getElementById(btnId).classList.remove('hidden');
                                    document.getElementById(id).innerHTML = '<p class="text-sm text-gray-500 italic">No profiles available.</p>';
                                } else {
                                    cont.classList.add('hidden'); 
                                    if(document.getElementById(linkId)) document.getElementById(linkId).classList.add('hidden'); 
                                    if(document.getElementById(btnId)) document.getElementById(btnId).classList.add('hidden'); 
                                }
                            } else { 
                                cont.classList.remove('hidden'); 
                                if(document.getElementById(linkId)) document.getElementById(linkId).classList.remove('hidden'); 
                                if(document.getElementById(btnId)) document.getElementById(btnId).classList.remove('hidden'); 
                                
                                document.getElementById(id).innerHTML = list.map((p) => {
                                    const safePhoto = sanitizeUrl(p.photo) || 'https://via.placeholder.com/150?text=User';
                                    return `<button type="button" class="person-card" data-person-name="${escapeHtml(p.name || '')}" data-person-role="${escapeHtml(p.role || '')}" data-person-phone="${escapeHtml(p.phone || '')}" data-person-img="${escapeHtml(safePhoto)}" data-person-address="${escapeHtml(p.address || '')}"><img src="${safePhoto}" class="person-img" alt="${escapeHtml(p.name || 'Staff member')}"><div class="person-name">${escapeHtml(p.name)}</div><div class="person-role">${escapeHtml(p.role)}</div></button>`;
                                }).join('');
                            }
                        };
                        
                        renderStaffList('teachers-list', teachers, 'teachers-container', 'nav-teachers-link', 'hero-btn-teachers');
                        renderStaffList('comm-list', mgmt, 'management-container', 'nav-management-link', null);
                        
                        document.getElementById('stat-staff').textContent = teachers.length;
                        loaded.staff = true; triggerAnim();
                    });

                    onSnapshot(collection(db, `${BASE_PATH}/students`), snap => {
                        allStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        const classes = [...new Set(allStudents.map(s => s.class))].sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
                        document.getElementById('login-class').innerHTML = '<option value="">Select Class</option>' + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
                        
                        document.getElementById('stat-total').textContent = allStudents.length;
                        document.getElementById('stat-male').textContent = allStudents.filter(s => s.gender === 'Male').length;
                        document.getElementById('stat-female').textContent = allStudents.filter(s => s.gender === 'Female').length;

                        loaded.students = true; triggerAnim();
                    });
                }
            });
            signInAnonymously(auth);
        }

        const lName = document.getElementById('login-student-name');
        const lClass = document.getElementById('login-class');
        const lSugg = document.getElementById('student-suggestions');
        const galleryList = document.getElementById('gallery-list');
        const staffContainers = ['teachers-list', 'comm-list', 'dynamic-directory-sections']
            .map((id) => document.getElementById(id))
            .filter(Boolean);

        galleryList?.addEventListener('click', (event) => {
            const card = event.target.closest('[data-gallery-url]');
            if (!card) return;
            openImageModal(card.dataset.galleryUrl, Number(card.dataset.galleryIndex || -1));
        });

        staffContainers.forEach((container) => {
            container.addEventListener('click', (event) => {
                const card = event.target.closest('[data-person-name]');
                if (!card) return;
                window.openPersonModal(
                    card.dataset.personName || '',
                    card.dataset.personRole || '',
                    card.dataset.personPhone || '',
                    card.dataset.personImg || '',
                    card.dataset.personAddress || ''
                );
            });
        });
        
        lName.addEventListener('input', () => {
            const cls = lClass.value; const txt = lName.value.toLowerCase(); lSugg.innerHTML = '';
            if(!cls) { selectedLoginStudent = null; lSugg.classList.remove('active'); return; }
            if(txt.length < 1) { lSugg.classList.remove('active'); return; }
            
            const matches = allStudents.filter(s => s.class === cls && (s.name.toLowerCase().includes(txt) || (s.adm && s.adm.toLowerCase().includes(txt))));
            if(matches.length > 0) {
                lSugg.classList.add('active');
                matches.forEach(s => {
                    const d = document.createElement('div');
                    d.className = 'suggestion-item';
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = s.name;
                    const admSpan = document.createElement('span');
                    admSpan.className = 'text-gray-400 text-xs font-mono';
                    admSpan.textContent = `Adm: ${s.adm || '-'}`;
                    d.append(nameSpan, admSpan);
                    d.onclick = () => { selectedLoginStudent = s; lName.value = s.name; lSugg.classList.remove('active'); };
                    lSugg.appendChild(d);
                });
            } else { lSugg.innerHTML = '<div class="suggestion-item text-gray-500">No students found</div>'; lSugg.classList.add('active'); }
        });
        const updateIdentifierInputMode = () => {
            const hasClass = Boolean(lClass.value);
            if (hasClass) {
                lName.placeholder = 'Search Name or Adm No';
                document.getElementById('login-title').textContent = 'Student Login';
            } else {
                lName.placeholder = 'Email (Admin / Staff)';
                document.getElementById('login-title').textContent = 'Secure Login';
            }
        };
        lClass.addEventListener('change', () => { selectedLoginStudent = null; lName.value = ''; lSugg.classList.remove('active'); updateIdentifierInputMode(); });
        updateIdentifierInputMode();

        document.getElementById('login-submit').addEventListener('click', async () => {
            const btn = document.getElementById('login-submit');
            const activeRole = window.AppSession?.getRole?.() || '';
            const confirmRoleSwitch = (targetRoleLabel) => {
                if (!activeRole) return true;
                const activeRoleLabel = activeRole.charAt(0).toUpperCase() + activeRole.slice(1);
                return window.confirm(`You are currently signed in as ${activeRoleLabel}. Continue and switch to ${targetRoleLabel} mode?`);
            };

            const selectedClass = document.getElementById('login-class').value.trim();
            const passwordInput = document.getElementById('login-phone').value.trim();
            const hasStudentAttempt = Boolean(selectedClass);
            const hasStaffAttempt = !selectedClass && Boolean(lName.value.trim() || passwordInput);

            if (hasStudentAttempt) {
                if (!selectedLoginStudent) {
                    const typedIdentifier = lName.value.trim().toLowerCase();
                    if (typedIdentifier) {
                        const classMatches = allStudents.filter((student) => student.class === selectedClass);
                        const matchedStudents = classMatches.filter((student) => {
                            const studentName = String(student.name || '').trim().toLowerCase();
                            const studentAdm = String(student.adm || '').trim().toLowerCase();
                            return studentName === typedIdentifier || studentAdm === typedIdentifier;
                        });
                        if (matchedStudents.length === 1) {
                            [selectedLoginStudent] = matchedStudents;
                        }
                    }
                }
                const studentPassword = normalizePhone(passwordInput);
                const studentPhone = normalizePhone(selectedLoginStudent?.mobile || '');
                if(!selectedLoginStudent || !studentPassword) { showLoginMessage("Select student and enter the registered mobile number"); return; }
                if(!studentPhone) { showLoginMessage("This student does not have a registered mobile number. Please contact the office."); return; }
                if (!confirmRoleSwitch('Student')) return;
                if(studentPhone === studentPassword) {
                    showLoginMessage(''); btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Loading...';
                    window.AppSession?.startStudent(selectedLoginStudent.id, {
                        name: selectedLoginStudent.name || '',
                        class: selectedLoginStudent.class || '',
                        adm: selectedLoginStudent.adm || ''
                    });
                    window.location.href = 'student.html';
                } else { showLoginMessage("Incorrect registered mobile number"); }
                return;
            }

            if (hasStaffAttempt) {
                const loginId = lName.value.trim();
                const staffPassword = passwordInput;
                if(!loginId || !staffPassword) { showLoginMessage("Enter Username and Password"); return; }
                if (!confirmRoleSwitch('Staff/Admin')) return;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Authenticating...';
                try {
                    await window.AppSession?.clearAll();
                    const userLogin = loginId.toLowerCase();
                    const adminRef = doc(db, `${BASE_PATH}/settings`, ADMIN_AUTH_DOC_ID);
                    const adminSnap = await getDoc(adminRef);
                    const adminData = adminSnap.exists() ? adminSnap.data() : {};
                    const adminEmail = (adminData.email || '').toLowerCase();
                    const adminAccounts = SINGLE_ADMIN_MODE ? [] : (Array.isArray(adminData.admins) ? adminData.admins : []);
                    const isActiveAdmin = adminEmail === userLogin || adminAccounts.some((account) => (account.email || '').toLowerCase() === userLogin && account.isActive !== false);
                    if (isActiveAdmin) {
                        try {
                            const userCred = await signInWithEmailAndPassword(auth, loginId, staffPassword);
                            if (!userCred?.user) throw new Error('Admin auth failed');
                        } catch (adminAuthError) {
                            const legacyPassword = String(adminData.password || '').trim();
                            const legacyMatched = legacyPassword && legacyPassword === String(staffPassword).trim();
                            if (!legacyMatched) throw adminAuthError;
                        }
                        window.AppSession?.startAdmin();
                        window.location.href = 'admin.html';
                        return;
                    }
                    const staffSnap = await getDocs(collection(db, `${BASE_PATH}/staff`));
                    const activeCollector = staffSnap.docs
                        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                        .find((staffMember) => {
                            if (staffMember.isActive === false) return false;
                            const byEmail = (staffMember.email || '').toLowerCase() === userLogin;
                            const byUsername = (staffMember.username || '').toLowerCase() === userLogin;
                            return byEmail || byUsername;
                        });
                    if (activeCollector) {
                        if (!(activeCollector.password || '').trim()) {
                            showLoginMessage("Staff password not configured. Contact admin.");
                            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                            return;
                        }
                        if (String(activeCollector.password || '').trim() !== String(staffPassword).trim()) {
                            showLoginMessage("Incorrect staff password");
                            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                            return;
                        }
                        const collectorKey = String(activeCollector.email || activeCollector.username || userLogin).trim().toLowerCase();
                        window.AppSession?.startStaff(activeCollector.name || '', collectorKey, {
                            collection: activeCollector.canCollect !== false,
                            result: activeCollector.canManageResults === true,
                            source: 'staff',
                            userKey: collectorKey,
                            loginId: userLogin
                        });
                        if (activeCollector.canCollect !== false) {
                            window.location.href = 'collection.html';
                            return;
                        }
                        if (activeCollector.canManageResults === true) {
                            window.location.href = 'result.html';
                            return;
                        }
                        showLoginMessage('Access Denied. Collection/Publishing access is not enabled for this staff account.');
                        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                        return;
                    } else {
                        const directoryLogin = await resolveDirectoryLogin(userLogin, staffPassword);
                        if (directoryLogin?.blocked) {
                            showLoginMessage('This account is blocked. Contact admin.');
                            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                            return;
                        }
                        if (directoryLogin?.entry) {
                            const access = directoryLogin.access || {};
                            const targetPage = directoryLogin.targetPage === 'student' ? 'student' : 'collection';
                            const rawName = String(directoryLogin.entry?.authMeta?.usernameRaw || userLogin || 'User');
                            const studentId = String(
                                directoryLogin.entry?.values?.studentId ||
                                directoryLogin.entry?.values?.student_id ||
                                directoryLogin.entry?.values?.uid ||
                                ''
                            ).trim();
                            if (targetPage === 'student') {
                                if (!access.student) {
                                    showLoginMessage('Student page access is not enabled for this account.');
                                    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                                    return;
                                }
                                if (!studentId) {
                                    showLoginMessage('Student login mapping is incomplete (studentId missing). Contact admin.');
                                    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                                    return;
                                }
                                const mappedStudent = allStudents.find((item) => item.id === studentId);
                                window.AppSession?.startStudent(studentId, {
                                    name: mappedStudent?.name || rawName,
                                    class: mappedStudent?.class || '',
                                    adm: mappedStudent?.adm || ''
                                });
                                window.location.href = 'student.html';
                                return;
                            }
                            if (!access.collection) {
                                showLoginMessage('Collection page access is not enabled for this account.');
                                btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                                return;
                            }
                            window.AppSession?.startStaff(rawName, userLogin.toLowerCase(), { ...access, userKey: userLogin.toLowerCase(), loginId: userLogin.toLowerCase(), source: 'directory' });
                            window.location.href = 'collection.html';
                            return;
                        }
                        showLoginMessage("Access Denied. Collection access is not enabled for this staff account.");
                        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                    }
                } catch (error) {
                    console.error(error);
                    showLoginMessage("Invalid Username or Password");
                    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login Securely';
                }
                return;
            }

            showLoginMessage("Select class for student login, or enter email and password for staff/admin login.");
        });

        const sessionNotice = window.AppSession?.consumeFlash?.();
        if (sessionNotice) {
            window.openLogin();
            showLoginMessage(sessionNotice);
        }
        if (new URLSearchParams(window.location.search).get('addStudent') === '1') {
            history.replaceState(null, '', window.location.pathname);
            openStudentLoginModal();
        }

        init();

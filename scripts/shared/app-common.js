import { APP_VERSION, LAST_UPDATED, RELEASE_STAGE } from '../../config/version.js';
import { BASE_PATH } from '../../config/app-config.js';

export { BASE_PATH };
export const formatCurrency = (value = 0) => `₹${Number(value || 0).toFixed(0)}`;
export const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export const sanitizePhone = (value = '') => String(value).replace(/[^\d+]/g, '');
export const sanitizeUrl = (value = '', allowedProtocols = ['https:', 'http:', 'mailto:', 'tel:']) => {
    if (!value) return '';
    try {
        const parsed = new URL(value, window.location.origin);
        return allowedProtocols.includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
        return '';
    }
};
export const formatDateDisplay = (value, locale = 'en-GB') => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(locale);
};
export const formatMonthLabel = (value) => {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return value || '--';
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
};
export const buildEmptyState = (message, icon = 'fa-circle-info') => `
    <div class="shared-empty-state">
        <i class="fas ${icon}"></i>
        <span>${escapeHtml(message)}</span>
    </div>
`;
export const hardenExternalLinks = () => {
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
        link.rel = 'noopener noreferrer';
    });
};

export const initGlobalModalScrollLock = () => {
    const rootEl = document.documentElement;
    if (!rootEl || rootEl.dataset.modalScrollLockBound === 'true') return;
    rootEl.dataset.modalScrollLockBound = 'true';

    const isVisible = (el) => {
        if (!el || el.classList.contains('hidden')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const syncBodyLock = () => {
        const overlays = document.querySelectorAll('.modal-overlay, .popup-overlay');
        const hasOpenOverlay = Array.from(overlays).some((overlay) => isVisible(overlay));
        document.body.classList.toggle('modal-scroll-lock', hasOpenOverlay);
    };

    const bindObserver = () => {
        if (!document.body) return;
        const observer = new MutationObserver(syncBodyLock);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        syncBodyLock();
    };

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            window.requestAnimationFrame(syncBodyLock);
        }
    });

    if (document.body) bindObserver();
    else window.addEventListener('DOMContentLoaded', bindObserver, { once: true });
};

export const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        const ensureUpdateOverlay = () => {
            let overlay = document.getElementById('sw-update-overlay');
            if (overlay) return overlay;
            overlay = document.createElement('div');
            overlay.id = 'sw-update-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.7);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px;';
            overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:16px;max-width:360px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,.2);">
                <h3 style="font-weight:800;font-size:18px;margin-bottom:6px;">Update Available</h3>
                <p id="sw-update-meta" style="font-size:13px;color:#475569;margin-bottom:10px;">New version is ready.</p>
                <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div id="sw-update-progress" style="height:100%;width:0%;background:#2563eb;"></div></div>
                <div id="sw-update-size" style="font-size:12px;color:#64748b;margin-top:8px;">0 MB / 0 MB</div>
                <button id="sw-update-btn" style="margin-top:12px;width:100%;background:#2563eb;color:#fff;font-weight:700;border:none;border-radius:10px;padding:10px;">Update</button>
            </div>`;
            document.body.appendChild(overlay);
            return overlay;
        };

        navigator.serviceWorker.register('./sw.js').then((registration) => {
            const overlay = ensureUpdateOverlay();
            const meta = overlay.querySelector('#sw-update-meta');
            const progress = overlay.querySelector('#sw-update-progress');
            const size = overlay.querySelector('#sw-update-size');
            const btn = overlay.querySelector('#sw-update-btn');
            const showOverlay = () => { overlay.style.display = 'flex'; };
            const updateWithWaitingWorker = () => {
                if (!registration.waiting) return;
                btn.disabled = true;
                btn.textContent = 'Updating...';
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            };

            btn.addEventListener('click', updateWithWaitingWorker);
            if (registration.waiting) showOverlay();
            registration.addEventListener('updatefound', () => {
                showOverlay();
                meta.textContent = 'Downloading update package...';
            });
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'SW_INSTALL_PROGRESS') {
                    const loadedMb = (Number(event.data.loaded || 0) / (1024 * 1024));
                    const totalMb = (Number(event.data.total || 0) / (1024 * 1024));
                    const pct = event.data.total ? Math.min(100, (loadedMb / totalMb) * 100) : 0;
                    progress.style.width = `${pct.toFixed(0)}%`;
                    size.textContent = `${loadedMb.toFixed(2)} MB / ${totalMb.toFixed(2)} MB`;
                }
                if (event.data?.type === 'SW_UPDATE_READY') {
                    showOverlay();
                    meta.textContent = 'Update ready. Click Update to continue.';
                    btn.disabled = false;
                    btn.textContent = 'Update';
                }
            });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        }).catch((error) => {
            console.warn('Service worker registration failed.', error);
        });
    }, { once: true });
};

const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
};

const setLink = (id, value, prefix = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    const safeValue = prefix === 'tel:'
        ? `${prefix}${sanitizePhone(value)}`
        : sanitizeUrl(prefix ? `${prefix}${value}` : value, prefix ? [prefix === 'mailto:' ? 'mailto:' : 'tel:'] : undefined);
    if (safeValue) el.href = safeValue;
};

const DEFAULT_LOGO_URL = 'assets/images/logo.png';
const LOGO_CACHE_KEY = 'institution_logo_url_v1';
const FAST_LOGO_IDS = [
    'splash-logo-img',
    'header-logo',
    'hero-logo-img',
    'admin-loader-logo',
    'admin-header-logo',
    'header-logo-right',
    'official-login-modal-logo'
];

const normalizeLogoUrl = (logoUrl = '') => {
    const value = String(logoUrl || '').trim();
    if (!value) return '';
    return sanitizeUrl(value, ['https:', 'http:', 'data:']) || '';
};

export const getCachedInstitutionLogo = () => {
    try {
        return normalizeLogoUrl(localStorage.getItem(LOGO_CACHE_KEY) || '');
    } catch (_error) {
        return '';
    }
};

export const rememberInstitutionLogo = (logoUrl = '') => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    try {
        if (normalizedLogo) localStorage.setItem(LOGO_CACHE_KEY, normalizedLogo);
        else localStorage.removeItem(LOGO_CACHE_KEY);
    } catch (_error) {}
    return normalizedLogo;
};

const warmLogoCache = (logoUrl = '') => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    if (!normalizedLogo) return;
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = normalizedLogo;
    } catch (_error) {}
};

const setLogo = (ids, logoUrl, { useCachedFallback = false } = {}) => {
    const normalizedLogo = normalizeLogoUrl(logoUrl);
    const effectiveLogo = normalizedLogo || (useCachedFallback ? getCachedInstitutionLogo() : '') || DEFAULT_LOGO_URL;
    warmLogoCache(effectiveLogo);
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.getAttribute('src') !== effectiveLogo) el.src = effectiveLogo;
        el.style.opacity = '1';
        el.onerror = () => {
            el.onerror = null;
            el.src = DEFAULT_LOGO_URL;
            el.style.opacity = '1';
        };
    });
};

export const applyCachedInstitutionLogo = (ids = FAST_LOGO_IDS) => {
    setLogo(ids, '', { useCachedFallback: true });
};

const applyCachedLogoWhenReady = () => applyCachedInstitutionLogo();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCachedLogoWhenReady, { once: true });
} else {
    applyCachedLogoWhenReady();
}

export const normalizePhone = (value = '') => value.toString().replace(/\D/g, '');

export const fitTextToContainer = (elementId, minFontSize = 12) => {
    const el = document.getElementById(elementId);
    if (!el || !el.parentElement) return;
    el.style.fontSize = '';
    el.style.whiteSpace = 'nowrap';
    let fontSize = parseInt(window.getComputedStyle(el).fontSize, 10);
    while (el.scrollWidth > el.parentElement.clientWidth && fontSize > minFontSize) {
        fontSize -= 1;
        el.style.fontSize = `${fontSize}px`;
    }
};

export const enableSmartSelectWindowing = (root = document, { visibleCount = 6 } = {}) => {
    const hostEl = root instanceof Document ? root.documentElement : root;
    const selects = Array.from(root.querySelectorAll('select'))
        .filter((select) => !select.multiple && !select.dataset.smartWindowBound && select.dataset.nativeSelect !== 'true' && select.options.length > visibleCount);
    const closeAll = () => root.querySelectorAll('.smart-select-list.active').forEach((el) => el.classList.remove('active'));

    selects.forEach((select) => {
        select.dataset.smartWindowBound = 'true';
        const wrapper = document.createElement('div');
        wrapper.className = 'smart-select-wrapper relative';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = select.className;
        input.classList.add('smart-select-input');
        input.placeholder = 'Type to search...';
        input.autocomplete = 'off';
        wrapper.insertBefore(input, select);

        const list = document.createElement('div');
        list.className = 'suggestions-box smart-select-list';
        wrapper.appendChild(list);

        select.classList.add('smart-select-native-hidden');

        const renderList = (term = '') => {
            const normalizedTerm = String(term || '').trim().toLowerCase();
            const options = Array.from(select.options);
            const filtered = options.filter((option) => String(option.textContent || '').toLowerCase().includes(normalizedTerm));
            list.innerHTML = filtered.length
                ? filtered.map((option) => `<div class="suggestion-item smart-select-option ${option.value === select.value ? 'smart-selected-option' : ''}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.textContent || '')}</div>`).join('')
                : '<div class="suggestion-item text-gray-400">No matches</div>';
            list.classList.add('active');
        };

        const syncInputValue = () => {
            const selectedOption = select.options[select.selectedIndex];
            input.value = selectedOption ? selectedOption.textContent : '';
        };

        syncInputValue();
        input.addEventListener('focus', () => {
            closeAll();
            renderList(input.value);
        });
        input.addEventListener('input', () => renderList(input.value));
        input.addEventListener('click', () => {
            closeAll();
            renderList(input.value);
        });

        list.addEventListener('click', (event) => {
            const optionEl = event.target.closest('.smart-select-option');
            if (!optionEl) return;
            select.value = optionEl.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncInputValue();
            list.classList.remove('active');
            input.blur();
        });

        select.addEventListener('change', syncInputValue);
        const observer = new MutationObserver(() => syncInputValue());
        observer.observe(select, { childList: true, subtree: true, characterData: true });
    });

    if (!hostEl?.dataset?.smartSelectGlobalBound) {
        if (hostEl?.dataset) hostEl.dataset.smartSelectGlobalBound = 'true';
        document.addEventListener('click', (event) => {
            if (event.target.closest('.smart-select-wrapper')) return;
            closeAll();
        });
    }
};

export const renderVersionInfo = (options = {}) => {
    const {
        versionId = 'footer-version',
        updatedId = 'footer-updated',
        prefix = 'Version'
    } = options;

    setText(versionId, `${prefix}: ${APP_VERSION}`);
    setText(updatedId, `Last Updated: ${LAST_UPDATED}`);
};

export const applyInstitutionBranding = (conf = {}, options = {}) => {
    const {
        defaultAppName = 'Institution',
        defaultSubtitle = 'Excellence in Education',
        headerTitleIds = ['header-title'],
        primaryTitleIds = [],
        subtitleIds = [],
        footerNameIds = ['footer-inst-name'],
        logoIds = ['header-logo'],
        updateDocumentTitle = false,
        documentTitleSuffix = ''
    } = options;

    const appName = conf.appName || defaultAppName;
    const subtitle = conf.appSubtitle || defaultSubtitle;

    headerTitleIds.forEach((id) => setText(id, appName));
    primaryTitleIds.forEach((id) => setText(id, appName));
    subtitleIds.forEach((id) => setText(id, subtitle));
    footerNameIds.forEach((id) => setText(id, appName));

    const regEl = document.getElementById('header-regno');
    const placeEl = document.getElementById('header-place');
    const sepEl = document.getElementById('header-sep');
    const subContainer = document.getElementById('header-subtitle');
    if (regEl && placeEl && sepEl && subContainer) {
        regEl.textContent = conf.regNo ? `Reg: ${conf.regNo}` : '';
        placeEl.textContent = conf.place || '';
        if (conf.regNo || conf.place) {
            subContainer.classList.remove('hidden');
            sepEl.classList.toggle('hidden', !(conf.regNo && conf.place));
        } else {
            subContainer.classList.add('hidden');
        }
    }

    const heroRegEl = document.getElementById('hero-regno');
    const heroPlaceEl = document.getElementById('hero-place');
    const heroSepEl = document.getElementById('hero-place-separator');
    if (heroRegEl && heroPlaceEl && heroSepEl) {
        heroRegEl.textContent = conf.regNo ? `Reg No: ${conf.regNo}` : '';
        heroPlaceEl.textContent = conf.place || '';
        heroSepEl.classList.toggle('hidden', !(conf.regNo && conf.place));
    }

    setText('footer-phone', conf.contactPhone || 'Not Available');
    setText('footer-email', conf.contactEmail || 'Not Available');
    setLink('footer-phone-link', conf.contactPhone, 'tel:');
    setLink('footer-email-link', conf.contactEmail, 'mailto:');

    ['youtube', 'telegram', 'instagram', 'whatsapp', 'facebook'].forEach((key) => {
        const id = `link-${key}`;
        const url = key === 'youtube'
            ? conf.socialYouTube
            : conf[`social${key.charAt(0).toUpperCase()}${key.slice(1)}`];
        const el = document.getElementById(id);
        if (!el) return;
        const safeUrl = sanitizeUrl(url);
        if (safeUrl) {
            el.href = safeUrl;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    rememberInstitutionLogo(conf.logoUrl || '');
    setLogo(logoIds, conf.logoUrl);

    if (updateDocumentTitle) {
        document.title = documentTitleSuffix ? `${appName} - ${documentTitleSuffix}` : appName;
    }

    hardenExternalLinks();
    renderVersionInfo();
};

initGlobalModalScrollLock();

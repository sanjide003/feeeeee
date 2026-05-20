let mounted = false;

const ensureMount = () => {
  if (mounted) return;
  const host = document.createElement('div');
  host.id = 'app-toast-host';
  host.style.cssText = 'position:fixed;top:14px;right:14px;z-index:12000;display:flex;flex-direction:column;gap:8px;max-width:320px;';
  document.body.appendChild(host);
  mounted = true;
};

export const showToast = (message = '', type = 'info', timeout = 3000) => {
  if (!message) return;
  ensureMount();
  const host = document.getElementById('app-toast-host');
  const toast = document.createElement('div');
  const tone = type === 'error' ? '#dc2626' : type === 'warn' ? '#d97706' : type === 'success' ? '#059669' : '#1d4ed8';
  toast.style.cssText = `background:${tone};color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:700;box-shadow:0 10px 22px rgba(15,23,42,.2);`;
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), timeout);
};

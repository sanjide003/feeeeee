const LEVELS = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' };

const formatPayload = (context = '', meta = {}) => ({
  context,
  ...meta,
  ts: new Date().toISOString()
});

export const appLog = (level = 'info', context = '', message = '', meta = {}) => {
  const tag = `[${LEVELS[level] || LEVELS.info}] ${context}`;
  const payload = formatPayload(context, meta);
  if (level === 'error') console.error(tag, message, payload);
  else if (level === 'warn') console.warn(tag, message, payload);
  else if (level === 'debug') console.debug(tag, message, payload);
  else console.info(tag, message, payload);
};

export const withSafe = (context = 'app', fn = () => {}) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    appLog('error', context, error?.message || 'Unhandled error', { error });
    throw error;
  }
};

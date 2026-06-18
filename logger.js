// Tiny logger that prefixes every line with an ISO-8601 timestamp.
function stamp() {
  return new Date().toISOString();
}

export function log(...args) {
  console.log(`[${stamp()}]`, ...args);
}

export function logError(...args) {
  console.error(`[${stamp()}]`, ...args);
}

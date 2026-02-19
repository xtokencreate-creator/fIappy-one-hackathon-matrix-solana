const STORAGE_KEY = 'flappy_dt_v1';

/**
 * Returns a stable 64-char hex device token. Generated once and persisted
 * in localStorage. Sent to the server on WebSocket connect; the server
 * HMAC-hashes it and never stores the raw value.
 */
export function getOrCreateDeviceToken() {
    try {
        let token = localStorage.getItem(STORAGE_KEY);
        if (token && typeof token === 'string' && token.length === 64) return token;

        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

        localStorage.setItem(STORAGE_KEY, token);
        return token;
    } catch (_) {
        // Fallback if localStorage or crypto is unavailable
        return null;
    }
}

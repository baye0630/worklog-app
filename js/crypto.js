/**
 * 本地数据加密：PBKDF2 + AES-GCM（Web Crypto API）
 */
const CryptoVault = (() => {
  const META_KEY = 'worklog-vault-meta';
  const DATA_KEY = 'worklog-vault-data';
  const PBKDF2_ITERATIONS = 120000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBuf(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(password, plaintext) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt);
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    return {
      salt: bufToBase64(salt),
      iv: bufToBase64(iv),
      ciphertext: bufToBase64(ciphertext),
    };
  }

  async function decrypt(password, payload) {
    const salt = new Uint8Array(base64ToBuf(payload.salt));
    const iv = new Uint8Array(base64ToBuf(payload.iv));
    const ciphertext = base64ToBuf(payload.ciphertext);
    const key = await deriveKey(password, salt);
    const dec = new TextDecoder();
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return dec.decode(plainBuf);
  }

  function getMeta() {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function isInitialized() {
    return !!localStorage.getItem(DATA_KEY);
  }

  async function saveEncrypted(password, dataObj) {
    const payload = await encrypt(password, JSON.stringify(dataObj));
    localStorage.setItem(DATA_KEY, JSON.stringify(payload));
    if (!getMeta()) {
      localStorage.setItem(META_KEY, JSON.stringify({ createdAt: Date.now(), version: 1 }));
    }
  }

  async function loadEncrypted(password) {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const json = await decrypt(password, payload);
    return JSON.parse(json);
  }

  async function changePassword(oldPassword, newPassword) {
    const data = await loadEncrypted(oldPassword);
    if (!data) throw new Error('原密码错误或数据不存在');
    await saveEncrypted(newPassword, data);
  }

  async function exportBackup(password) {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) throw new Error('无数据可导出');
    await loadEncrypted(password);
    return raw;
  }

  async function importBackup(password, backupRaw) {
    const payload = JSON.parse(backupRaw);
    const data = await decrypt(password, payload);
    JSON.parse(data);
    localStorage.setItem(DATA_KEY, backupRaw);
  }

  function wipeAll() {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(META_KEY);
  }

  return {
    META_KEY,
    DATA_KEY,
    isInitialized,
    saveEncrypted,
    loadEncrypted,
    changePassword,
    exportBackup,
    importBackup,
    wipeAll,
  };
})();

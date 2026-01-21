(function (global) {
    const STORAGE_KEY = 'CEXT_AUTOLOGIN_CREDENTIALS';

    function isSupported() {
        return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    }

    // IndexedDB 鏡像（僅供 DevTools 檢視用，不作主存）
    const IDB_NAME = 'CEXTAutoLoginMirror';
    const IDB_STORE = 'credentials';
    let idbPromise = null;

    function getIDB() {
        if (!('indexedDB' in global)) return null;
        if (idbPromise) return idbPromise;
        idbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return idbPromise;
    }

    async function syncToIndexedDB(list) {
        try {
            const db = await getIDB();
            if (!db) return;
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                store.clear();
                list.forEach(item => store.put(item));
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        } catch (err) {
            console.warn('[autoLogin-storage] 同步 IndexedDB 失敗（僅鏡像）：', err);
        }
    }

    function cleanLoginUrl(url) {
        try {
            const urlObj = new URL(url);
            urlObj.search = '';
            return urlObj.href;
        } catch (e) {
            const index = url.indexOf('?');
            return index > -1 ? url.substring(0, index) : url;
        }
    }

    async function loadAll() {
        if (!isSupported()) {
            return [];
        }
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], (res) => {
                const list = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
                resolve(list);
            });
        });
    }

    async function saveAll(list) {
        if (!isSupported()) {
            throw new Error('chrome.storage.local not supported');
        }
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [STORAGE_KEY]: list }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    // 鏡像到 IndexedDB 方便在 Application > IndexedDB 檢視
                    syncToIndexedDB(list);
                    resolve(true);
                }
            });
        });
    }

    async function init() {
        // chrome.storage 無需特別初始化；啟動時同步一次鏡像，方便 DevTools 檢視
        const supported = isSupported();
        if (supported) {
            try {
                const list = await loadAll();
                syncToIndexedDB(list);
            } catch (err) {
                console.warn('[autoLogin-storage] 初始鏡像同步失敗：', err);
            }
        }
        return supported;
    }

    async function saveCredential(credential, id = null) {
        const list = await loadAll();
        const now = new Date().toISOString();
        const record = {
            NAME: credential.NAME || '',
            LOGIN_URL: credential.LOGIN_URL || '',
            loginName: credential.loginName || '',
            intumitPswd: credential.intumitPswd || '',
            createdAt: credential.createdAt || now,
            updatedAt: now
        };
        if (id !== null && id !== undefined) {
            record.id = id;
        } else {
            record.id = record.id || Date.now();
        }

        const idx = list.findIndex(item => item.id === record.id);
        if (idx >= 0) {
            list[idx] = record;
        } else {
            list.push(record);
        }
        await saveAll(list);
        return record.id;
    }

    async function saveCredentials(credentials) {
        if (!Array.isArray(credentials) || credentials.length === 0) {
            return [];
        }
        const list = await loadAll();
        const now = new Date().toISOString();
        const ids = [];
        credentials.forEach((cred, idx) => {
            const record = {
                NAME: cred.NAME || '',
                LOGIN_URL: cred.LOGIN_URL || '',
                loginName: cred.loginName || '',
                intumitPswd: cred.intumitPswd || '',
                createdAt: cred.createdAt || now,
                updatedAt: now,
                id: cred.id || Date.now() + idx
            };
            list.push(record);
            ids.push(record.id);
        });
        await saveAll(list);
        return ids;
    }

    async function getCredentialByUrl(url) {
        if (!url) return null;
        const list = await loadAll();
        const cleanUrl = cleanLoginUrl(url);
        return list.find(cred => {
            if (!cred.LOGIN_URL) return false;
            const credClean = cleanLoginUrl(cred.LOGIN_URL);
            return credClean === cleanUrl || cred.LOGIN_URL === url;
        }) || null;
    }

    async function getAllCredentials() {
        const list = await loadAll();
        // 最新更新時間在前
        list.sort((a, b) => {
            const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return bt - at;
        });
        return list;
    }

    async function deleteCredential(id) {
        if (id === null || id === undefined) return false;
        const list = await loadAll();
        const next = list.filter(item => item.id !== id);
        await saveAll(next);
        return true;
    }

    async function clearAll() {
        await saveAll([]);
        return true;
    }

    async function exportToJSON() {
        const list = await loadAll();
        const exportData = list.map(c => ({
            NAME: c.NAME,
            LOGIN_URL: c.LOGIN_URL,
            loginName: c.loginName,
            intumitPswd: c.intumitPswd
        }));
        return JSON.stringify(exportData, null, 2);
    }

    async function debugViewAll() {
        const all = await getAllCredentials();
        console.table(all);
        console.log('總共', all.length, '筆資料');
        return all;
    }

    const api = {
        init,
        isSupported,
        saveCredential,
        saveCredentials,
        getCredentialByUrl,
        getAllCredentials,
        deleteCredential,
        clearAll,
        exportToJSON,
        cleanLoginUrl,
        debugViewAll
    };

    global.CEXTAutoLoginStorage = api;
    if (typeof window !== 'undefined') {
        window.CEXTAutoLoginStorage = api;
    }

    // postMessage 支援：在頁面 console 可用
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('message', async (event) => {
            if (!event || !event.data || event.data.type !== 'CEXT_DEBUG_VIEW_ALL') return;
            try {
                const data = await debugViewAll();
                window.postMessage({ type: 'CEXT_DEBUG_VIEW_ALL_RESULT', data }, '*');
            } catch (err) {
                window.postMessage({ type: 'CEXT_DEBUG_VIEW_ALL_RESULT', error: err?.message || String(err) }, '*');
            }
        });
    }
})(typeof self !== 'undefined' ? self : this);

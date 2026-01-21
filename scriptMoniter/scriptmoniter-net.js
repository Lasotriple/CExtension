(function () {
    const N = (self.CEXT = self.CEXT || {});
    const API_BASE = N.API_BASE;
    const STORAGE_KEY = N.STORAGE_KEY;
    const FALLBACK_LIST = N.FALLBACK_LIST;
    const defaultState = N.defaultState;

    // 通用 fetch
    N.apiFetch = async function apiFetch(path, options = {}) {
        const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

        // 設定 timeout，特別是 health 檢查
        const timeout = path === "/health" ? 1000 : 10000; // health 檢查 1 秒，其他 10 秒
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const resp = await fetch(url, {
                method: "GET",
                cache: "no-cache",
                signal: controller.signal,
                ...options
            });
            clearTimeout(timeoutId);

            const text = await resp.text();
            try {
                const json = JSON.parse(text);
                if (!resp.ok) throw new Error(json?.error || resp.statusText);
                return json;
            } catch (e) {
                if (!resp.ok) throw new Error(text || resp.statusText);
                return text;
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            // 識別 CORS 錯誤
            if (error.message && error.message.includes('CORS') ||
                error.message && error.message.includes('blocked') ||
                error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                const corsError = new Error('CORS 錯誤：無法連接到 Flask 服務。請確認：\n1. Flask 服務正在運行 (localhost:8000)\n2. Flask 服務已設定 CORS 標頭允許此來源');
                corsError.isCorsError = true;
                throw corsError;
            }
            throw error;
        }
    };

    // 解析 /getProjectList 結構（容錯）
    N.extractProjectNamesFromResponse = function extractProjectNamesFromResponse(data) {
        if (data && Array.isArray(data.projects)) {
            const arr = data.projects;
            if (arr.length > 0 && typeof arr[0] === "object") {
                return arr.map((x) => x && x.NAME).filter(Boolean);
            }
            return arr.filter((x) => typeof x === "string");
        }
        if (Array.isArray(data)) {
            if (data.length > 0 && typeof data[0] === "object") {
                return data.map((x) => x && x.NAME).filter(Boolean);
            }
            return data.filter((x) => typeof x === "string");
        }
        return [];
    };

    // single-flight：/health & /getProjectList
    let _healthOnce = null;
    N.fetchHealthOnce = function fetchHealthOnce() {
        if (!_healthOnce) {
            _healthOnce = N.apiFetch("/health").finally(() => {
                _healthOnce = null; // 允許下一輪再打
            });
        }
        return _healthOnce;
    };

    let _projectsOnce = null;
    N.fetchProjectsOnce = function fetchProjectsOnce() {
        if (!_projectsOnce) {
            _projectsOnce = N.apiFetch("/getProjectList").finally(() => {
                _projectsOnce = null;
            });
        }
        return _projectsOnce;
    };

    // 確認服務、同步 UUID（改變則重建 local）
    // 優先使用 /getProjectList 檢查服務可用性，如果失敗再嘗試 /health
    N.ensureServerAndSyncUUID = async function ensureServerAndSyncUUID() {
        let serverUuid = null;
        
        // 優先嘗試使用 getProjectList 檢查（因為 publish 功能主要依賴這個）
        try {
            const data = await N.fetchProjectsOnce();
            serverUuid = data?.uuid || null;
            // 如果 getProjectList 成功，視為服務可用
        } catch (e) {
            // getProjectList 失敗，嘗試使用 health 作為備用檢查
            console.log("[cext] getProjectList 檢查失敗，嘗試使用 health 檢查服務...");
            try {
                const h = await N.fetchHealthOnce();
                if (h && h.ok !== false) {
                    serverUuid = h.uuid || null;
                } else {
                    throw new Error("health not ok");
                }
            } catch (e2) {
                // 兩個都失敗，拋出錯誤
                throw new Error("無法連接到服務（getProjectList 和 health 都失敗）");
            }
        }

        const s = await N.loadState();

        if (serverUuid && s.serverUuid && s.serverUuid !== serverUuid) {
            const rebuilt = { ...defaultState, serverUuid };
            await new Promise((r) => chrome.storage.local.set({ [STORAGE_KEY]: rebuilt }, r));
        } else if (serverUuid && !s.serverUuid) {
            await N.saveState({ serverUuid });
        }
    };

    // /getProjectList：進快取（UUID 改變時重建）
    N.bootstrapProjects = async function bootstrapProjects() {
        try {
            const data = await N.fetchProjectsOnce();
            const serverUuid = data?.uuid || null;
            const items = N.extractProjectNamesFromResponse(data);
            const list = items.length ? items : FALLBACK_LIST;

            const s = await N.loadState();
            if (serverUuid && s.serverUuid && s.serverUuid !== serverUuid) {
                const rebuilt = {
                    ...defaultState,
                    serverUuid,
                    projectList: list,
                    projectListTs: Date.now()
                };
                await new Promise((r) => chrome.storage.local.set({ [STORAGE_KEY]: rebuilt }, r));
            } else {
                await N.saveState({
                    serverUuid: serverUuid || s.serverUuid || null,
                    projectList: list,
                    projectListTs: Date.now()
                });
            }
        } catch (e) {
            console.warn("[cext] bootstrapProjects 失敗：", e);
            const s = await N.loadState();
            if (!s.projectList) {
                await N.saveState({ projectList: FALLBACK_LIST, projectListTs: Date.now() });
            }
        }
    };
})();


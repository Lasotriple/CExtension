(function () {
    const N = (self.CEXT = self.CEXT || {});
    const STORAGE_KEY = N.STORAGE_KEY;
    const defaultState = N.defaultState;

    N.loadState = async function loadState() {
        return new Promise((resolve) => {
            chrome.storage.local.get(STORAGE_KEY, (res) => {
                resolve({ ...defaultState, ...(res[STORAGE_KEY] || {}) });
            });
        });
    };

    N.saveState = async function saveState(patch) {
        const prev = await N.loadState();
        const next = { ...prev, ...patch };
        return new Promise((resolve) => {
            chrome.storage.local.set({ [STORAGE_KEY]: next }, () => resolve(next));
        });
    };
})();
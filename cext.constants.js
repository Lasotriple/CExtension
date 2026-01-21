(function () {
    const N = (self.CEXT = self.CEXT || {});

    /* API & Storage */
    N.API_BASE = "http://localhost:8000";
    N.STORAGE_KEY = "cext_state";

    /* Fallback 專案清單 */
    N.FALLBACK_LIST = [];

    /* 預設狀態 */
    N.defaultState = {
        projectList: null,
        panelX: 0,
        panelY: 0,
        collapsed: false,
        lastAction: null,
        lastOp: null,
        lastActor: null,
        lastTs: 0,
        serverUuid: null,
        projectListTs: 0,
        groovyApiVersion: null
    };
})();
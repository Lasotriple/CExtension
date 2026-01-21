/* 共用上下文參數初始化模組 */
(function () {
    const N = (self.CEXT = self.CEXT || {});

    /* 必要參數：domain 和 tenantName */
    var domain = null;
    var tenantName = null;

    /* 初始化函數：從 window 或傳入參數設置 */
    N.initContext = function (params) {
        if (params) {
            if (params.domain !== undefined) {
                domain = params.domain;
                window.domain = domain;
            }
            if (params.tenantName !== undefined) {
                tenantName = params.tenantName;
                window.tenantName = tenantName;
            }
        } else {
            /* 從 window 讀取已存在的值 */
            domain = window.domain || null;
            tenantName = window.tenantName || null;
        }
    };

    /* 取得 domain */
    N.getDomain = function () {
        return domain || window.domain || null;
    };

    /* 取得 tenantName */
    N.getTenantName = function () {
        return tenantName || window.tenantName || null;
    };

    /* 設置 domain */
    N.setDomain = function (value) {
        domain = value;
        window.domain = value;
    };

    /* 設置 tenantName */
    N.setTenantName = function (value) {
        tenantName = value;
        window.tenantName = value;
    };

    /* 初始化：從 window 讀取已存在的值 */
    N.initContext();
})();


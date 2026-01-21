(function () {
    const N = (self.CEXT = self.CEXT || {});

    // 初始化 IndexedDB
    async function initStorage() {
        if (typeof CEXTAutoLoginStorage === 'undefined') {
            console.warn('[autoLogin-manager] CEXTAutoLoginStorage 未載入');
            return false;
        }
        try {
            await CEXTAutoLoginStorage.init();
            return true;
        } catch (err) {
            console.error('[autoLogin-manager] 初始化儲存失敗:', err);
            return false;
        }
    }

    // 新增憑證
    async function addCredential() {
        const nameInput = document.getElementById('cext-auto-login-manage-name');
        const urlInput = document.getElementById('cext-auto-login-manage-url');
        const loginNameInput = document.getElementById('cext-auto-login-manage-loginname');
        const passwordInput = document.getElementById('cext-auto-login-manage-password');

        if (!nameInput || !urlInput || !loginNameInput || !passwordInput) {
            alert('找不到表單元素');
            return;
        }

        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        const loginName = loginNameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!name || !url || !loginName || !password) {
            alert('請填寫所有欄位');
            return;
        }

        if (!await initStorage()) {
            alert('儲存系統初始化失敗');
            return;
        }

        try {
            await CEXTAutoLoginStorage.saveCredential({
                NAME: name,
                LOGIN_URL: url,
                loginName: loginName,
                intumitPswd: password
            });

            // 清空表單
            nameInput.value = '';
            urlInput.value = '';
            loginNameInput.value = '';
            passwordInput.value = '';

            alert('新增成功');
        } catch (err) {
            console.error('[autoLogin-manager] 新增帳號失敗:', err);
            alert('新增失敗: ' + err.message);
        }
    }

    // 匯入 JSON（檔案選擇）
    function triggerImportFile() {
        const fileInput = document.getElementById('cext-auto-login-manage-import-file');
        if (fileInput) {
            fileInput.click();
        }
    }

    // 處理 JSON 檔案匯入
    async function importJSONFromFile(file) {
        if (!file) {
            return;
        }

        if (!file.name.toLowerCase().endsWith('.json')) {
            alert('請選擇 JSON 格式的檔案');
            return;
        }

        try {
            const jsonText = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error('讀取檔案失敗'));
                reader.readAsText(file, 'UTF-8');
            });

            if (!jsonText || !jsonText.trim()) {
                alert('檔案內容為空');
                return;
            }

            const credentials = JSON.parse(jsonText);

            if (!Array.isArray(credentials)) {
                alert('JSON 格式錯誤：必須是陣列格式');
                return;
            }

            if (credentials.length === 0) {
                alert('帳號陣列為空');
                return;
            }

            // 驗證每個帳號的格式
            for (const cred of credentials) {
                if (!cred.LOGIN_URL || !cred.loginName || !cred.intumitPswd) {
                    alert('帳號格式錯誤：每個帳號必須包含 LOGIN_URL、loginName 和 intumitPswd');
                    return;
                }
            }

            if (!await initStorage()) {
                alert('儲存系統初始化失敗');
                return;
            }

            // 批次新增
            await CEXTAutoLoginStorage.saveCredentials(credentials);

            alert(`成功匯入 ${credentials.length} 筆帳號`);
        } catch (err) {
            console.error('[autoLogin-manager] 匯入 JSON 失敗:', err);
            if (err instanceof SyntaxError) {
                alert('JSON 格式錯誤：' + err.message);
            } else {
                alert('匯入失敗: ' + err.message);
            }
        }
    }

    // 匯出 JSON
    async function exportJSON() {
        if (!await initStorage()) {
            alert('儲存系統初始化失敗');
            return;
        }

        try {
            const jsonText = await CEXTAutoLoginStorage.exportToJSON();

            // 建立下載連結
            const blob = new Blob([jsonText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `autoLogin_credentials_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('[autoLogin-manager] 匯出完成，已下載 JSON');
        } catch (err) {
            console.error('[autoLogin-manager] 匯出失敗:', err);
            alert('匯出失敗: ' + err.message);
        }
    }

    // 清除全部
    async function clearAll() {
        if (!confirm('確定要清除所有帳號嗎？此操作無法復原！')) {
            return;
        }

        if (!await initStorage()) {
            alert('儲存系統初始化失敗');
            return;
        }

        try {
            await CEXTAutoLoginStorage.clearAll();
            alert('清除成功');
        } catch (err) {
            console.error('[autoLogin-manager] 清除失敗:', err);
            alert('清除失敗: ' + err.message);
        }
    }

    // 清理 URL，移除 query parameters
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

    // 檢查是否為登入頁面
    function isLoginPage() {
        const pathname = window.location.pathname.toLowerCase();
        // 必須同時包含 wise 與 login
        return pathname.includes('wise') && pathname.includes('login');
    }

    // 初始化事件監聽
    N.initAutoLoginManager = function initAutoLoginManager(panel) {
        if (!panel) {
            console.warn('[autoLogin-manager] panel 元素不存在');
            return;
        }

        console.log('[autoLogin-manager] 初始化管理功能');

        // 預設填入當前登入頁面 URL（若空且為登入頁）
        const urlInput = panel.querySelector('#cext-auto-login-manage-url');
        if (urlInput && isLoginPage() && !urlInput.value.trim()) {
            urlInput.value = cleanLoginUrl(window.location.href);
        }

        // 檔案選擇事件
        const fileInput = document.getElementById('cext-auto-login-manage-import-file');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                    await importJSONFromFile(file);
                    // 清空選擇，讓同一檔案可以再次選擇
                    fileInput.value = '';
                }
            });
        }

        // 管理區域按鈕事件
        panel.addEventListener('click', async (e) => {
            const addBtn = e.target.closest('button[data-action="auto-login-manage-add"]');
            const importBtn = e.target.closest('button[data-action="auto-login-manage-import-json"]');
            const exportBtn = e.target.closest('button[data-action="auto-login-manage-export"]');
            const clearBtn = e.target.closest('button[data-action="auto-login-manage-clear"]');

            if (addBtn) {
                e.stopImmediatePropagation();
                e.preventDefault();
                await addCredential();
            } else if (importBtn) {
                e.stopImmediatePropagation();
                e.preventDefault();
                triggerImportFile();
            } else if (exportBtn) {
                e.stopImmediatePropagation();
                e.preventDefault();
                await exportJSON();
            } else if (clearBtn) {
                e.stopImmediatePropagation();
                e.preventDefault();
                await clearAll();
            }
        });
    };
})();

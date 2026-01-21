(function () {
    const N = (self.CEXT = self.CEXT || {});

    function cleanLoginUrl(url) {
        try {
            const urlObj = new URL(url);
            // 移除所有 query parameters
            urlObj.search = '';
            return urlObj.href;
        } catch (e) {
            // 如果 URL 解析失敗，嘗試簡單的字符串處理
            const index = url.indexOf('?');
            return index > -1 ? url.substring(0, index) : url;
        }
    }

    async function getCredentials(cleanUrl) {
        // 優先從 chrome.storage（全域）讀取
        if (typeof CEXTAutoLoginStorage !== 'undefined' && CEXTAutoLoginStorage.isSupported()) {
            try {
                await CEXTAutoLoginStorage.init();
                const credential = await CEXTAutoLoginStorage.getCredentialByUrl(cleanUrl);
                if (credential && credential.loginName && credential.intumitPswd) {
                    return {
                        loginName: credential.loginName,
                        intumitPswd: credential.intumitPswd
                    };
                }
            } catch (err) {
                console.warn('[autoLogin] 從 storage 讀取帳號失敗:', err);
            }
        }
        // 未取得則回傳 null
        return null;
    }

    function isLoginPage() {
        const pathname = window.location.pathname.toLowerCase();
        // 必須同時包含 wise 與 login，避免非登入頁面誤觸
        return pathname.includes('wise') && pathname.includes('login');
    }

    N.checkAutoLoginUrlAvailable = async function checkAutoLoginUrlAvailable(isLogin) {
        // 只要是 login 頁面就顯示 AutoLogin 按鈕（不需要檢查是否有憑證）
        // 用戶可以手動輸入帳號密碼，或透過管理介面新增憑證
        if (!isLogin || !isLoginPage()) {
            return false;
        }
        // 所有 wise login 頁面都顯示 AutoLogin 按鈕
        return true;
    };

    N.handleAutoLogin = async function handleAutoLogin(autoLoginBtn) {
        if (!autoLoginBtn) {
            return;
        }

        // 再次確認是否為登入頁面，防止在非登入頁面執行
        if (!isLoginPage()) {
            alert("當前頁面不是登入頁面，無法執行自動登入");
            return;
        }

        try {
            autoLoginBtn.disabled = true;
            autoLoginBtn.textContent = "登入中...";

            /* 步驟 1: 獲取當前 URL 和 domain */
            const currentUrl = window.location.href;
            const domain = window.location.origin;

            // 清理 URL，移除 query parameters
            const cleanUrl = cleanLoginUrl(currentUrl);

            /* 步驟 1: 優先從輸入框讀取帳號密碼，沒有才從全域儲存讀取 */
            let loginName, intumitPswd;

            // 嘗試從輸入框獲取
            const usernameInput = document.querySelector('#cext-auto-login-username');
            const passwordInput = document.querySelector('#cext-auto-login-password');

            if (usernameInput && usernameInput.value.trim() && passwordInput && passwordInput.value.trim()) {
                // 使用輸入框的值
                loginName = usernameInput.value.trim();
                intumitPswd = passwordInput.value.trim();
            } else {
                // 優先從全域儲存讀取
                const credentialsResponse = await getCredentials(cleanUrl);

                if (!credentialsResponse || !credentialsResponse.loginName || !credentialsResponse.intumitPswd) {
                    throw new Error("請在上方輸入框輸入帳號密碼，或點擊「管理帳號」新增對應的登入資訊");
                }

                loginName = credentialsResponse.loginName;
                intumitPswd = credentialsResponse.intumitPswd;
            }

            /* 步驟 2: 建立 session，使用清理後的 URL + 帳號 + 密碼進行登入 */
            // 使用清理後的 URL 作為登入端點
            const loginUrl = cleanUrl;

            // 獲取語言設定
            const selectedLocale = document.querySelector('select[name="selectedLocale"]')?.value || 'zh_TW';

            /* 步驟 2: 使用清理後的 URL + 帳號 + 密碼進行登入 */
            // 使用 POST 請求登入，credentials: 'include' 會自動處理 cookie
            const loginResponse = await fetch(loginUrl, {
                method: 'POST',
                credentials: 'include', // 重要：包含 cookie，瀏覽器會自動保存
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    loginName: loginName,
                    intumitPswd: intumitPswd,
                    selectedLocale: selectedLocale
                })
            });

            // 檢查登入是否成功（200 或 302 都認為成功）
            if (!loginResponse.ok && loginResponse.status !== 302) {
                const errorText = await loginResponse.text().catch(() => '無法讀取錯誤訊息');
                throw new Error(`登入失敗，狀態碼: ${loginResponse.status}, 錯誤: ${errorText}`);
            }

            /* 步驟 3: 登入成功，cookie 已自動塞入當前網頁（因為使用了 credentials: 'include'） */

            /* 步驟 4: 根據登入 URL 類型決定是否跳轉 */
            const urlPath = new URL(cleanUrl).pathname;
            // 檢查是否為 subadmin 登入頁面格式: /wise/wiseadm/s/subadmin/{id}/login
            const subadminLoginPattern = /^\/wise\/wiseadm\/s\/subadmin\/[^\/]+\/login$/;

            if (subadminLoginPattern.test(urlPath)) {
                // 只有 subadmin 登入頁面才導向 qaAdmin.jsp
                const targetUrl = `${domain}/wise/wiseadm/qaAdmin.jsp`;
                window.location.href = targetUrl;
            } else {
                const targetUrl = `${domain}/wise/wiseadm/s/robotBackend`;
                window.location.href = targetUrl;
            }
        } catch (err) {
            alert("自動登入失敗: " + (err?.message || err));
        } finally {
            autoLoginBtn.disabled = false;
            autoLoginBtn.textContent = "自動登入";
        }
    };

    // 讓原生登入按鈕改呼叫 AutoLogin
    function hijackNativeLoginButton() {
        if (!isLoginPage()) return;
        const nativeBtn = document.querySelector('a.btn.btnlogin.js-login');
        if (!nativeBtn || nativeBtn.dataset.cextHijacked === '1') return;
        nativeBtn.dataset.cextHijacked = '1';
        nativeBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            // 優先使用頁面原生輸入框的值
            const pageUsername = document.querySelector('input[name="loginName"]')?.value?.trim();
            const pagePassword = document.querySelector('input[name="intumitPswd"]')?.value?.trim();

            if (pageUsername && pagePassword) {
                // 將頁面輸入複製到面板輸入框後再呼叫 AutoLogin
                const panelUsername = document.querySelector('#cext-auto-login-username');
                const panelPassword = document.querySelector('#cext-auto-login-password');
                if (panelUsername) panelUsername.value = pageUsername;
                if (panelPassword) panelPassword.value = pagePassword;

                // 若尚未有此 URL 的帳號紀錄，嘗試自動保存一份（避免重複則略過）
                try {
                    if (typeof CEXTAutoLoginStorage !== 'undefined' && CEXTAutoLoginStorage.isSupported()) {
                        await CEXTAutoLoginStorage.init();
                        const currentUrl = cleanLoginUrl(window.location.href);
                        const existing = await CEXTAutoLoginStorage.getCredentialByUrl(currentUrl);
                        if (!existing) {
                            const name = (document.title || window.location.hostname || 'AutoSaved').trim().slice(0, 80);
                            await CEXTAutoLoginStorage.saveCredential({
                                NAME: name || 'AutoSaved',
                                LOGIN_URL: currentUrl,
                                loginName: pageUsername,
                                intumitPswd: pagePassword
                            });
                            console.log('[autoLogin] 已自動保存原生登入帳號（新 URL）');
                        }
                    }
                } catch (saveErr) {
                    console.warn('[autoLogin] 自動保存原生登入帳號失敗：', saveErr);
                }

                const autoLoginBtn = document.querySelector('button[data-action="auto-login"]');
                await N.handleAutoLogin(autoLoginBtn || nativeBtn);
            } else {
                // 原生欄位沒填就不動作（也不觸發原生登入）
                console.warn('[autoLogin] 原生登入欄位未填寫，已阻止原生登入');
            }
        }, true); // capture，避免被原生事件攔截
    }

    // 啟用攔截，並監聽 DOM 變化以防頁面重繪
    hijackNativeLoginButton();
    const hijackObserver = new MutationObserver(() => hijackNativeLoginButton());
    hijackObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
})();
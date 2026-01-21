(function () {
    const N = (self.CEXT = self.CEXT || {});

    N.ensurePanelLoaded = async function ensurePanelLoaded(flaskAvailable = false) {
        let panel = document.getElementById("cext-panel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "cext-panel";
            document.body.appendChild(panel);
        }

        /* 只載入一次 panel.html */
        if (!panel.dataset.loaded) {
            const url = chrome.runtime.getURL("panel.html");
            const res = await fetch(url);
            if (!res.ok) throw new Error("載入 panel.html 失敗");
            const html = await res.text();
            panel.innerHTML = html;
            panel.dataset.loaded = "1";
        }

        /* 根據 Flask 狀態控制 Flask 功能區塊的顯示 */
        const flaskFeaturesDiv = panel.querySelector("#cext-flask-features");
        if (flaskFeaturesDiv) {
            if (flaskAvailable) {
                flaskFeaturesDiv.style.display = '';
            } else {
                flaskFeaturesDiv.style.display = 'none';
            }
        }

        /* 確保右側展開把手存在 */
        let edgeHandle = document.getElementById("cext-expand-handle");
        if (!edgeHandle) {
            edgeHandle = document.createElement("button");
            edgeHandle.id = "cext-expand-handle";
            edgeHandle.className = "cext-expand-handle";
            edgeHandle.title = "展開";
            document.body.appendChild(edgeHandle);
        }

        /* 常用 DOM refs（給 main 使用） */
        const refs = {
            selectArea: panel.querySelector(".cext-select-area"),
            select: panel.querySelector("#cext-select"),
            submitBtn: panel.querySelector("#cext-submit"),
            collapseHandle: panel.querySelector(".cext-collapse-handle"),
            extraArea: panel.querySelector(".cext-extra-area"),
            tsInput: panel.querySelector("#cext-timestamp"),
            handle: panel.querySelector(".cext-drag-handle"),
            edgeHandle,
            /* Flask 相關的按鈕 */
            publishBtn: panel.querySelector('button[data-action="publish"]'),
            toggleBtn: panel.querySelector('button[data-action="toggle"]'),
            tabGroup: panel.querySelector('.cext-tab-group'),
            flaskFeaturesDiv: panel.querySelector("#cext-flask-features"),
            pendingSection: panel.querySelector("#cext-batch-pending"),
            pendingList: panel.querySelector("#cext-batch-pending-list"),
            /* Synchronous 相關的 select */
            selectSrc: panel.querySelector("#cext-select-src"),
            selectDst: panel.querySelector("#cext-select-dst"),
            syncSelects: panel.querySelector(".cext-sync-selects"),
            /* AutoLogin 相關的元素 */
            autoLoginFeaturesDiv: panel.querySelector("#cext-auto-login-features"),
            autoLoginUsername: panel.querySelector("#cext-auto-login-username"),
            autoLoginPassword: panel.querySelector("#cext-auto-login-password"),
            autoLoginArea: panel.querySelector(".cext-auto-login-area")
        };

        return { panel, refs };
    };
})();
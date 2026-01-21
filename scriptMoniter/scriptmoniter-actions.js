(function () {
    const N = (self.CEXT = self.CEXT || {});

    // API 路徑 & 小工具
    const actionMap = {
        pass: (p) => `/pass?projectName=${encodeURIComponent(p)}`,
        deploy: (p) => `/deploy?projectName=${encodeURIComponent(p)}`,
        synchronous: (srcName, dstName) => `/sync?srcName=${encodeURIComponent(srcName)}&dstName=${encodeURIComponent(dstName)}`
    };
    function addQueryParam(url, key, val) {
        if (!val) return url;
        const sep = url.includes("?") ? "&" : "?";
        return url + sep + encodeURIComponent(key) + "=" + encodeURIComponent(val);
    }


    /**
     * 綁定面板動作（tab 點擊 + Submit）
     */
    N.bindActions = function bindActions({ panel, refs, getSessionId }) {
        const { selectArea, select, submitBtn, extraArea, tsInput } = refs;

        // Tab 點擊（設定 lastAction / shiftMode + 還原 UI）
        panel.addEventListener("click", async (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            if (!['pass', 'deploy', 'synchronous'].includes(action)) return;

            await N.saveState({
                lastAction: action,
                lastOp: "action",
                lastActor: getSessionId && getSessionId(),
                lastTs: Date.now()
            });

            // 先清掉所有 tab 的紫色
            panel.querySelectorAll(".cext-tab-group .cext-tab").forEach(b => b.classList.remove("shift-mode"));

            await N.restoreActionUI({ panel, refs, action });
        });

        // 抽出提交流程，提供 click 與 Enter 共用
        const doSubmit = async () => {
            const s = await N.loadState();
            const action = s.lastAction;
            if (!action) return;

            let path;
            if (action === 'synchronous') {
                // synchronous 需要兩個專案名稱
                const srcSelected = refs.selectSrc?.value;
                const dstSelected = refs.selectDst?.value;
                if (!srcSelected) return alert("請先選擇來源專案");
                if (!dstSelected) return alert("請先選擇目標專案");
                path = actionMap[action](srcSelected, dstSelected);
            } else {
                // pass 和 deploy 只需要一個專案名稱
                const selected = select?.value;
                if (!selected) return alert("請先選擇專案");
                path = actionMap[action](selected);
            }

            try {
                submitBtn.disabled = true;
                submitBtn.textContent = "處理中...";

                const res = await N.apiFetch(path);
                console.log(`[cext] ${action} 結果:`, res);

                // 更新專案順位：把剛操作的擺到最前
                const state = await N.loadState();
                let list = state.projectList || (N.FALLBACK_LIST || []).slice();
                if (action === 'synchronous') {
                    const srcSelected = refs.selectSrc?.value;
                    const dstSelected = refs.selectDst?.value;
                    if (srcSelected) {
                        list = list.filter(p => p !== srcSelected);
                        list.unshift(srcSelected);
                    }
                    if (dstSelected && dstSelected !== srcSelected) {
                        list = list.filter(p => p !== dstSelected);
                        list.splice(1, 0, dstSelected);
                    }
                } else {
                    const selected = select?.value;
                    if (selected) {
                        list = list.filter(p => p !== selected);
                        list.unshift(selected);
                    }
                }
                await N.saveState({ projectList: list });

            } catch (err) {
                console.error(err);
                alert(`${action} 失敗: ` + (err?.message || err));
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "送出";
            }
        };

        // Click 綁定
        submitBtn.onclick = doSubmit;

        // Enter 提交（IME/組字、修飾鍵、Textarea、長按重複皆忽略）
        panel.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;

            const tag = (e.target.tagName || "").toLowerCase();
            if (tag === "textarea") return;

            // 若有 disable 中就不送
            if (submitBtn.disabled) return;

            e.preventDefault();
            doSubmit();
        });
    };

})();


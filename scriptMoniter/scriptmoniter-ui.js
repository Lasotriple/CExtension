(function () {
    const N = (self.CEXT = self.CEXT || {});
    const FALLBACK_LIST = N.FALLBACK_LIST;

    // 併發防護：避免重複渲染 select options
    let _renderingOptions = false;

    // Tab 樣式切換
    N.setActiveTab = function setActiveTab(panel, btn) {
        if (!panel) return;
        panel.querySelectorAll(".cext-tab-group .cext-tab").forEach(b => {
            b.classList.remove("active");
            b.classList.add("inactive");
        });
        if (btn) {
            btn.classList.add("active");
            btn.classList.remove("inactive");
        }
    };

    // 渲染 select options（只吃快取，不打 API）
    N.renderProjectOptions = async function renderProjectOptions({ select }) {
        if (_renderingOptions) return;
        _renderingOptions = true;
        try {
            if (!select) return;
            select.innerHTML = "";
            const s = await N.loadState();
            const raw = s.projectList || FALLBACK_LIST;
            const list = Array.from(new Set((raw || []).filter(Boolean)));
            for (const p of list) {
                const opt = document.createElement("option");
                opt.value = p;
                opt.textContent = p;
                select.appendChild(opt);
            }
        } finally {
            _renderingOptions = false;
        }
    };

    // 還原／套用 lastAction 的 UI（不打 API）
    N.restoreActionUI = async function restoreActionUI({ panel, refs, action }) {
        if (!panel || !refs) return;
        const { selectArea, extraArea, select, selectSrc, selectDst, syncSelects } = refs;

        const cur = action || null;
        if (!cur) {
            N.setActiveTab(panel, null);
            if (selectArea) selectArea.style.display = "none";
            if (extraArea) extraArea.style.display = "none";
            if (syncSelects) syncSelects.style.display = "none";
            if (select) select.style.display = "";
            return;
        }

        const btn = panel.querySelector(`button[data-action="${cur}"]`);
        if (btn) N.setActiveTab(panel, btn);

        if (selectArea) selectArea.style.display = "flex";

        // synchronous 需要兩個 select，其他只需要一個
        if (cur === 'synchronous') {
            if (select) select.style.display = "none";
            if (syncSelects) syncSelects.style.display = "flex";
            if (selectSrc) await N.renderProjectOptions({ select: selectSrc });
            if (selectDst) await N.renderProjectOptions({ select: selectDst });
        } else {
            if (select) select.style.display = "";
            if (syncSelects) syncSelects.style.display = "none";
            await N.renderProjectOptions({ select });
        }
    };
})();


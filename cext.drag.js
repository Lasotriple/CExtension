(function () {
    const N = (self.CEXT = self.CEXT || {});

    N.initDrag = function initDrag(opts) {
        const panel = opts.panel;
        const handle = opts.handle;
        const getSessionId = typeof opts.getSessionId === "function" ? opts.getSessionId : () => null;

        if (!panel || !handle) return;

        let isDown = false;
        let sx = 0, sy = 0;
        let ox = 0, oy = 0;
        let pendingRAF = null;
        let nextLeft = 0, nextTop = 0;

        /* 拖曳時暫停動畫、避免誤選文字 */
        const disableTransition = () => { panel.style.transition = "none"; };
        const enableTransition = () => { panel.style.transition = ""; };
        const freezeSelect = () => { document.documentElement.style.userSelect = "none"; };
        const unfreezeSelect = () => { document.documentElement.style.userSelect = ""; };

        const applyMove = () => {
            panel.style.right = "auto";
            panel.style.left = nextLeft + "px";
            panel.style.top = nextTop + "px";
            pendingRAF = null;
        };

        const onMove = (ev) => {
            if (!isDown) return;
            const pt = ev.touches ? ev.touches[0] : ev;
            nextLeft = ox + (pt.clientX - sx);
            nextTop = oy + (pt.clientY - sy);
            if (!pendingRAF) pendingRAF = requestAnimationFrame(applyMove);
            /* 只在真正拖曳時阻止默認行為，避免影響頁面其他元素 */
            if (ev.cancelable && isDown) {
                ev.preventDefault();
            }
        };

        const onUp = async () => {
            if (!isDown) return;
            isDown = false;

            /* 立即移除事件監聽器和恢復狀態，避免影響頁面其他元素 */
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.removeEventListener("touchmove", onMove, { passive: false });
            document.removeEventListener("touchend", onUp);

            /* 立即恢復 userSelect，確保不影響頁面其他元素 */
            unfreezeSelect();
            enableTransition();

            /* 儲存位置 */
            try {
                await N.saveState({
                    panelX: nextLeft,
                    panelY: nextTop,
                    lastOp: "move",
                    lastActor: getSessionId(),
                    lastTs: Date.now()
                });
            } catch (e) {
                console.warn("[cext.drag] saveState 失敗：", e);
            }
        };

        /* 確保在頁面卸載或發生錯誤時恢復狀態 */
        const cleanup = () => {
            if (isDown) {
                isDown = false;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.removeEventListener("touchmove", onMove, { passive: false });
                document.removeEventListener("touchend", onUp);
                unfreezeSelect();
                enableTransition();
            }
        };

        /* 監聽頁面卸載事件，確保狀態恢復（只添加一次，避免重複添加） */
        if (!window.__CEXT_DRAG_CLEANUP_ADDED__) {
            window.__CEXT_DRAG_CLEANUP_ADDED__ = true;
            window.addEventListener("beforeunload", () => {
                /* 清理所有可能的拖曳狀態 */
                if (document.documentElement.style.userSelect === "none") {
                    document.documentElement.style.userSelect = "";
                }
            });
        }

        const onDown = (ev) => {
            /* 確保點擊事件只在拖曳手把上啟動，不影響其他元素 */
            if (!handle.contains(ev.target)) {
                return;
            }

            isDown = true;
            const rect = panel.getBoundingClientRect();
            const pt = ev.touches ? ev.touches[0] : ev;
            sx = pt.clientX;
            sy = pt.clientY;
            ox = rect.left;
            oy = rect.top;

            disableTransition();
            freezeSelect();

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.addEventListener("touchmove", onMove, { passive: false });
            document.addEventListener("touchend", onUp);

            /* 避免拖曳起始就選中文字 */
            if (ev.cancelable) ev.preventDefault();
        };

        handle.addEventListener("mousedown", onDown);
        handle.addEventListener("touchstart", onDown, { passive: false });
    };
})();
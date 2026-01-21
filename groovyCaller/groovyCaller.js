/* 新版 API 呼叫函數 */
async function callNewApi(customScript) {
    const CEXT = self.CEXT || window.CEXT;
    if (!CEXT) {
        throw new Error("CEXT 物件不存在");
    }

    const domain = CEXT.getDomain();
    if (!domain) {
        throw new Error("Domain 不存在");
    }

    const urlNew = `${domain}/wise/wiseadm/s/script/testScript?qaChannel=web&qaUserType=unknown`;
    const payloadNew = {
        scriptConfigForEditor: customScript
    };

    const resNew = await fetch(urlNew, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadNew)
    });

    if (resNew.status === 200) {
        const result = await resNew.json();

        let parsedResult;
        if (typeof result.result === "string") {
            const trimmed = result.result.trim();
            if (
                (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                (trimmed.startsWith("[") && trimmed.endsWith("]"))
            ) {
                try {
                    parsedResult = JSON.parse(result.result);
                } catch (e) {
                    parsedResult = result.result;
                }
            } else {
                parsedResult = result.result;
            }
        } else {
            parsedResult = result.result;
        }

        return parsedResult;
    }

    const errorText = await resNew.text().catch(() => "");
    const status = resNew.status;
    const message = errorText
        ? `新版 API 返回狀態碼: ${status}，錯誤內容: ${errorText.substring(0, 500)}`
        : `新版 API 返回狀態碼: ${status}`;
    throw new Error(message);
}

/* 舊版 API 呼叫函數 */
async function callOldApi(customScript) {
    const CEXT = self.CEXT || window.CEXT;
    if (!CEXT) {
        throw new Error("CEXT 物件不存在");
    }

    const domain = CEXT.getDomain();
    if (!domain) {
        throw new Error("Domain 不存在");
    }

    const urlOld = `${domain}/wise/wiseadm/qaScriptEditor-ajax.jsp?action=test`;

    const postData = {
        action: "save",
        uuid: crypto.randomUUID(),
        scriptType: "SCRIPT",
        customScript: customScript,
        qaChannel: "web",
        qaUserType: "unknown",
        scriptRturnObj: "collected",
        urlTarget: "USER_INPUT"
    };

    const resOld = await fetch(urlOld, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(postData)
    });

    if (resOld.status === 200) {
        const raw = await resOld.text();

        let outer;
        try {
            outer = JSON.parse(raw);
        } catch (parseError) {
            throw new Error(
                `舊版 API 回應不是有效的 JSON: ${parseError.message}`
            );
        }

        let parsedResult;
        if (typeof outer.result === "string") {
            const trimmed = outer.result.trim();
            if (
                (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                (trimmed.startsWith("[") && trimmed.endsWith("]"))
            ) {
                try {
                    parsedResult = JSON.parse(outer.result);
                } catch (e) {
                    parsedResult = outer.result;
                }
            } else {
                parsedResult = outer.result;
            }
        } else {
            parsedResult = outer.result;
        }

        return parsedResult;
    }

    const errorText = await resOld.text().catch(() => "");
    const status = resOld.status;
    const message = errorText
        ? `舊版 API 返回狀態碼: ${status}，錯誤內容: ${errorText.substring(0, 500)}`
        : `舊版 API 返回狀態碼: ${status}`;
    throw new Error(message);
}

/* Groovy API 呼叫函數 */
async function groovyCaller(customScript) {
    const CEXT = self.CEXT || window.CEXT;
    if (!CEXT) {
        throw new Error("CEXT 物件不存在");
    }

    const domain = CEXT.getDomain();
    if (!domain) {
        throw new Error("Domain 尚未初始化，請等待父視窗傳遞");
    }

    const state = await CEXT.loadState();
    const preferOld = state && state.groovyApiVersion === "old";

    async function tryCall(version, fn) {
        try {
            const result = await fn(customScript);

            await CEXT.saveState({
                groovyApiVersion: version,
            });

            return result;
        } catch (e) {
            /* 失敗就回 null，讓外層決定 fallback */
            return null;
        }
    }

    if (preferOld) {
        /* 上次成功是舊版：先試舊版，再一定試一次新版 */
        const oldResult = await tryCall("old", callOldApi);
        if (oldResult !== null && oldResult !== undefined) {
            return oldResult;
        }

        const newResult = await tryCall("new", callNewApi);
        if (newResult !== null && newResult !== undefined) {
            return newResult;
        }
    } else {
        /* 初次或上次成功是新版：先試新版，再試舊版 */
        const newResult = await tryCall("new", callNewApi);
        if (newResult !== null && newResult !== undefined) {
            return newResult;
        }

        const oldResult = await tryCall("old", callOldApi);
        if (oldResult !== null && oldResult !== undefined) {
            return oldResult;
        }
    }

    throw new Error("新版和舊版 API 都失敗");
}

/* 載入 Groovy 檔案 */
function loadGroovyFileSync(relativePath, jsonOutput = null) {
    const fullPath = `groovyCaller/${relativePath}`;
    const url = chrome.runtime.getURL(fullPath);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send(null);
    if (xhr.status === 200) {
        let response = xhr.responseText;
        if (jsonOutput) {
            response = response.replace("$jsonOutput$", jsonOutput);
        }
        return response;
    }
    return "";
}

function getTenantName() {
    return loadGroovyFileSync("groovyFile/getTenantName.groovy");
}

function getTenantApi() {
    return loadGroovyFileSync("groovyFile/getTenantApi.groovy");
}

function getQAMatchingRuleList() {
    return loadGroovyFileSync("groovyFile/getQAMatchingRuleList.groovy");
}

function getLogsSize() {
    return loadGroovyFileSync("groovyFile/getLogsSize.groovy");
}

function getAOAI(model, prompt, replaceMap = {}) {
    let finalPrompt = prompt;
    Object.keys(replaceMap).forEach(key => {
        finalPrompt = finalPrompt.replaceAll(`$${key}$`, replaceMap[key] ?? "");
    });

    const jsonOutput = JSON.stringify({
        model: model,
        prompt: finalPrompt
    });

    return loadGroovyFileSync(
        "groovyFile/getAOAI.groovy"
        , jsonOutput);
}

function getIdByQuestion(questions) {
    const jsonOutput = JSON.stringify({
        questions: questions
    });

    return loadGroovyFileSync("groovyFile/getIdByQuestion.groovy", jsonOutput);
}

function getQuestionById(ids) {
    const jsonOutput = JSON.stringify({
        ids: ids
    });

    return loadGroovyFileSync("groovyFile/getQuestionById.groovy", jsonOutput);
}

function getLogsTail(offset, length) {
    const jsonOutput = JSON.stringify({
        offset: offset,
        length: length,
    });

    return loadGroovyFileSync("groovyFile/getLogsTail.groovy", jsonOutput);
}

function getIdQuestionMap() {
    return loadGroovyFileSync("groovyFile/getIdQuestionMAp.groovy");
}
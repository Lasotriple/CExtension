/* 文件查找邏輯 */
function getLogFilePaths() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const todayStr = formatDate(today);
    const yesterdayStr = formatDate(yesterday);

    return [
        `${LOG_BASE_PATH}/catalina.out`,
        `${LOG_BASE_PATH}/catalina.out.${todayStr}.log`,
        `${LOG_BASE_PATH}/catalina.out.${yesterdayStr}.log`,
    ];
}
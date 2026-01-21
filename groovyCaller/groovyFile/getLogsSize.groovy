import groovy.json.JsonOutput;
import groovy.json.JsonSlurper;
import java.io.File;
import java.text.SimpleDateFormat;

// 嘗試 tomcat10 和 tomcat9 路徑
def basePaths = [
    "/SRM/SmartRobot/tomcat10/logs",
    "/SRM/SmartRobot/tomcat9/logs"
]

def catalinaPath = null
def catalinaSize = 0L

// 遍歷所有可能的基礎路徑
for (def basePath : basePaths) {
    def catalinaFile = new File("${basePath}/catalina.out")
    
    // 如果 catalina.out 存在且大小 > 0，直接使用
    if (catalinaFile.exists() && catalinaFile.length() > 0L) {
        catalinaPath = "${basePath}/catalina.out"
        catalinaSize = catalinaFile.length()
        break
    }
    
    // 如果 catalina.out 不存在或大小為 0，查找帶日期的日誌文件
    if (!catalinaFile.exists() || catalinaFile.length() == 0L) {
        def logDir = new File(basePath)
        if (logDir.exists() && logDir.isDirectory()) {
            // 獲取今天的日期和昨天的日期
            def today = new Date()
            def yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
            def sdf = new SimpleDateFormat("yyyy-MM-dd")
            def todayStr = sdf.format(today)
            def yesterdayStr = sdf.format(yesterday)
            
            // 優先順序：今天的日期 > 昨天的日期 > 其他最新日期
            def candidatePatterns = [
                "${basePath}/catalina.out.${todayStr}.log",
                "${basePath}/catalina.out.${yesterdayStr}.log"
            ]
            
            // 先檢查今天的和昨天的
            for (def pattern : candidatePatterns) {
                def candidateFile = new File(pattern)
                if (candidateFile.exists() && candidateFile.length() > 0L) {
                    if (catalinaPath == null || candidateFile.lastModified() > new File(catalinaPath).lastModified()) {
                        catalinaPath = pattern
                        catalinaSize = candidateFile.length()
                    }
                }
            }
            
            // 如果還沒找到，查找所有帶日期的日誌文件，選擇最新的
            if (catalinaPath == null) {
                def logFiles = logDir.listFiles({ File dir, String name ->
                    return name.matches(/catalina\.out\.\d{4}-\d{2}-\d{2}\.log/)
                } as java.io.FileFilter)
                
                if (logFiles != null && logFiles.length > 0) {
                    // 按修改時間排序，選擇最新的
                    def latestFile = logFiles.max { it.lastModified() }
                    if (latestFile.length() > 0L) {
                        catalinaPath = latestFile.getAbsolutePath()
                        catalinaSize = latestFile.length()
                    }
                }
            }
        }
    }
    
    // 如果已經找到有效的日誌文件，跳出循環
    if (catalinaPath != null && catalinaSize > 0L) {
        break
    }
}

// 如果都沒找到，使用第一個基礎路徑的 catalina.out（即使大小為 0）
if (catalinaPath == null) {
    catalinaPath = "${basePaths[0]}/catalina.out"
    catalinaSize = 0L
}

return JsonOutput.toJson([
    newSize      : catalinaSize,
    catalinaPath : catalinaPath
])
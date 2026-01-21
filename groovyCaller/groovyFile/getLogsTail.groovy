import groovy.json.JsonOutput;
import groovy.json.JsonSlurper;
import java.io.File;
import java.text.SimpleDateFormat;

def jsonStr = '$jsonOutput$'
def parsed  = new JsonSlurper().parseText(jsonStr)

def offset = parsed.offset
def length = parsed.length

// 嘗試 tomcat10 和 tomcat9 路徑
def basePaths = [
    "/SRM/SmartRobot/tomcat10/logs",
    "/SRM/SmartRobot/tomcat9/logs"
]

def catalinaPath = null

// 遍歷所有可能的基礎路徑，使用與 getLogsSize 相同的邏輯查找文件
for (def basePath : basePaths) {
    def catalinaFile = new File("${basePath}/catalina.out")
    
    // 如果 catalina.out 存在且大小 > 0，直接使用
    if (catalinaFile.exists() && catalinaFile.length() > 0L) {
        catalinaPath = "${basePath}/catalina.out"
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
                    }
                }
            }
        }
    }
    
    // 如果已經找到有效的日誌文件，跳出循環
    if (catalinaPath != null) {
        break
    }
}

// 如果都沒找到，使用第一個基礎路徑的 catalina.out
if (catalinaPath == null) {
    catalinaPath = "${basePaths[0]}/catalina.out"
}

def catalinaFile = new File(catalinaPath)

long fileLen = catalinaFile.exists() ? catalinaFile.length() : 0L
long start = Math.max(0L, Math.min(offset as Long, fileLen))
long len   = Math.max(0L, Math.min(length as Long, fileLen - start))
String content = ""
if (len > 0L) {
  def raf = new RandomAccessFile(catalinaFile, "r")
  raf.seek(start)
  byte[] buf = new byte[(int)len]
  raf.readFully(buf)
  raf.close()
  content = new String(buf, "UTF-8")
  if (!content.isEmpty() && !content.endsWith("\n")) {
    int idx = content.lastIndexOf("\n")
    content = (idx >= 0) ? content.substring(0, idx + 1) : ""
  }
}

return JsonOutput.toJson([
  offset: start, 
  length: len, 
  content: content
])
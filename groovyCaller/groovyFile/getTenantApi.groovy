import org.hibernate.Session;
import java.sql.Connection;
import com.intumit.hibernate.HibernateUtil;
import groovy.json.JsonOutput;

def fetchAllData(String tableName, Integer tenantId) {
  def results = []
  def session = HibernateUtil.getSession()
  try {
    session.doWork { Connection con ->
      def sql = "SELECT * FROM " + tableName + " WHERE tenantId = ?"
      def pstmt = con.prepareStatement(sql)
      pstmt.setInt(1, tenantId)
      def rs = pstmt.executeQuery()
      def meta = rs.metaData
      while (rs.next()) {
        def row = [:]
        (1..meta.columnCount).each { i ->
          row[meta.getColumnName(i)] = rs.getObject(i)
        }
        results << row
      }
    }
  } finally {
    session?.close()
  }
  results
}

def tableName = "Apikey"
def result = fetchAllData(tableName, ctx.getTenant().getId())

return JsonOutput.toJson([
  apikeys: result ?: []
])
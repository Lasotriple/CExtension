import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import org.apache.solr.client.solrj.SolrQuery

def getQuestionById(List ids) {
  def core = ctx.getTenant().getCoreServer4Write()

  def sq = new SolrQuery("dataType_s:COMMON_SENSE")
  sq.setRows(9999999)

  def docs = core.query(sq).getResults()

  def kidToQuestion = [:]
  docs.each { d ->
    def q = (d.get("QUESTION_t") ?: "").toString().trim()
    def kid = d.get("kid_l")

    if (q && kid != null) {
      kidToQuestion[kid] = q
    }
  }

  /* 查詢 */
  def idToQuestionMap = [:]

  ids.each { id ->
    if (!id) return

    def longId = (id instanceof Number) ? id.longValue() : id.toString().trim().toLong()

    if (kidToQuestion.containsKey(longId)) {
      idToQuestionMap[id] = kidToQuestion[longId]
    }
  }

  return [
    idToQuestionMap: idToQuestionMap
  ]
}

/* === 讀入 JSON === */
def jsonStr = '$jsonOutput$'
def parsed  = new JsonSlurper().parseText(jsonStr)

def ids = parsed.ids
def result = getQuestionById(ids)

return JsonOutput.toJson(result)
import groovy.json.JsonOutput
import org.apache.solr.client.solrj.SolrQuery

def getIdQuestionMap() {
  def core = ctx.getTenant().getCoreServer4Write()

  def sq = new SolrQuery("dataType_s:COMMON_SENSE")
  sq.setRows(9999999)

  def docs = core.query(sq).getResults()

  def idToQuestionMap = [:]

  docs.each { d ->
    def q   = (d.get("QUESTION_t") ?: "").toString().trim()
    def kid = d.get("kid_l")

    if (q && kid != null) {
      idToQuestionMap[kid] = q
    }
  }

  return [
    idToQuestionMap: idToQuestionMap
  ]
}

return JsonOutput.toJson(getIdQuestionMap())
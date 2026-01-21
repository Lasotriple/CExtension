import groovy.json.JsonOutput;
import groovy.json.JsonSlurper;
import org.apache.solr.client.solrj.SolrQuery;

def getIdByQuestion(List<String> questions) {
  def core = ctx.getTenant().getCoreServer4Write()

  def sq = new SolrQuery("dataType_s:COMMON_SENSE")
  sq.setRows(9999999)

  def docs = core.query(sq).getResults()

  def stdMap = [:]
  docs.each { d ->
    def q = (d.get("QUESTION_t") ?: "")
    .toString()
    .trim()
    .toLowerCase()

    def kid = d.get("kid_l")

    if (q && kid != null) {
      stdMap[q] = kid
    }
  }

  def questionToKidMap = [:]
  questions.each { q ->
    if (!q) return
      def key = q.trim().toLowerCase()
      if (stdMap[key] != null) {
        questionToKidMap[q] = stdMap[key]
      }
  }

  return [
    questionToKidMap: questionToKidMap
  ]
}

def jsonStr = '$jsonOutput$'
def parsed  = new JsonSlurper().parseText(jsonStr)

def questions = parsed.questions
def result = getIdByQuestion(questions)

return JsonOutput.toJson(result)
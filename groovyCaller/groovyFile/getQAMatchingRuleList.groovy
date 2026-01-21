import groovy.json.JsonSlurper;
import groovy.json.JsonOutput;

def aaMatchCtrlFlowStr = ctx.getTenant().getQaMatchCtrlFlow()
def aaMatchCtrlFlow = new JsonSlurper().parseText(aaMatchCtrlFlowStr)
def qaMatchingRuleList = aaMatchCtrlFlow.QAMatchingRule.name.findAll {
  !(it in ["PrepareForQAMatchingRule", "PrepareForNotDirectAnswerRule"])
}

return JsonOutput.toJson([
  QAMatchingRuleList: qaMatchingRuleList
])
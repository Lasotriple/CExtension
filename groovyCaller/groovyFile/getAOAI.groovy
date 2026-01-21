import com.intumit.smartrobot.aigc.AigcApi;
import com.intumit.smartrobot.aigc.AigcApiConfig;
import com.theokanning.openai.completion.chat.ChatCompletionChoice;
import com.theokanning.openai.completion.chat.ChatCompletionRequest;
import com.theokanning.openai.completion.chat.ChatMessage;
import groovy.json.JsonOutput;
import groovy.json.JsonSlurper;

def getAOAI(String model, String prompt) {
  def apiConfig = AigcApiConfig.get(ctx.tenant.id)
  def api       = AigcApi.builder().apiConfig(apiConfig).build()

  def messages = [
    new ChatMessage("user", prompt)
  ]

  def request = ChatCompletionRequest.builder()
  .model(model)
  .messages(messages)
  .maxTokens(4000)
  .temperature(0.0)
  .topP(0.0)
  .build()

  def result = api.callChatCompletion(request, "Test", null)

  def answer = result.getChoices()
  .stream()
  .findFirst()
  .map(ChatCompletionChoice::getMessage)
  .map(ChatMessage::getContent)
  .orElse("")

  return answer
}

def jsonStr = '$jsonOutput$'
def parsed  = new JsonSlurper().parseText(jsonStr)

def model   = parsed.model
def prompt  = parsed.prompt
def result  = getAOAI(model, prompt)

return JsonOutput.toJson([
  answer: result
])
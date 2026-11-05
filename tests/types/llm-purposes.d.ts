// Request purposes the tests send, declared the way a producer package registers them with dsh-llm.
import '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface LlmRequestPurposeMap {
    code: true
  }
}

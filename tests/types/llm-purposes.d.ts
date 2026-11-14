import '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface LlmRequestPurposeMap {
    code: true
  }
}

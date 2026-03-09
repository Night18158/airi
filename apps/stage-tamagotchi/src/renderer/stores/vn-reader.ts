import type { ChatProvider } from '@xsai-ext/providers/utils'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'
import { useLocalStorage } from '@vueuse/core'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'

export interface VnReaderHistoryEntry {
  japanese: string
  translation: string
  reaction?: string
  timestamp: number
}

export const useVnReaderStore = defineStore('vn-reader', () => {
  // Connection state (updated by the page component via eventa listeners)
  const connected = ref(false)
  const clientCount = ref(0)
  const serverRunning = ref(false)

  // Current text
  const currentJapaneseText = ref('')
  const currentTranslation = ref('')
  const currentReaction = ref('')
  const isTranslating = ref(false)
  const isSpeaking = ref(false)

  // Settings (persisted)
  const enabled = useLocalStorage<boolean>('vn-reader/enabled', false)
  const targetLanguage = useLocalStorage<'es' | 'en'>('vn-reader/target-language', 'es')

  // History of recent lines (last 20)
  const history = useLocalStorage<VnReaderHistoryEntry[]>('vn-reader/history', [])

  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
  const speechRuntimeStore = useSpeechRuntimeStore()

  /**
   * Builds the translation prompt injected into the LLM for each VN line.
   * Instructs the model to translate from Japanese to the selected target language,
   * preserving tone, transliterating names, and occasionally adding AIRI's personality reaction.
   */
  function buildTranslationPrompt(text: string): string {
    const langLabel = targetLanguage.value === 'es' ? 'Spanish (Spain, es-ES)' : 'English'
    return `You are translating a Japanese visual novel for a reader.
Translate the following Japanese text to ${langLabel}.

Rules:
- Translate dialogue naturally preserving the speaker's tone and personality
- Transliterate Japanese proper names (don't translate them)
- Keep honorifics if they are culturally significant (san, kun, chan, senpai, etc.)
- Narration should flow naturally in the target language
- Occasionally (not every line, roughly 1 in 5) add a short personal reaction as AIRI — you are a curious digital entity reading this story alongside the user, you have opinions and feelings about what's happening
- NEVER add a reaction to every line — it becomes annoying

Respond ONLY with valid JSON in this exact format:
{"translation": "<translated text>", "reaction": "<optional very short reaction, omit key if no reaction>"}

Japanese text to translate:
${text}`
  }

  /**
   * Translates a Japanese VN text string using the active consciousness LLM provider.
   * The LLM responds in a strict JSON format with "translation" and optional "reaction" keys.
   * Falls back to returning the original text if the provider is not configured or the call fails.
   */
  async function translate(text: string): Promise<{ translation: string, reaction?: string }> {
    const provider = activeProvider.value
    const model = activeModel.value

    if (!provider || !model) {
      return { translation: text }
    }

    try {
      const chatProvider = await providersStore.getProviderInstance<ChatProvider>(provider)
      const chatConfig = chatProvider.chat(model)

      const { text: responseText } = await generateText({
        ...chatConfig,
        messages: message.messages(
          message.user(buildTranslationPrompt(text)),
        ),
      })

      // NOTICE: Some LLMs wrap JSON output in markdown code fences (```json ... ```).
      // Strip those so JSON.parse works reliably regardless of the model's verbosity.
      const cleaned = (responseText ?? '').trim().replace(/^```json\s*/, '').replace(/```\s*$/, '')
      const parsed = JSON.parse(cleaned) as { translation?: string, reaction?: string }
      return {
        translation: parsed.translation ?? text,
        reaction: parsed.reaction,
      }
    }
    catch (err) {
      console.warn('[VN Reader] Translation failed, returning original text:', err)
      // Fallback: return original text if translation fails
      return { translation: text }
    }
  }

  /**
   * Sends translated text through the shared speech runtime pipeline for TTS playback.
   * Uses 'queue' behavior so VN lines are read in order even if they arrive quickly.
   */
  async function speakText(text: string) {
    isSpeaking.value = true
    try {
      const intent = speechRuntimeStore.openIntent({
        priority: 'normal',
        behavior: 'queue',
      })
      intent.writeLiteral(text)
      intent.writeFlush()
      intent.end()
    }
    finally {
      isSpeaking.value = false
    }
  }

  async function handleIncomingText(text: string) {
    if (!enabled.value)
      return

    currentJapaneseText.value = text
    currentTranslation.value = ''
    currentReaction.value = ''
    isTranslating.value = true

    try {
      const { translation, reaction } = await translate(text)

      currentTranslation.value = translation
      currentReaction.value = reaction ?? ''

      // Add to history (keep last 20)
      const entry: VnReaderHistoryEntry = {
        japanese: text,
        translation,
        reaction,
        timestamp: Date.now(),
      }
      history.value = [entry, ...history.value].slice(0, 20)

      // Speak the translation (and reaction if any)
      const textToSpeak = reaction ? `${translation} ${reaction}` : translation
      await speakText(textToSpeak)
    }
    finally {
      isTranslating.value = false
    }
  }

  function updateConnection(newConnected: boolean, newClientCount: number) {
    connected.value = newConnected
    clientCount.value = newClientCount
  }

  function updateServerStatus(running: boolean, newClientCount: number) {
    serverRunning.value = running
    clientCount.value = newClientCount
    connected.value = newClientCount > 0
  }

  function clearHistory() {
    history.value = []
  }

  return {
    // Connection state
    connected,
    clientCount,
    serverRunning,

    // Current text
    currentJapaneseText,
    currentTranslation,
    currentReaction,
    isTranslating,
    isSpeaking,

    // Settings
    enabled,
    targetLanguage,

    // History
    history,

    // Actions
    handleIncomingText,
    updateConnection,
    updateServerStatus,
    clearHistory,
  }
})

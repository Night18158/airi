<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { computed, onMounted } from 'vue'

const providerId = 'aivis-speech'
const defaultModel = 'aivis-speech'
const speechStore = useSpeechStore()
const providersStore = useProvidersStore()

const availableVoices = computed(() => speechStore.availableVoices[providerId] || [])

onMounted(async () => {
  await speechStore.loadVoicesForProvider(providerId)
})

async function handleGenerateSpeech(input: string, voiceId: string) {
  const provider = await providersStore.getProviderInstance(providerId) as SpeechProvider
  if (!provider)
    throw new Error('Failed to initialize AivisSpeech provider')

  const providerConfig = providersStore.getProviderConfig(providerId)
  const model = (providerConfig.model as string | undefined) || defaultModel

  return await speechStore.speech(provider, model, input, voiceId, { ...providerConfig })
}
</script>

<template>
  <SpeechProviderSettings :provider-id="providerId" :generate-speech="handleGenerateSpeech" :available-voices="availableVoices" />
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>

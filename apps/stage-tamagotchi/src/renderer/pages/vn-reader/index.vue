<script setup lang="ts">
import type { Eventa } from '@moeru/eventa'

import { defineInvoke } from '@moeru/eventa'
import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

import WindowTitleBar from '../../components/Window/TitleBar.vue'

import { vnReaderConnectionChanged, vnReaderGetStatus, vnReaderRestartWithPort, vnReaderTextReceived } from '../../../shared/eventa'
import { useVnReaderStore } from '../../stores/vn-reader'

const store = useVnReaderStore()
const {
  connected,
  clientCount,
  enabled,
  port,
  targetLanguage,
  currentJapaneseText,
  currentTranslation,
  currentReaction,
  isTranslating,
  history,
} = storeToRefs(store)

const context = useElectronEventaContext()

onMounted(async () => {
  // Listen for incoming text from Textractor
  try {
    context.value.on(vnReaderTextReceived, (evt: Eventa<{ text: string }>) => {
      const text = evt?.body?.text
      if (text)
        void store.handleIncomingText(text)
    })

    context.value.on(vnReaderConnectionChanged, (evt: Eventa<{ connected: boolean, clientCount: number }>) => {
      if (evt?.body)
        store.updateConnection(evt.body.connected, evt.body.clientCount)
    })
  }
  catch (err) {
    console.warn('[VN Reader] Failed to register event listeners:', err)
  }

  // Query initial server status
  try {
    const getStatus = defineInvoke(context.value, vnReaderGetStatus)
    const status = await getStatus()
    if (status) {
      store.updateServerStatus(status.running, status.clientCount, status.port)

      // If the persisted port differs from the server's current port, restart on the saved port
      if (port.value !== status.port) {
        await onPortChange(port.value)
      }
    }
  }
  catch (err) {
    console.warn('[VN Reader] Failed to fetch initial server status:', err)
  }
})

async function onPortChange(newPort: number) {
  if (Number.isNaN(newPort) || newPort < 1 || newPort > 65535)
    return
  try {
    const restartWithPort = defineInvoke(context.value, vnReaderRestartWithPort)
    await restartWithPort({ port: newPort })
    port.value = newPort
  }
  catch (err) {
    console.warn('[VN Reader] Failed to restart server on new port:', err)
  }
}
</script>

<template>
  <div :class="['h-full w-full overflow-y-auto', 'pt-[44px]']">
    <WindowTitleBar
      title="VN Reader"
      icon="i-solar:book-2-bold"
    />

    <div class="flex flex-col gap-3 p-4">
      <!-- Connection status -->
      <div :class="['flex items-center gap-2 rounded-lg px-3 py-2 text-sm', connected ? 'bg-green-500/15 text-green-400' : 'bg-neutral-500/10 text-neutral-400']">
        <span :class="['h-2 w-2 rounded-full', connected ? 'bg-green-400' : 'bg-neutral-500']" />
        <span v-if="connected">
          Textractor conectado ({{ clientCount }} {{ clientCount === 1 ? 'cliente' : 'clientes' }})
        </span>
        <span v-else>
          Conectando a Textractor en ws://localhost:{{ port }}...
        </span>
      </div>

      <!-- Enable toggle + Language selector -->
      <div class="flex items-center justify-between gap-3">
        <label class="flex cursor-pointer select-none items-center gap-2">
          <input
            v-model="enabled"
            type="checkbox"
            :class="['h-4 w-4 rounded accent-primary-500']"
          >
          <span class="text-sm text-neutral-300">VN Reader activo</span>
        </label>

        <div class="flex gap-1">
          <button
            :class="[
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              targetLanguage === 'es'
                ? 'bg-primary-500/30 text-primary-300'
                : 'bg-neutral-700/50 text-neutral-400 hover:bg-neutral-700',
            ]"
            @click="targetLanguage = 'es'"
          >
            ES
          </button>
          <button
            :class="[
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              targetLanguage === 'en'
                ? 'bg-primary-500/30 text-primary-300'
                : 'bg-neutral-700/50 text-neutral-400 hover:bg-neutral-700',
            ]"
            @click="targetLanguage = 'en'"
          >
            EN
          </button>
        </div>
      </div>

      <!-- Port configuration -->
      <div class="flex items-center gap-3 rounded-lg bg-neutral-800/40 px-3 py-2">
        <label
          for="vn-reader-port"
          class="flex-1 text-sm text-neutral-400"
        >
          Puerto WebSocket
        </label>
        <input
          id="vn-reader-port"
          :value="port"
          type="number"
          min="1"
          max="65535"
          :class="[
            'w-24 rounded-md bg-neutral-700/60 px-2 py-1 text-right text-sm text-neutral-200',
            'border border-neutral-600/50 outline-none',
            'focus:border-primary-500/60 focus:ring-1 focus:ring-primary-500/30',
          ]"
          @change="onPortChange(Number(($event.target as HTMLInputElement).value))"
        >
      </div>

      <!-- Current line panel -->
      <div
        v-if="currentJapaneseText"
        class="flex flex-col gap-3 rounded-xl bg-neutral-800/50 p-4"
      >
        <!-- Japanese text -->
        <div>
          <p class="mb-1 text-xs text-neutral-500 font-medium tracking-wide uppercase">
            日本語
          </p>
          <p class="text-lg text-neutral-200 leading-relaxed">
            {{ currentJapaneseText }}
          </p>
        </div>

        <!-- Translation -->
        <div>
          <p class="mb-1 text-xs text-neutral-500 font-medium tracking-wide uppercase">
            {{ targetLanguage === 'es' ? 'Traducción' : 'Translation' }}
          </p>
          <div v-if="isTranslating" class="flex items-center gap-2 text-neutral-400">
            <span class="i-solar:refresh-bold h-4 w-4 animate-spin" />
            <span class="text-sm">Traduciendo...</span>
          </div>
          <p v-else class="text-base text-neutral-100 leading-relaxed">
            {{ currentTranslation }}
          </p>
        </div>

        <!-- AIRI reaction bubble -->
        <div
          v-if="currentReaction"
          :class="[
            'flex items-start gap-2 rounded-lg bg-primary-500/10 px-3 py-2',
            'border border-primary-500/20',
          ]"
        >
          <span class="i-solar:chat-round-bold mt-0.5 h-4 w-4 flex-shrink-0 text-primary-400" />
          <p class="text-sm text-primary-300 leading-relaxed">
            {{ currentReaction }}
          </p>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="flex flex-col items-center justify-center gap-2 rounded-xl bg-neutral-800/30 py-8 text-center"
      >
        <span class="i-solar:book-2-bold h-8 w-8 text-neutral-600" />
        <p class="text-sm text-neutral-500">
          Esperando texto del juego...
        </p>
      </div>

      <!-- Translation history -->
      <div v-if="history.length > 0">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs text-neutral-500 font-medium tracking-wide uppercase">
            Historial
          </p>
          <button
            class="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
            @click="store.clearHistory()"
          >
            Limpiar
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="entry in history.slice(0, 10)"
            :key="entry.timestamp"
            class="rounded-lg bg-neutral-800/30 px-3 py-2"
          >
            <p class="text-xs text-neutral-500 leading-relaxed">
              {{ entry.japanese }}
            </p>
            <p class="text-sm text-neutral-300 leading-relaxed">
              {{ entry.translation }}
            </p>
            <p v-if="entry.reaction" class="mt-1 text-xs text-primary-400/70 leading-relaxed">
              ↩ {{ entry.reaction }}
            </p>
          </div>
        </div>
      </div>

      <!-- Footer note -->
      <p class="text-center text-xs text-neutral-600 leading-relaxed">
        Asegúrate de que el plugin <code class="rounded bg-neutral-800 px-1 py-0.5">textractor_websocket_x86</code> está activo en Textractor
      </p>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>

import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { VnReaderService } from '../../../services/vn-reader'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronOpenMainDevtools, vnReaderConnectionChanged, vnReaderGetStatus, vnReaderTextReceived } from '../../../../shared/eventa'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupVnReaderWindowElectronInvokes(params: {
  window: BrowserWindow
  vnReaderService: VnReaderService
  serverChannel: ServerChannel
  i18n: I18n
}) {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, i18n: params.i18n, serverChannel: params.serverChannel })

  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))

  // VN Reader IPC — let renderer query status and receive pushed events
  defineInvokeHandler(context, vnReaderGetStatus, () => params.vnReaderService.getStatus())

  const unsubText = params.vnReaderService.onTextReceived((text) => {
    context.emit(vnReaderTextReceived, { text })
  })

  const unsubConn = params.vnReaderService.onConnectionChanged((connected, clientCount) => {
    context.emit(vnReaderConnectionChanged, { connected, clientCount })
  })

  params.window.on('closed', () => {
    unsubText()
    unsubConn()
  })
}

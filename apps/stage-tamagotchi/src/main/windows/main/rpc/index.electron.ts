import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { VnReaderService } from '../../../services/vn-reader'
import type { NoticeWindowManager } from '../../notice'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronOpenChat, electronOpenMainDevtools, electronOpenSettings, electronOpenVnReader, noticeWindowEventa, vnReaderConnectionChanged, vnReaderGetStatus, vnReaderTextReceived } from '../../../../shared/eventa'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { toggleWindowShow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupMainWindowElectronInvokes(params: {
  window: BrowserWindow
  settingsWindow: () => Promise<BrowserWindow>
  chatWindow: () => Promise<BrowserWindow>
  vnReaderWindow: () => Promise<BrowserWindow>
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  vnReaderService: VnReaderService
  i18n: I18n
}) {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, serverChannel: params.serverChannel, i18n: params.i18n })
  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })

  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, async () => toggleWindowShow(await params.settingsWindow()))
  defineInvokeHandler(context, electronOpenChat, async () => toggleWindowShow(await params.chatWindow()))
  defineInvokeHandler(context, electronOpenVnReader, async () => toggleWindowShow(await params.vnReaderWindow()))
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))

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

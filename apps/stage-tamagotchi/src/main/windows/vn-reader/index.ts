import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { VnReaderService } from '../../services/vn-reader'

import { join, resolve } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { setupVnReaderWindowElectronInvokes } from './rpc/index.electron'

export function setupVnReaderWindowReusableFunc(params: {
  vnReaderService: VnReaderService
  serverChannel: ServerChannel
  i18n: I18n
}) {
  return createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'VN Reader',
      width: 450,
      height: 600,
      show: false,
      icon,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.mjs'),
        sandbox: false,
      },
    })

    window.on('ready-to-show', () => window.show())
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/vn-reader'))

    await setupVnReaderWindowElectronInvokes({
      window,
      vnReaderService: params.vnReaderService,
      serverChannel: params.serverChannel,
      i18n: params.i18n,
    })

    return window
  }).getWindow
}

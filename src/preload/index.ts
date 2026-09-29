import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LocalRules, Resolution, TransformOptions, TransformResult } from '../engine'
import type { RulesState } from '../main/rules-store'
import type { UpdateStatus } from '../main/updates'

export interface OpenedFile {
  path: string
  fileName: string
  encoding: string
  rows: number
}

const api = {
  pickCsv: (): Promise<OpenedFile | null> => ipcRenderer.invoke('csv:pick'),
  openDroppedFile: (file: File): Promise<OpenedFile> => ipcRenderer.invoke('csv:open', webUtils.getPathForFile(file)),
  run: (resolutions: Record<string, Resolution>, options: TransformOptions): Promise<TransformResult> =>
    ipcRenderer.invoke('engine:run', resolutions, options),
  saveExcel: (resolutions: Record<string, Resolution>, options: TransformOptions): Promise<string | null> =>
    ipcRenderer.invoke('excel:save', resolutions, options),
  showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  getRules: (): Promise<RulesState> => ipcRenderer.invoke('rules:get'),
  refreshRules: (): Promise<RulesState> => ipcRenderer.invoke('rules:refresh'),
  saveLocalRules: (local: LocalRules): Promise<RulesState> => ipcRenderer.invoke('rules:saveLocal', local),
  shareRules: (): Promise<void> => ipcRenderer.invoke('rules:share'),
  appInfo: (): Promise<{ version: string; platform: string; repoUrl: string }> => ipcRenderer.invoke('app:info'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onOpened: (cb: (f: OpenedFile) => void) => {
    ipcRenderer.on('csv:opened', (_e, f: OpenedFile) => cb(f))
  },
  onUpdate: (cb: (s: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_e, s: UpdateStatus) => cb(s))
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

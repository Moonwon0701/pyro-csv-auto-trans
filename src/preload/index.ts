import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AssignOptions, AssignPlanEntry, AssignResult, LocalRules, PositionSlot, Resolution, TransformOptions, TransformResult } from '../engine'
import type { RulesState, ShareResult } from '../main/rules-store'
import type { UpdateStatus } from '../main/updates'

export interface AssignSource {
  path: string
  fileName: string
  encoding: string
  rows: number
  positions: PositionSlot[]
}

export type AssignRun = Pick<AssignResult, 'issues' | 'blocked' | 'summary'>

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
  assignPick: (): Promise<AssignSource | null> => ipcRenderer.invoke('assign:pick'),
  assignOpenDropped: (file: File): Promise<AssignSource> => ipcRenderer.invoke('assign:open', webUtils.getPathForFile(file)),
  assignPropose: (startModule: string): Promise<AssignPlanEntry[]> => ipcRenderer.invoke('assign:propose', startModule),
  assignRun: (opts: AssignOptions): Promise<AssignRun> => ipcRenderer.invoke('assign:run', opts),
  assignSave: (opts: AssignOptions): Promise<string | null> => ipcRenderer.invoke('assign:save', opts),
  assignToConvert: (opts: AssignOptions): Promise<OpenedFile> => ipcRenderer.invoke('assign:toConvert', opts),
  tutorialSample: (): Promise<AssignSource> => ipcRenderer.invoke('tutorial:sample'),
  showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  getRules: (): Promise<RulesState> => ipcRenderer.invoke('rules:get'),
  refreshRules: (): Promise<RulesState> => ipcRenderer.invoke('rules:refresh'),
  saveLocalRules: (local: LocalRules): Promise<RulesState> => ipcRenderer.invoke('rules:saveLocal', local),
  shareRules: (): Promise<ShareResult> => ipcRenderer.invoke('rules:share'),
  appInfo: (): Promise<{ version: string; platform: string; repoUrl: string }> => ipcRenderer.invoke('app:info'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onOpened: (cb: (f: OpenedFile) => void) => {
    ipcRenderer.on('csv:opened', (_e, f: OpenedFile) => cb(f))
  },
  onAssignOpened: (cb: (s: AssignSource) => void) => {
    ipcRenderer.on('assign:opened', (_e, s: AssignSource) => cb(s))
  },
  onUpdate: (cb: (s: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_e, s: UpdateStatus) => cb(s))
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

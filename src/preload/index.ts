import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AssignOptions,
  AssignPlanEntry,
  AssignResult,
  JigResult,
  JigSettings,
  LocalRules,
  PositionSlot,
  PrefixMapping,
  Resolution,
  SplitOptions,
  TransformOptions,
  TransformResult
} from '../engine'
import type { FileInfo, LabelRun, LabelSource, RestoreSummary, SavedFiles, SplitSource } from '../main/tools'
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

export type { FileInfo, LabelRun, LabelSource, RestoreSummary, SavedFiles, SplitSource }

export type JigRun = Pick<JigResult, 'positions' | 'issues' | 'blocked'> & {
  /** 이미 주소가 있는 행 수 (원본이면 0) */
  addressed: number
  /** Rule에 없는 위치 접두어 (①에서 분류를 받는다) */
  prefixes: PrefixMapping[]
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
  assignPropose: (startModule: string, jig: JigSettings): Promise<AssignPlanEntry[]> => ipcRenderer.invoke('assign:propose', startModule, jig),
  assignRun: (opts: AssignOptions, jig: JigSettings): Promise<AssignRun> => ipcRenderer.invoke('assign:run', opts, jig),
  assignSave: (opts: AssignOptions, jig: JigSettings): Promise<string | null> => ipcRenderer.invoke('assign:save', opts, jig),
  assignToConvert: (opts: AssignOptions, jig: JigSettings): Promise<OpenedFile> => ipcRenderer.invoke('assign:toConvert', opts, jig),
  jigPick: (): Promise<OpenedFile | null> => ipcRenderer.invoke('jig:pick'),
  jigOpenDropped: (file: File): Promise<OpenedFile> => ipcRenderer.invoke('jig:open', webUtils.getPathForFile(file)),
  jigRun: (settings: JigSettings): Promise<JigRun> => ipcRenderer.invoke('jig:run', settings),
  jigToAssign: (settings: JigSettings): Promise<AssignSource> => ipcRenderer.invoke('jig:toAssign', settings),
  /** 끌어다 놓은 파일들의 경로 */
  pathsOf: (files: File[]): string[] => files.map((f) => webUtils.getPathForFile(f)),
  restorePick: (which: 'originals' | 'damaged'): Promise<string[] | null> => ipcRenderer.invoke('restore:pick', which),
  restoreSet: (which: 'originals' | 'damaged', paths: string[]): Promise<FileInfo[]> => ipcRenderer.invoke('restore:set', which, paths),
  restoreRun: (): Promise<RestoreSummary[]> => ipcRenderer.invoke('restore:run'),
  restoreSave: (): Promise<SavedFiles> => ipcRenderer.invoke('restore:save'),
  splitPick: (): Promise<string | null> => ipcRenderer.invoke('split:pick'),
  splitOpen: (path: string): Promise<SplitSource> => ipcRenderer.invoke('split:open', path),
  splitPreview: (opts: SplitOptions): Promise<{ key: string; fileName: string; rows: number }[]> => ipcRenderer.invoke('split:preview', opts),
  splitSave: (opts: SplitOptions): Promise<SavedFiles | null> => ipcRenderer.invoke('split:save', opts),
  labelsPick: (): Promise<LabelSource | null> => ipcRenderer.invoke('labels:pick'),
  labelsOpen: (path: string): Promise<LabelSource> => ipcRenderer.invoke('labels:open', path),
  labelsFromConvert: (): Promise<LabelSource> => ipcRenderer.invoke('labels:fromConvert'),
  labelsRun: (resolutions: Record<string, Resolution>): Promise<LabelRun> => ipcRenderer.invoke('labels:run', resolutions),
  labelsSave: (resolutions: Record<string, Resolution>, showName: string): Promise<SavedFiles | null> =>
    ipcRenderer.invoke('labels:save', resolutions, showName),
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
  onLabelsOpened: (cb: (f: LabelSource) => void) => {
    ipcRenderer.on('labels:opened', (_e, f: LabelSource) => cb(f))
  },
  onJigOpened: (cb: (f: OpenedFile) => void) => {
    ipcRenderer.on('jig:opened', (_e, f: OpenedFile) => cb(f))
  },
  onUpdate: (cb: (s: UpdateStatus) => void) => {
    ipcRenderer.on('update:status', (_e, s: UpdateStatus) => cb(s))
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

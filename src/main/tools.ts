/**
 * 파일 도구(CSV 나누기·엑셀 손상 복원)와 ④ 라벨 만들기 IPC.
 */
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import {
  buildDgz,
  buildLabelSheets,
  buildXlsx,
  CATEGORIES,
  damagedSeriesLines,
  parseCsv,
  restoreCsv,
  safeFilePart,
  serializeCsv,
  splitCandidates,
  splitCsv,
  type Category,
  type Issue,
  type LabelCount,
  type ParsedCsv,
  type Resolution,
  type RestoreFix,
  type RuleSet,
  type SheetModel,
  type SplitOptions
} from '../engine'

interface Loaded {
  path: string
  csv: ParsedCsv
}

export interface FileInfo {
  path: string
  fileName: string
  encoding: string
  rows: number
}

export interface RestoreSummary extends FileInfo {
  matched: number
  /** 복원 전 직렬 TILT 손상 행 */
  damagedBefore: number
  fixes: RestoreFix[]
  issues: Issue[]
}

export interface SplitSource extends FileInfo {
  headers: string[]
  candidates: { header: string; values: number }[]
}

export interface LabelSource extends FileInfo {
  showName: string
  /** ③ 시트 정리에서 넘겨받아 ③에 열린 데이터를 따라가는 중 */
  fromConvert: boolean
}

export interface LabelRun {
  /** 이번에 라벨을 만든 데이터 (③을 따라가면 넘겨받은 뒤 바뀌었을 수 있다) */
  source: LabelSource
  counts: LabelCount[]
  issues: Issue[]
  /** 미리보기: 타상·연발·단발 시트 */
  sheets: SheetModel[]
}

export interface SavedFiles {
  dir: string
  files: string[]
}

const info = ({ path, csv }: Loaded): FileInfo => ({ path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length })
const load = (path: string): Loaded => ({ path, csv: parseCsv(readFileSync(path), basename(path)) })
/** 앱이 붙인 꼬리(_ADDR, _치구, _복원)를 뗀 파일 이름 */
const baseName = (path: string) => basename(path, extname(path)).replace(/(_(ADDR|치구|복원))+$/i, '')

/** "260725 울주 다이어트 2차" → "울주". 라벨에 찍히는 행사명 기본값 */
export function guessShowName(fileName: string): string {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/(_(ADDR|치구|복원))+$/i, '')
  const words = name.replace(/^\d{4,8}[\s_-]*/, '').split(/[\s_]+/).filter(Boolean)
  return words[0] ?? name
}

function templateDir() {
  return app.isPackaged ? join(process.resourcesPath, 'label-templates') : join(app.getAppPath(), 'resources', 'label-templates')
}

/** DesignPro는 Windows 문서 폴더 아래 Temp에 패키지를 푼다. 다른 OS에서 만들면 흔한 경로로 둔다 */
const documentsDir = () => (process.platform === 'win32' ? app.getPath('documents') : 'C:\\Users\\User\\Documents')

async function chooseFolder(win: BrowserWindow, title: string, defaultPath: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

export function registerToolIpc(deps: {
  win: () => BrowserWindow
  rules: () => Promise<RuleSet>
  /** ③ 시트 정리에 열려 있는 CSV */
  convertSource: () => Loaded | null
}) {
  // ---- 엑셀 손상 복원 ----
  let originals: Loaded[] = []
  let damaged: Loaded[] = []
  const pickMany = async (title: string) => {
    const r = await dialog.showOpenDialog(deps.win(), { title, properties: ['openFile', 'multiSelections'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] })
    return r.canceled ? null : r.filePaths
  }
  ipcMain.handle('restore:pick', (_e, which: 'originals' | 'damaged') =>
    pickMany(which === 'originals' ? '엑셀을 거치지 않은 원본 CSV 선택' : '엑셀로 저장해서 깨진 CSV 선택')
  )
  ipcMain.handle('restore:set', (_e, which: 'originals' | 'damaged', paths: string[]) => {
    const loaded = paths.map(load)
    if (which === 'originals') originals = loaded
    else damaged = loaded
    return loaded.map(info)
  })
  const restoreAll = () => {
    if (!originals.length) throw new Error('원본 CSV를 먼저 넣으세요.')
    return damaged.map((d) => ({ d, r: restoreCsv(originals.map((o) => o.csv), d.csv) }))
  }
  ipcMain.handle('restore:run', (): RestoreSummary[] =>
    restoreAll().map(({ d, r }) => ({
      ...info(d),
      matched: r.matched,
      damagedBefore: damagedSeriesLines(d.csv).length,
      fixes: r.fixes,
      issues: r.issues
    }))
  )
  ipcMain.handle('restore:save', (): SavedFiles => {
    const files = restoreAll().map(({ d, r }) => {
      const out = join(dirname(d.path), `${basename(d.path, extname(d.path))}_복원.csv`)
      writeFileSync(out, serializeCsv(r.csv))
      return out
    })
    return { dir: files[0] ? dirname(files[0]) : '', files }
  })

  // ---- CSV 나누기 ----
  let splitSource: Loaded | null = null
  ipcMain.handle('split:open', (_e, path: string): SplitSource => {
    splitSource = load(path)
    return { ...info(splitSource), headers: splitSource.csv.headers, candidates: splitCandidates(splitSource.csv) }
  })
  ipcMain.handle('split:pick', async () => {
    const paths = await pickMany('나눌 CSV 선택')
    return paths?.[0] ?? null
  })
  ipcMain.handle('split:preview', (_e, opts: SplitOptions) => {
    if (!splitSource) throw new Error('CSV를 먼저 넣으세요.')
    return splitCsv(splitSource.csv, opts).map((p) => ({ key: p.key, fileName: p.csv.fileName, rows: p.csv.rows.length }))
  })
  ipcMain.handle('split:save', async (_e, opts: SplitOptions): Promise<SavedFiles | null> => {
    if (!splitSource) throw new Error('CSV를 먼저 넣으세요.')
    const dir = await chooseFolder(deps.win(), '나눈 CSV를 저장할 폴더', dirname(splitSource.path))
    if (!dir) return null
    const files = splitCsv(splitSource.csv, opts).map((p) => {
      const out = join(dir, p.csv.fileName)
      writeFileSync(out, serializeCsv(p.csv))
      return out
    })
    return { dir, files }
  })

  // ---- ④ 라벨 만들기 ----
  let labelSource: Loaded | null = null
  /**
   * ③에서 넘겨받았으면 그 뒤에도 ③에 지금 열린 데이터로 만든다.
   * ②에서 주소를 다시 매겨 ③만 새로 저장하고 ④ 탭을 눌러도 라벨이 옛 주소로 나가지 않게.
   */
  let labelFollowsConvert = false
  const labelData = () => (labelFollowsConvert ? (deps.convertSource() ?? labelSource) : labelSource)
  const labelInfo = (l: Loaded): LabelSource => ({ ...info(l), showName: guessShowName(l.csv.fileName), fromConvert: labelFollowsConvert })
  const openLabel = (l: Loaded, fromConvert = false): LabelSource => {
    labelSource = l
    labelFollowsConvert = fromConvert
    return labelInfo(l)
  }
  ipcMain.handle('labels:open', (_e, path: string) => openLabel(load(path)))
  ipcMain.handle('labels:pick', async () => {
    const paths = await pickMany('라벨을 만들 CSV 선택 (주소 매긴 파일)')
    return paths?.[0] ? openLabel(load(paths[0])) : null
  })
  ipcMain.handle('labels:fromConvert', () => {
    const c = deps.convertSource()
    if (!c) throw new Error('③ 시트 정리에 열린 파일이 없습니다.')
    return openLabel(c, true)
  })
  const runLabels = async (resolutions: Record<string, Resolution>) => {
    const source = labelData()
    if (!source) throw new Error('CSV를 먼저 넣으세요.')
    return { source, ...buildLabelSheets(source.csv, await deps.rules(), resolutions) }
  }
  ipcMain.handle('labels:run', async (_e, resolutions: Record<string, Resolution>): Promise<LabelRun> => {
    const r = await runLabels(resolutions)
    return { source: labelInfo(r.source), counts: r.counts, issues: r.issues, sheets: r.sheets.filter((s) => s.category !== '원본') }
  })
  ipcMain.handle('labels:save', async (_e, resolutions: Record<string, Resolution>, showName: string): Promise<SavedFiles | null> => {
    const r = await runLabels(resolutions)
    const src = r.source.path
    const dir = await chooseFolder(deps.win(), '라벨 파일(xlsx·dgz)을 저장할 폴더', dirname(src))
    if (!dir) return null
    const show = safeFilePart(showName) || guessShowName(r.source.csv.fileName)
    const xlsxBase = `${safeFilePart(baseName(src))} 라벨작업`
    const xlsx = await buildXlsx(r.sheets)
    const files = [join(dir, `${xlsxBase}.xlsx`)]
    writeFileSync(files[0], xlsx)
    for (const c of CATEGORIES as readonly Category[]) {
      if (!r.counts.find((x) => x.category === c)?.labels) continue
      const dgzBase = `${show} ${c}`
      const dgz = await buildDgz({
        xlsx,
        xlsxBase,
        dgzBase,
        template: readFileSync(join(templateDir(), `${c}.dgf`)),
        documentsDir: documentsDir(),
        showName: showName.trim() || show
      })
      const out = join(dir, `${dgzBase}.dgz`)
      writeFileSync(out, dgz)
      files.push(out)
    }
    return { dir, files }
  })

  /** 앱을 ④부터 열면서 넘긴 파일 */
  return { openLabelFile: (path: string) => openLabel(load(path)) }
}

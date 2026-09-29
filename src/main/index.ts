import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import {
  assignWithJigs,
  buildXlsx,
  DEFAULT_JIG_SETTINGS,
  DEFAULT_OPTIONS,
  extraSheets,
  jigModuleNeeds,
  listPositions,
  parseCsv,
  planJigs,
  proposePlan,
  serializeCsv,
  transform,
  type AssignOptions,
  type JigSettings,
  type LocalRules,
  type ParsedCsv,
  type Resolution,
  type TransformOptions
} from '../engine'
import { REPO_URL, RULES_ISSUE_URL } from './config'
import { buildShareRequest, getRules, loadRules, saveLocalRules, type ShareResult } from './rules-store'
import { checkForUpdates, installUpdate } from './updates'

let win: BrowserWindow | null = null
let current: { path: string; csv: ParsedCsv } | null = null
/** 주소 매기기용 원본 */
let assignSource: { path: string; csv: ParsedCsv } | null = null
/** 치구 배치용 (주소 매긴) CSV */
let jigSource: { path: string; csv: ParsedCsv } | null = null
/** ② 치구 배치에서 마지막으로 쓴 설정. ③ 치구 배치도도 같은 설정으로 그린다 */
let jigSettings: JigSettings = DEFAULT_JIG_SETTINGS

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '불꽃쇼 CSV 자동 정리',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  const hash = process.env.PYRO_START_TAB ?? ''
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  win.webContents.once('did-finish-load', () => {
    checkForUpdates(win!)
    const argPath = process.argv.slice(1).find((a) => /\.(csv|txt)$/i.test(a) && existsSync(a))
    if (argPath) {
      // 앱은 ① 치구 배치부터 시작한다 (②·③으로 시작한 경우만 그 단계에 연다)
      if (hash === 'assign') {
        openAssignSource(argPath)
          .then((s) => win!.webContents.send('assign:opened', s))
          .catch(() => undefined)
      } else if (hash !== 'convert') {
        try {
          win!.webContents.send('jig:opened', openJigSource(argPath))
        } catch {
          /* 무시: 화면에서 다시 열 수 있음 */
        }
      } else {
        try {
          win!.webContents.send('csv:opened', openCsv(argPath))
        } catch {
          /* 무시: 화면에서 다시 열 수 있음 */
        }
      }
    }
    // 개발용: PYRO_CAPTURE=경로.png 이면 화면을 캡처하고 종료
    const capture = process.env.PYRO_CAPTURE
    // 개발용: PYRO_EVAL 스크립트를 화면에서 실행 (클릭 흐름 검증용)
    const script = process.env.PYRO_EVAL
    if (script && capture) {
      setTimeout(() => win!.webContents.executeJavaScript(script).catch(() => undefined), 2500)
    }
    if (capture) {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        writeFileSync(capture, img.toPNG())
        app.quit()
      }, Number(process.env.PYRO_CAPTURE_DELAY ?? 2500))
    }
  })
}

function openCsv(path: string) {
  const csv = parseCsv(readFileSync(path), basename(path))
  current = { path, csv }
  return { path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length }
}

async function run(resolutions: Record<string, Resolution>, options: TransformOptions) {
  if (!current) throw new Error('CSV 파일을 먼저 불러오세요.')
  const { effective } = await getRules()
  return transform(current.csv, effective, resolutions, options)
}

ipcMain.handle('csv:pick', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'CSV 파일 선택',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  })
  return r.canceled || !r.filePaths[0] ? null : openCsv(r.filePaths[0])
})

ipcMain.handle('csv:open', (_e, path: string) => openCsv(path))

ipcMain.handle('engine:run', (_e, resolutions: Record<string, Resolution>, options: TransformOptions) =>
  run(resolutions, options)
)

ipcMain.handle('excel:save', async (_e, resolutions: Record<string, Resolution>, options: TransformOptions) => {
  const result = await run(resolutions, options)
  if (result.analysis.blocked) throw new Error('해결되지 않은 항목이 있어 Excel을 만들 수 없습니다.')
  const src = current!.path
  const r = await dialog.showSaveDialog(win!, {
    title: 'Excel 저장',
    defaultPath: join(dirname(src), `${basename(src, extname(src))}_정리.xlsx`),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (r.canceled || !r.filePath) return null
  const { effective } = await getRules()
  const title = basename(src, extname(src)).replace(/_(ADDR|치구)$/i, '')
  const { grids } = extraSheets(current!.csv, effective, resolutions, jigSettings, {
    layout: options.includeLayout,
    jig: options.includeJigSheet,
    title
  })
  writeFileSync(r.filePath, await buildXlsx(result.sheets, grids))
  return r.filePath
})

// ---- 1→2단계: 주소 매기기 ----
/** parsed: ① 치구 배치에서 이미 읽은 원본 */
async function openAssignSource(path: string, parsed?: ParsedCsv) {
  const csv = parsed ?? parseCsv(readFileSync(path), basename(path))
  assignSource = { path, csv }
  const { effective } = await getRules()
  const positions = listPositions(csv, effective)
  return { path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length, positions }
}

ipcMain.handle('assign:pick', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '주소를 매길 원본 CSV 선택',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  })
  return r.canceled || !r.filePaths[0] ? null : openAssignSource(r.filePaths[0])
})
ipcMain.handle('assign:open', (_e, path: string) => openAssignSource(path))
ipcMain.handle('assign:propose', async (_e, startModule: string, settings: JigSettings) => {
  if (!assignSource) throw new Error('원본 CSV를 먼저 불러오세요.')
  jigSettings = settings
  const { effective } = await getRules()
  return proposePlan(listPositions(assignSource.csv, effective), startModule, jigModuleNeeds(assignSource.csv, effective, settings))
})

/** 단발(치구 대상)은 치구 배치 순서로, 나머지는 고른 순서로 주소를 매긴다 */
async function runAssign(opts: AssignOptions, settings: JigSettings) {
  if (!assignSource) throw new Error('원본 CSV를 먼저 불러오세요.')
  jigSettings = settings
  const { effective } = await getRules()
  return assignWithJigs(assignSource.csv, opts, effective, settings)
}
const addrFileName = (p: string) => `${basename(p, extname(p))}_ADDR.csv`

ipcMain.handle('assign:run', async (_e, opts: AssignOptions, settings: JigSettings) => {
  const { issues, blocked, summary } = await runAssign(opts, settings)
  return { issues, blocked, summary }
})
ipcMain.handle('assign:save', async (_e, opts: AssignOptions, settings: JigSettings) => {
  const result = await runAssign(opts, settings)
  if (result.blocked) throw new Error('해결되지 않은 항목이 있어 저장할 수 없습니다.')
  const src = assignSource!.path
  const r = await dialog.showSaveDialog(win!, {
    title: '주소 매긴 CSV 저장',
    defaultPath: join(dirname(src), addrFileName(src)),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, serializeCsv(result.csv))
  return r.filePath
})
/** 주소 매긴 결과를 바로 변환 화면으로 넘긴다 */
ipcMain.handle('assign:toConvert', async (_e, opts: AssignOptions, settings: JigSettings) => {
  const result = await runAssign(opts, settings)
  if (result.blocked) throw new Error('해결되지 않은 항목이 있어 넘길 수 없습니다.')
  const src = assignSource!.path
  const csv = { ...result.csv, fileName: addrFileName(src) }
  current = { path: join(dirname(src), csv.fileName), csv }
  return { path: current.path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length }
})

// ---- ① 치구 배치: 원본 CSV의 단발을 치구·모듈로 나눠 본다 (주소는 ②에서) ----
function openJigSource(path: string) {
  const csv = parseCsv(readFileSync(path), basename(path))
  jigSource = { path, csv }
  return { path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length }
}

ipcMain.handle('jig:pick', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '디자인 CSV 선택',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  })
  return r.canceled || !r.filePaths[0] ? null : openJigSource(r.filePaths[0])
})
ipcMain.handle('jig:open', (_e, path: string) => openJigSource(path))
ipcMain.handle('jig:run', async (_e, settings: JigSettings) => {
  if (!jigSource) throw new Error('CSV를 먼저 불러오세요.')
  jigSettings = settings
  const { effective } = await getRules()
  const { positions, issues, blocked } = planJigs(jigSource.csv, effective, settings, { preview: true })
  const ai = jigSource.csv.headers.findIndex((h) => h.trim().toUpperCase() === 'ADDR')
  const addressed = ai < 0 ? 0 : jigSource.csv.rows.filter((r) => (r[ai] ?? '').trim()).length
  // 처음 보는 위치 접두어는 ①에서 바로 분류를 받는다 (③까지 가서 묻지 않도록)
  const prefixes = transform(jigSource.csv, effective, {}, DEFAULT_OPTIONS).analysis.prefixMappings.filter((m) => m.status !== 'rule')
  return { positions, issues, blocked, addressed, prefixes }
})
/** 치구 배치를 정했으면 같은 원본을 ② 주소 매기기로 넘긴다 */
ipcMain.handle('jig:toAssign', (_e, settings: JigSettings) => {
  if (!jigSource) throw new Error('CSV를 먼저 불러오세요.')
  jigSettings = settings
  return openAssignSource(jigSource.path, jigSource.csv)
})

/** 튜토리얼: 앱에 들어 있는 가상 샘플을 사용자 폴더로 복사해서 ① 화면에 연다 */
ipcMain.handle('tutorial:sample', () => {
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'tutorial-sample.csv')
    : join(app.getAppPath(), 'resources', 'tutorial-sample.csv')
  const dir = join(app.getPath('userData'), 'tutorial')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, '튜토리얼_샘플.csv')
  copyFileSync(bundled, target)
  return openAssignSource(target)
})

ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url)
})

ipcMain.handle('rules:get', () => getRules())
ipcMain.handle('rules:refresh', () => loadRules(true))
ipcMain.handle('rules:saveLocal', (_e, local: LocalRules) => saveLocalRules(local))
/** 내 PC Rule 중 공용과 다른 것을 "[Rule 요청]" 이슈로 연다. 반영은 GitHub Actions(rule-request.yml)가 한다 */
ipcMain.handle('rules:share', async (): Promise<ShareResult> => {
  const state = await loadRules(true) // 최신 공용 Rule과 비교해야 이미 반영된 것을 다시 올리지 않는다
  const req = buildShareRequest()
  if (!req) return { count: 0, pasteNeeded: false, state }
  const withBody = `${RULES_ISSUE_URL}?title=${encodeURIComponent(req.title)}&body=${encodeURIComponent(req.body)}`
  // 주소가 너무 길면 GitHub이 거절하므로 본문은 클립보드로 넘긴다
  const pasteNeeded = withBody.length > 7000
  if (pasteNeeded) clipboard.writeText(req.body)
  shell.openExternal(pasteNeeded ? `${RULES_ISSUE_URL}?title=${encodeURIComponent(req.title)}` : withBody)
  return { count: req.count, pasteNeeded, state }
})

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, repoUrl: REPO_URL }))
ipcMain.handle('update:install', () => installUpdate())

app.whenReady().then(() => {
  loadRules(true)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { GITHUB_REPO, RELEASES_URL } from './config'

export type UpdateStatus =
  | { kind: 'available'; version: string; url: string }
  | { kind: 'downloaded'; version: string }

function send(win: BrowserWindow, status: UpdateStatus) {
  if (!win.isDestroyed()) win.webContents.send('update:status', status)
}

function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** Windows: 자동 다운로드 후 재시작 안내. Mac(서명 없음): 새 버전 알림 + 다운로드 페이지 링크 */
export function checkForUpdates(win: BrowserWindow) {
  if (!app.isPackaged) return
  if (process.platform === 'win32') {
    autoUpdater.autoDownload = true
    autoUpdater.on('error', () => undefined) // 오프라인·릴리스 없음은 조용히 무시
    autoUpdater.on('update-downloaded', (info) => send(win, { kind: 'downloaded', version: info.version }))
    autoUpdater.checkForUpdates().catch(() => undefined)
    return
  }
  fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((rel: { tag_name?: string } | null) => {
      if (rel?.tag_name && newer(rel.tag_name, app.getVersion())) {
        send(win, { kind: 'available', version: rel.tag_name.replace(/^v/, ''), url: RELEASES_URL })
      }
    })
    .catch(() => undefined)
}

export function installUpdate() {
  autoUpdater.quitAndInstall()
}

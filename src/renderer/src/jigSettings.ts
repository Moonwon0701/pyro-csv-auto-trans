import { DEFAULT_JIG_SETTINGS, type JigSettings } from '@engine/jig'

/** 치구 설정은 ① 치구 배치에서 바꾸고, ② 주소 매기기도 같은 값을 쓴다 (이 PC에만 저장) */
const KEY = 'jig-settings'

export function loadJigSettings(): JigSettings {
  try {
    return { ...DEFAULT_JIG_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_JIG_SETTINGS
  }
}

export function saveJigSettings(s: JigSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 저장 못 해도 이번 실행에는 쓸 수 있다 */
  }
}

export function describeJigSettings(s: JigSettings) {
  return `치구 ${s.rows}줄 × ${s.cols}칸 · ${s.priority === 'module' ? '모듈 수 먼저' : '치구 수 먼저'}${s.allowSpan ? ' · 모듈이 치구에 걸쳐도 됨' : ''}`
}

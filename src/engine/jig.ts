/**
 * 치구(단발 거치대) 배치: 치구 대상 위치(기본 S-*)의 약을 각도순으로 정렬해 모듈·치구로 나누고 주소를 다시 매긴다.
 *
 * 현장 규칙 (혜원 2026-09-29, 과거 쇼 샘플로 확인)
 * - 치구 하나는 4×5칸(가로 5칸 × 4줄). 모든 칸을 바닥 기준 30°까지 눕힐 수 있다.
 * - 가로 한 줄에서 바깥쪽은 많이 눕히고 가운데로 갈수록 세운다 → 줄마다 각도 오름차순으로 꽂으면 서로 겨누지 않는다.
 * - 직렬: 한 핀(CSV 한 행)에 약 QTY발. TILT는 발마다 '-'로 이어 적는다 ("-75--45-75" = -75, -45, 75).
 * - 치구마다 모듈을 미리 결선해서 현장에 가져간다. 모듈 하나가 치구 두 개에 걸치면 한쪽만 미리 결선할 수 있고
 *   나머지는 현장에서 결선해야 한다 (혜원 2026-09-29) → 기본은 모듈이 치구를 넘지 않게 (16핀 이하, 약 20발 이하).
 *   치구 하나에는 모듈 여러 개가 들어갈 수 있다. 걸침을 허용하면 치구는 줄지만 걸친 핀은 현장 결선 대상.
 * - TILT는 바닥 기준 각도(90 = 수직), 부호는 좌우.
 */
import { addressToIndex, assignAddresses, indexToAddress, MODULES, PINS_PER_MODULE, type AssignOptions, type AssignResult } from './assign'
import { detectColumns } from './columns'
import { parsePosition } from './position'
import { findPositionRule, findTypeRule } from './rules'
import type { Issue, ParsedCsv, RuleSet } from './types'

export const MIN_TILT = 30
export const VERTICAL = 90

/**
 * TILT(바닥 기준, 부호 = 좌우) → 수직에서 기운 정도 (왼쪽 음수, 오른쪽 양수).
 * -30 → -60, -75 → -15, 90 → 0, 30 → 60. 한 줄을 이 값 오름차순으로 꽂아야 튜브끼리 벌어진다.
 */
export const leanOf = (tilt: number) => (tilt >= 0 ? VERTICAL - tilt : -(VERTICAL + tilt))

/**
 * 치구 칸 각도 표기 (TILT와 같은 바닥 기준, 90 = 수직): ↖-30°, ↑90°, 75°↗.
 * 한 줄을 왼쪽부터 읽으면 -30 -40 … -80 90 80 … 30 순서다.
 */
export function tiltLabel(tilt: number): string {
  const lean = Math.round(leanOf(tilt))
  const angle = VERTICAL - Math.abs(lean)
  return lean < 0 ? `↖-${angle}°` : lean === 0 ? `↑${VERTICAL}°` : `${angle}°↗`
}

export interface JigSettings {
  /** 치구 줄 수 (앞뒤) */
  rows: number
  /** 한 줄의 칸 수 (좌우, 각도가 펼쳐지는 방향) */
  cols: number
  /** module: 모듈 수 먼저 줄이기 (과거 관행), jig: 치구 수 먼저 줄이기 */
  priority: 'module' | 'jig'
  /** 모듈이 치구 두 개에 걸치는 것 허용 (치구는 줄지만 걸친 핀은 현장 결선) */
  allowSpan: boolean
}

export const DEFAULT_JIG_SETTINGS: JigSettings = { rows: 4, cols: 5, priority: 'module', allowSpan: false }

export interface TiltParse {
  tilts: number[]
  /** 원본 각도를 알 수 없어 평균·기본값으로 채운 경우 */
  estimated: boolean
}

/**
 * TILT 문자열 → 발별 각도. 숫자 바로 뒤의 '-'만 구분자다 ("-60-60-90" = -60, 60, 90).
 * QTY보다 각도가 적으면 엑셀이 "-40-40"을 수식으로 계산해 버린 값(-80)으로 보고 평균으로 추정한다.
 */
export function parseTilts(raw: string, qty: number): TiltParse {
  const n = Math.max(1, qty)
  const text = raw.trim()
  if (!text) return { tilts: Array(n).fill(VERTICAL), estimated: false }
  const parts = text.split(/(?<=\d)-/).map(Number)
  if (parts.some((x) => !Number.isFinite(x))) return { tilts: Array(n).fill(VERTICAL), estimated: true }
  if (parts.length === n) return { tilts: parts, estimated: false }
  if (parts.length === 1) {
    const avg = parts[0] / n
    const ok = Math.abs(avg) >= MIN_TILT && Math.abs(avg) <= VERTICAL
    return { tilts: Array(n).fill(ok ? Math.round(avg) : VERTICAL), estimated: true }
  }
  // 개수가 안 맞으면 있는 값을 돌려 쓴다
  return { tilts: Array.from({ length: n }, (_, i) => parts[i % parts.length]), estimated: true }
}

/** CSV 한 행 = 핀 하나 */
export interface JigCue {
  /** csv.rows 인덱스 */
  rowIndex: number
  line: number
  effect: string
  time: string
  tilts: number[]
  estimated: boolean
  /** 새 주소 */
  address: string
}

export interface JigSlot {
  /** cues 인덱스 */
  cue: number
  /** 직렬 묶음 안에서 몇 번째 발인지 (1부터) */
  shot: number
  tilt: number
}

export interface Jig {
  /** 이 치구에 들어간 모듈 (FM-A 모듈 번호, 예: "36") */
  modules: string[]
  /** 미리 결선해 가는 모듈 (이 치구에 약이 가장 많은 모듈) */
  home: string[]
  shells: number
  /** [줄][칸], 빈 칸은 null. 줄마다 왼쪽→오른쪽 각도 오름차순 */
  grid: (JigSlot | null)[][]
}

export interface JigModule {
  module: string
  pins: number
  shells: number
}

export interface JigPosition {
  control: string
  pos: string
  cues: JigCue[]
  shells: number
  series: number
  modules: JigModule[]
  jigs: Jig[]
  /** 이론 하한 (모듈: 핀·발 기준, 치구: 발 기준) */
  lowerBound: { modules: number; jigs: number }
  /** 원래(1단계) 쓰던 모듈 수 */
  previousModules: number
  /** 원래 없던 모듈을 새로 쓴 경우 */
  addedModules: string[]
  /** 원래 모듈 중 필요 없어진 것 */
  freedModules: string[]
  /** 현장에서 결선해야 하는 핀 (모듈이 치구 두 개에 걸친 쪽의 cue 인덱스) */
  fieldWiring: number[]
}

export interface JigResult {
  csv: ParsedCsv
  positions: JigPosition[]
  issues: Issue[]
  blocked: boolean
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
const moduleOf = (index: number) => MODULES[Math.floor(index / PINS_PER_MODULE)]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Rule에 jig 표시가 없을 때 치구 대상으로 보는 접두어 (공용 Rule·예전 내 PC Rule에는 표시가 없다) */
export const DEFAULT_JIG_PREFIXES = ['S']

/** 위치 접두어가 치구 대상인지: Rule의 jig 표시, 없으면 기본 접두어 */
export function isJigPosition(rules: RuleSet, pos: string): boolean {
  const parsed = parsePosition(pos)
  if (!parsed) return false
  const rule = findPositionRule(rules.positionRules, parsed.prefix)
  if (!rule || rule.category !== '단발') return false
  return rule.jig ?? DEFAULT_JIG_PREFIXES.includes(parsed.prefix)
}

export interface Segmentation {
  /** 모듈마다 cue 인덱스 (각도순으로 이어진 구간) */
  modules: number[][]
  /** 치구마다 cue 인덱스 */
  jigs: number[][]
}

/**
 * 각도순으로 늘어선 핀들을 모듈·치구로 자른다 (앞에서부터 욕심껏 채우기: 연속 구간 나누기에서는 이게 최소).
 * 직렬 한 묶음(한 핀)은 치구를 나누지 않는다.
 */
export function segment(shells: number[], capacity: number, opts: Pick<JigSettings, 'priority' | 'allowSpan'>): Segmentation {
  const chunks = (items: number[], ok: (count: number, sum: number, q: number) => boolean) => {
    const out: number[][] = []
    let cur: number[] = []
    let sum = 0
    for (const i of items) {
      if (cur.length && !ok(cur.length, sum, shells[i])) {
        out.push(cur)
        cur = []
        sum = 0
      }
      cur.push(i)
      sum += shells[i]
    }
    if (cur.length) out.push(cur)
    return out
  }
  const all = shells.map((_, i) => i)
  const total = (xs: number[]) => xs.reduce((a, i) => a + shells[i], 0)
  const pinsOk = (count: number) => count < PINS_PER_MODULE
  const shellsOk = (_: number, sum: number, q: number) => sum + q <= capacity
  if (opts.allowSpan) {
    // 치구는 20발씩, 모듈은 16핀씩 따로 채운다 → 경계에 걸친 모듈은 현장 결선
    return { modules: chunks(all, pinsOk), jigs: chunks(all, shellsOk) }
  }
  if (opts.priority === 'jig') {
    // 치구를 20발까지 채운 뒤, 그 안을 16핀씩 모듈로
    const jigs = chunks(all, shellsOk)
    return { modules: jigs.flatMap((j) => chunks(j, pinsOk)), jigs }
  }
  // 모듈을 16핀·20발까지 채운 뒤, 이어지는 모듈끼리 20발 안에서 치구로 묶는다
  const modules = chunks(all, (count, sum, q) => pinsOk(count) && shellsOk(count, sum, q))
  const jigs: number[][] = []
  let cur: number[] = []
  for (const m of modules) {
    if (cur.length && total(cur) + total(m) > capacity) {
      jigs.push(cur)
      cur = []
    }
    cur.push(...m)
  }
  if (cur.length) jigs.push(cur)
  return { modules, jigs }
}

/**
 * 치구 안 칸 배치: 발을 각도순으로 늘어놓고 줄마다 번갈아 나눈다 → 줄마다 바깥은 눕고 가운데는 선 부채꼴.
 * 줄 안에서는 왼쪽부터 기운 정도(leanOf) 오름차순: 왼쪽 끝이 가장 왼쪽으로, 오른쪽 끝이 가장 오른쪽으로 눕는다.
 */
export function placeInGrid(slots: JigSlot[], rows: number, cols: number): (JigSlot | null)[][] {
  const sorted = [...slots].sort((a, b) => leanOf(a.tilt) - leanOf(b.tilt) || a.cue - b.cue || a.shot - b.shot)
  const perRow = Math.ceil(sorted.length / rows)
  const grid: (JigSlot | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))
  const lanes: JigSlot[][] = Array.from({ length: rows }, () => [])
  sorted.forEach((s, i) => lanes[perRow <= cols ? i % rows : Math.floor(i / cols)]?.push(s))
  lanes.forEach((lane, r) => lane.slice(0, cols).forEach((s, c) => (grid[r][c] = s)))
  return grid
}

/**
 * ② 주소 매기기: ① 치구 배치에서 정한 순서대로 주소를 매긴다 (혜원 2026-09-30: "치구 배치 후에 주소 배정").
 * - 치구 대상(단발) 위치: 각도순 → 모듈·치구 나누기 → 모듈마다 0번 핀부터
 * - 그 밖의 위치(타상·연발): 지금 규칙(효과순/시간순) 그대로
 * - 이미 주소가 있던 단발 위치는 다시 매기지 않는다 (기존 주소 유지)
 */
export function assignWithJigs(
  csv: ParsedCsv,
  opts: AssignOptions,
  rules: RuleSet,
  settings: JigSettings = DEFAULT_JIG_SETTINGS
): AssignResult & { jigPositions: JigPosition[] } {
  const base = assignAddresses(csv, opts)
  if (base.blocked) return { ...base, jigPositions: [] }
  const cols = detectColumns(csv.headers)
  const cell = (r: string[], k: 'CONTROL' | 'POS' | 'ADDR') => {
    const i = cols.get(k)
    return i === undefined ? '' : (r[i] ?? '').trim()
  }
  const hadAddress = new Set(csv.rows.filter((r) => cell(r, 'ADDR')).map((r) => `${cell(r, 'CONTROL')}\u0000${cell(r, 'POS')}`))
  const jig = planJigs(base.csv, rules, settings, { only: (control, pos) => !hadAddress.has(`${control}\u0000${pos}`) })
  const kept = [...hadAddress].map((k) => k.split('\u0000')).filter(([, pos]) => isJigPosition(rules, pos))
  const issues = [...base.issues, ...jig.issues.filter((i) => i.code !== 'JIG_NONE')]
  if (kept.length) {
    issues.push({
      code: 'JIG_KEPT_EXISTING',
      severity: 'info',
      message: '이미 주소가 있던 단발 위치는 치구 순서로 다시 매기지 않고 그대로 두었습니다.',
      details: kept.map(([c, p]) => `${c ? c + ' ' : ''}${p}`),
      count: kept.length
    })
  }
  // 요약의 주소 범위를 치구 순서로 매긴 결과로
  const summary = base.summary.map((s) => {
    const p = jig.positions.find((x) => x.control === s.control && x.pos === s.pos)
    if (!p) return s
    const idx = p.cues.map((c) => addressToIndex(c.address)!).sort((a, b) => a - b)
    return { ...s, range: `${indexToAddress(idx[0])} ~ ${indexToAddress(idx[idx.length - 1])} (치구 ${p.jigs.length})` }
  })
  return { csv: jig.csv, issues, blocked: base.blocked || jig.blocked, summary, jigPositions: jig.positions }
}

/**
 * 치구 대상 위치마다 치구 배치에 필요한 모듈 수 (주소 없이 계산). ② 자동 배정이 그만큼 모듈을 비워 두게 한다.
 * 키: `${control}\u0000${pos}`
 */
export function jigModuleNeeds(csv: ParsedCsv, rules: RuleSet, settings: JigSettings = DEFAULT_JIG_SETTINGS): Map<string, number> {
  const cols = detectColumns(csv.headers)
  const get = (row: string[], k: Parameters<typeof cols.get>[0]) => {
    const i = cols.get(k)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }
  const byPos = new Map<string, { lean: number; shells: number }[]>()
  for (const r of csv.rows) {
    if (!isJigPosition(rules, get(r, 'POS'))) continue
    const t = findTypeRule(rules.typeRules, get(r, 'TYPE'))
    if (t && t.category !== '단발') continue
    const qty = Math.max(1, parseInt(get(r, 'QTY'), 10) || 1)
    const tilts = parseTilts(get(r, 'TILT'), qty).tilts
    const key = `${get(r, 'CONTROL')}\u0000${get(r, 'POS')}`
    if (!byPos.has(key)) byPos.set(key, [])
    byPos.get(key)!.push({ lean: mean(tilts.map(leanOf)), shells: tilts.length })
  }
  const needs = new Map<string, number>()
  for (const [key, cues] of byPos) {
    cues.sort((a, b) => a.lean - b.lean)
    needs.set(key, segment(cues.map((c) => c.shells), settings.rows * settings.cols, settings).modules.length)
  }
  return needs
}

/**
 * 치구 대상 위치의 주소를 각도순으로 다시 매긴다. 다른 위치·치구 대상이 아닌 행(cake 등)은 건드리지 않는다.
 * 위치마다 1단계에서 받은 모듈을 먼저 쓰고, 모자라면 Control의 빈 모듈을 뒤에서 이어 쓴다.
 */
export function planJigs(
  csv: ParsedCsv,
  rules: RuleSet,
  settings: JigSettings = DEFAULT_JIG_SETTINGS,
  opts: {
    /** 이 위치만 다시 매긴다 (없으면 치구 대상 전부) */
    only?: (control: string, pos: string) => boolean
    /**
     * 주소 없이 치구만 배치해 본다 (① 치구 배치 화면). 모듈은 위치마다 M1, M2 …, 핀 주소는 "M1-3"(M1의 3번 핀).
     * 실제 주소는 ② 주소 매기기에서 같은 순서로 붙는다.
     */
    preview?: boolean
  } = {}
): JigResult {
  const { only, preview } = opts
  const cols = detectColumns(csv.headers)
  const get = (row: string[], k: Parameters<typeof cols.get>[0]) => {
    const i = cols.get(k)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }
  const issues: Issue[] = []
  const warn = (code: string, severity: Issue['severity'], message: string, details: string[] = []) => {
    const existing = issues.find((i) => i.code === code)
    if (existing) {
      existing.details = [...(existing.details ?? []), ...details].slice(0, 100)
      existing.count = (existing.count ?? 1) + details.length
    } else issues.push({ code, severity, message, details: details.slice(0, 100), count: Math.max(1, details.length) })
  }
  const rows = csv.rows.map((r) => [...r])
  const capacity = settings.rows * settings.cols

  if (!preview && !cols.has('ADDR')) {
    warn('JIG_NO_ADDR', 'blocking', 'ADDR(FM-A 주소) 컬럼이 없어 주소를 치구 순서로 매길 수 없습니다. ② 주소 매기기를 먼저 하세요.')
    return { csv, positions: [], issues, blocked: true }
  }
  const addrCol = cols.get('ADDR')
  const time = (r: string[]) => (['HH', 'MM', 'SS', 'FF'] as const).map((k) => get(r, k).padStart(2, '0')).join(':')
  const isTarget = (r: string[]) => {
    if (!isJigPosition(rules, get(r, 'POS'))) return false
    // 같은 위치에 놓인 cake(연발)·타상은 치구에 꽂지 않는다
    const t = findTypeRule(rules.typeRules, get(r, 'TYPE'))
    return !t || t.category === '단발'
  }

  // Control별로 모듈이 누구 것인지: 한 위치의 치구 대상 행만 쓰는 모듈이어야 그 위치가 다시 쓸 수 있다
  const byControl = new Map<string, { targets: Map<string, number[]>; owners: Map<string, Set<string>> }>()
  const ctl = (c: string) => {
    if (!byControl.has(c)) byControl.set(c, { targets: new Map(), owners: new Map() })
    return byControl.get(c)!
  }
  rows.forEach((r, i) => {
    const c = ctl(get(r, 'CONTROL'))
    const pos = get(r, 'POS')
    const target = isTarget(r)
    if (target) {
      if (!c.targets.has(pos)) c.targets.set(pos, [])
      c.targets.get(pos)!.push(i)
    }
    const idx = addressToIndex(get(r, 'ADDR'))
    if (idx === null) return
    const m = moduleOf(idx)
    if (!c.owners.has(m)) c.owners.set(m, new Set())
    c.owners.get(m)!.add(target ? `T:${pos}` : `X:${pos}`)
  })

  const positions: JigPosition[] = []
  for (const [control, { targets, owners }] of [...byControl].sort((a, b) => naturalCompare(a[0], b[0]))) {
    const taken = new Set([...owners.keys()])
    for (const [pos, rowIdx] of [...targets].sort((a, b) => naturalCompare(a[0], b[0]))) {
      if (only && !only(control, pos)) continue
      const label = `${control ? control + ' ' : ''}${pos}`
      const cues: JigCue[] = rowIdx.map((i) => {
        const qty = Math.max(1, parseInt(get(rows[i], 'QTY'), 10) || 1)
        const t = parseTilts(get(rows[i], 'TILT'), qty)
        const line = csv.lineNumbers[i]
        if (t.estimated) warn('JIG_TILT_ESTIMATED', 'warning', '직렬 각도가 엑셀에서 계산된 값으로 보입니다 (예: -40-40 → -80). 평균값으로 추정해 배치했습니다. 원본 CSV를 쓰면 정확합니다.', [`${line}행 ${label}: TILT=${get(rows[i], 'TILT')}, QTY=${qty}`])
        const low = t.tilts.filter((x) => Math.abs(x) < MIN_TILT)
        if (low.length && !t.estimated) warn('JIG_TILT_LOW', 'warning', `바닥 기준 ${MIN_TILT}°보다 더 눕힌 각도가 있습니다. 치구로는 ${MIN_TILT}°까지만 눕힐 수 있습니다.`, [`${line}행 ${label}: ${low.join(', ')}°`])
        return { rowIndex: i, line, effect: get(rows[i], 'EFFECT'), time: time(rows[i]), tilts: t.tilts, estimated: t.estimated, address: '' }
      })
      const lean = (c: JigCue) => mean(c.tilts.map(leanOf))
      cues.sort((a, b) => lean(a) - lean(b) || naturalCompare(a.effect, b.effect) || naturalCompare(a.time, b.time) || a.rowIndex - b.rowIndex)
      const shells = cues.map((c) => c.tilts.length)
      const over = cues.filter((c) => c.tilts.length > capacity)
      if (over.length) warn('JIG_CUE_TOO_BIG', 'warning', `한 핀에 치구 한 개(${capacity}칸)보다 많은 약이 직렬로 걸려 있습니다. 치구 하나를 따로 씁니다.`, over.map((c) => `${c.line}행 ${label}: ${c.tilts.length}발`))

      const plan = segment(shells, capacity, settings)
      const moduleCount = plan.modules.length

      // 모듈 고르기: 원래 쓰던 모듈(이 위치의 치구 대상만 쓰던 것) → 모자라면 그 뒤의 빈 모듈
      const previous = new Set(
        rowIdx.map((i) => addressToIndex(get(rows[i], 'ADDR'))).filter((x): x is number => x !== null).map(moduleOf)
      )
      const own = preview ? [] : [...previous].filter((m) => [...owners.get(m)!].every((o) => o === `T:${pos}`))
      own.sort((a, b) => MODULES.indexOf(a) - MODULES.indexOf(b))
      const chosen = preview ? Array.from({ length: moduleCount }, (_, k) => `M${k + 1}`) : own.slice(0, moduleCount)
      const added: string[] = []
      let cursor = own.length ? MODULES.indexOf(own[own.length - 1]) + 1 : 0
      while (chosen.length < moduleCount) {
        while (cursor < MODULES.length && taken.has(MODULES[cursor])) cursor++
        if (cursor >= MODULES.length) break
        const m = MODULES[cursor++]
        taken.add(m)
        chosen.push(m)
        added.push(m)
      }
      if (chosen.length < moduleCount) {
        warn('JIG_OUT_OF_MODULES', 'blocking', `${label}: 쓸 수 있는 모듈이 모자랍니다 (필요 ${moduleCount}, 가능 ${chosen.length}).`)
        continue
      }
      const freed = own.slice(moduleCount)
      // 자동 배정이 비워 둔 바로 다음 모듈이면 정상. 떨어진 모듈을 끌어왔을 때만 알린다
      const lastOwn = own.length ? MODULES.indexOf(own[own.length - 1]) : -1
      const contiguous = own.length > 0 && added.every((m, k) => MODULES.indexOf(m) === lastOwn + 1 + k)
      if (added.length && !contiguous) {
        warn('JIG_MODULE_ADDED', 'info', '치구 배치에 필요한 모듈이 주소 범위보다 많아 비어 있는 모듈을 가져다 썼습니다. 주소 범위를 넉넉히 잡으면 모듈 번호가 이어집니다.', [
          `${label}: ${added.join(', ')}`
        ])
      }

      // 주소 쓰기: 각도순 그대로 모듈마다 0번 핀부터
      const moduleOfCue: string[] = []
      const modules: JigModule[] = plan.modules.map((cueList, k) => {
        const m = chosen[k]
        cueList.forEach((ci, pin) => {
          if (preview) cues[ci].address = `${m}-${pin.toString(16).toUpperCase()}`
          else {
            const address = indexToAddress(addressToIndex(`${m}0`)! + pin)
            cues[ci].address = address
            rows[cues[ci].rowIndex][addrCol!] = address
          }
          moduleOfCue[ci] = m
        })
        return { module: m, pins: cueList.length, shells: cueList.reduce((a, ci) => a + shells[ci], 0) }
      })
      // 모듈마다 약이 가장 많은 치구에 미리 결선해 간다. 나머지 치구로 간 핀은 현장 결선
      const jigOfCue: number[] = []
      plan.jigs.forEach((cueList, j) => cueList.forEach((ci) => (jigOfCue[ci] = j)))
      const homeOf = new Map<string, number>()
      for (const { module: m } of modules) {
        const count = new Map<number, number>()
        cues.forEach((_, ci) => moduleOfCue[ci] === m && count.set(jigOfCue[ci], (count.get(jigOfCue[ci]) ?? 0) + shells[ci]))
        homeOf.set(m, [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0])
      }
      const fieldWiring = cues.flatMap((_, ci) => (homeOf.get(moduleOfCue[ci]) === jigOfCue[ci] ? [] : [ci]))
      if (fieldWiring.length) {
        warn('JIG_FIELD_WIRING', 'info', '모듈이 치구 두 개에 걸쳐서 현장에서 결선할 핀이 있습니다.', [
          `${label}: ${fieldWiring.map((ci) => cues[ci].address).join(', ')}`
        ])
      }
      const jigs: Jig[] = plan.jigs.map((cueList, j) => {
        const slots = cueList.flatMap((ci) => cues[ci].tilts.map((tilt, k) => ({ cue: ci, shot: k + 1, tilt })))
        const names = [...new Set(cueList.map((ci) => moduleOfCue[ci]))]
        return {
          modules: names,
          home: names.filter((m) => homeOf.get(m) === j),
          shells: slots.length,
          grid: placeInGrid(slots, settings.rows, Math.max(settings.cols, Math.ceil(slots.length / settings.rows)))
        }
      })

      const totalShells = shells.reduce((a, b) => a + b, 0)
      positions.push({
        control,
        pos,
        cues,
        shells: totalShells,
        series: cues.filter((c) => c.tilts.length > 1).length,
        modules,
        jigs,
        lowerBound: {
          modules: Math.max(Math.ceil(cues.length / PINS_PER_MODULE), Math.ceil(totalShells / capacity)),
          jigs: Math.ceil(totalShells / capacity)
        },
        previousModules: previous.size,
        addedModules: added,
        freedModules: freed,
        fieldWiring
      })
    }
  }

  // MODULE/PIN 컬럼에 값이 있던 파일이면 같이 맞춘다
  const mCol = cols.get('MODULE')
  const pCol = cols.get('PIN')
  if (!preview && mCol !== undefined && pCol !== undefined) {
    for (const p of positions)
      for (const c of p.cues) {
        const r = rows[c.rowIndex]
        if (r[mCol] || r[pCol]) {
          r[mCol] = c.address.slice(0, 2)
          r[pCol] = c.address.slice(2)
        }
      }
  }

  if (!positions.length && !issues.some((i) => i.severity === 'blocking')) {
    warn('JIG_NONE', 'info', '치구 대상 위치가 없습니다. Rule 관리에서 치구에 꽂는 위치(예: S-*)를 표시하세요.')
  }
  return { csv: { ...csv, rows }, positions, issues, blocked: issues.some((i) => i.severity === 'blocking') }
}

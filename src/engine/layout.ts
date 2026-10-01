/**
 * 레이아웃 시트: 위치마다 쓰는 모듈과 발수를 현장 배치 모양대로 펼친다 (샘플: 26 거제옥포 LAYOUT.xlsx).
 *
 * - 줄 = Control × 위치 접두어 (6P, 5P, 4P, 3P … / C, S, G …). 타상 줄이 위, 연발·단발 줄이 아래.
 * - 위치는 번호에 비례해 E~AC 열에 가로로 놓는다. 타상은 P-01끼리 세로로 맞도록 타상 전체 최대 번호 기준.
 * - 모듈 칸: FM-A는 "36F" (모듈 36을 F핀까지), MODULE-PIN은 "6-31". 타상은 발수를 붙인다: "3FF (19)"
 * - 오른쪽: 인치(CAL) · 발수 · 모듈 수량. 단발 치구 대상 줄은 치구 수도.
 * - 거리(<<--6M-->>)와 타상 각도(↖15°)는 CSV에 없어 비워 둔다.
 */
import { normalizeAddress } from './assign'
import { detectColumns } from './columns'
import { tiltLabel, planJigs, type JigPosition, type JigSettings } from './jig'
import { parsePosition } from './position'
import { findPositionRule, findTypeRule } from './rules'
import { CATEGORIES, EXCLUDE, type Category, type ParsedCsv, type Resolution, type RuleSet } from './types'

export interface LayoutModuleEntry {
  module: string
  lastPin: string
  shells: number
  /** 셀에 적는 글자: "36F" 또는 "3FF (19)" */
  label: string
}

export interface LayoutPosition {
  pos: string
  number: number
  modules: LayoutModuleEntry[]
  shells: number
  jigs?: number
}

export interface LayoutLine {
  control: string
  category: Category
  prefix: string
  positions: LayoutPosition[]
  shells: number
  modules: number
  jigs?: number
  /** 인치 (타상: CAL) 또는 종류 (SINGLE, CAKE …) */
  kind: string
}

/** 칸 서식 (색은 ARGB, 예: FF783E94) */
export interface CellFormat {
  size?: number
  bold?: boolean
  color?: string
  fill?: string
  border?: Partial<Record<'top' | 'left' | 'bottom' | 'right', 'thin' | 'medium'>>
  wrap?: boolean
}

export interface GridCell {
  row: number
  col: number
  value: string
  style?: 'title' | 'section' | 'header' | 'pos' | 'module' | 'total' | 'control' | 'slot' | 'slot-field' | 'slot-estimated' | 'note'
  /** style 대신 직접 지정 (LAYOUT은 이전 양식 그대로) */
  format?: CellFormat
}

/** 표가 아니라 칸 위치를 직접 정하는 시트 (레이아웃, 치구 배치도) */
export interface GridSheet {
  name: string
  cells: GridCell[]
  /** 열 너비 (1부터, 없으면 기본) */
  widths?: Record<number, number>
  /** 줄 높이 (1부터) */
  heights?: Record<number, number>
  /** 병합: [윗줄, 왼칸, 아랫줄, 오른칸] */
  merges?: [number, number, number, number][]
  /** 가로 한 장에 맞춰 인쇄 */
  fitLandscape?: boolean
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/**
 * LAYOUT 칸 배치·서식: 퐁피두 LAYOUT(2026-09, 혜원 팀 최신 양식) 기준.
 * 위치는 E~U, 오른쪽 요약은 X(인치/종류)·Y(발수)·Z(모듈수량). 5개면 E·I·M·Q·U, 9개면 E·G·I…U.
 */
const FIRST_COL = 5 // E
const LAST_COL = 21 // U
const SUMMARY_COL = 24 // X
/** 무대 테두리(하늘색)는 C열~W열 */
const FRAME_LEFT = 3 // C
const FRAME_RIGHT = 23 // W
const COLOR = {
  name: 'FFFFD700', // 위치 이름 칸
  angle: 'FFD9D9D9', // 타상 각도 칸 (빨간 글씨)
  red: 'FFFF0000',
  black: 'FF000000',
  purple: 'FF783E94', // 단발·연발 모듈 칸
  white: 'FFFFFFFF',
  kind: 'FF92D050', // 요약: 인치·종류
  count: 'FFD0CECE', // 요약: 발수
  modules: 'FFFFF2CC', // 요약: 모듈수량
  band: 'FFFFD966', // 왼쪽 구역 이름 열, 맨 아래 줄
  frame: 'FFBDD7EE' // 무대 테두리
}
const SMALL = 15

export function layoutLines(csv: ParsedCsv, rules: RuleSet, resolutions: Record<string, Resolution> = {}, jig: JigPosition[] = []): LayoutLine[] {
  const cols = detectColumns(csv.headers)
  const get = (row: string[], k: Parameters<typeof cols.get>[0]) => {
    const i = cols.get(k)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }
  /** 구경 (타상 인치). 엔진 표준 컬럼이 아니라 이름으로 찾는다 */
  const calCol = csv.headers.findIndex((h) => h.trim().toUpperCase() === 'CAL')
  const lines = new Map<string, LayoutLine & { byPos: Map<string, { number: number; mods: Map<string, { last: number; shells: number; sep: string }>; shells: number }>; cal: Map<string, number> }>()

  for (const row of csv.rows) {
    const posRaw = get(row, 'POS')
    const parsed = parsePosition(posRaw)
    if (!parsed) continue
    const rule = findPositionRule(rules.positionRules, parsed.prefix)
    const res: Resolution | undefined = rule?.category ?? resolutions[parsed.prefix] ?? findTypeRule(rules.typeRules, get(row, 'TYPE'))?.category
    if (!res || res === EXCLUDE) continue
    // 주소 → 모듈·핀
    let module = ''
    let pin = NaN
    let sep = ''
    const addr = get(row, 'ADDR').toUpperCase()
    if (/^[0-9A-F]{2,3}$/.test(addr)) {
      const a = addr.padStart(3, '0')
      module = a.slice(0, 2)
      pin = parseInt(a[2], 16)
    } else if (get(row, 'MODULE') && get(row, 'PIN')) {
      module = get(row, 'MODULE')
      pin = parseInt(get(row, 'PIN'), 10)
      sep = '-'
    }
    const control = get(row, 'CONTROL')
    const key = `${control}\u0000${parsed.prefix}`
    let line = lines.get(key)
    if (!line) {
      line = { control, category: res, prefix: parsed.prefix, positions: [], shells: 0, modules: 0, kind: '', byPos: new Map(), cal: new Map() }
      lines.set(key, line)
    }
    const qty = Math.max(1, parseInt(get(row, 'QTY'), 10) || 1)
    let p = line.byPos.get(posRaw)
    if (!p) line.byPos.set(posRaw, (p = { number: parsed.number, mods: new Map(), shells: 0 }))
    p.shells += qty
    const cal = calCol < 0 ? '' : (row[calCol] ?? '').trim()
    if (cal) line.cal.set(cal, (line.cal.get(cal) ?? 0) + qty)
    if (module && Number.isFinite(pin)) {
      const m = p.mods.get(module) ?? { last: -1, shells: 0, sep }
      m.last = Math.max(m.last, pin)
      m.shells += qty
      p.mods.set(module, m)
    }
  }

  const jigCount = new Map(jig.map((j) => [`${j.control}\u0000${j.pos}`, j.jigs.length]))
  const result: LayoutLine[] = []
  for (const line of lines.values()) {
    const isShell = line.category === '타상'
    // FM-A 모듈은 16진수 순서 (48 < 49 < 4A), MODULE-PIN은 숫자 순서
    const modSort = (a: string, b: string) => parseInt(a, 16) - parseInt(b, 16) || naturalCompare(a, b)
    line.positions = [...line.byPos]
      .map(([pos, p]) => {
        const modules = [...p.mods]
          .sort((a, b) => modSort(a[0], b[0]))
          .map(([module, m]) => {
            const lastPin = m.sep ? String(m.last) : m.last.toString(16).toUpperCase()
            const base = `${module}${m.sep}${lastPin}`
            return { module, lastPin, shells: m.shells, label: isShell ? `${base} (${m.shells})` : base }
          })
        const jigs = jigCount.get(`${line.control}\u0000${pos}`)
        return { pos, number: p.number, modules, shells: p.shells, ...(jigs !== undefined ? { jigs } : {}) }
      })
      .sort((a, b) => a.number - b.number)
    line.positions = mergeSharedModules(line.positions, isShell)
    line.shells = line.positions.reduce((a, p) => a + p.shells, 0)
    line.modules = line.positions.reduce((a, p) => a + p.modules.length, 0)
    const jigs = line.positions.filter((p) => p.jigs !== undefined)
    if (jigs.length) line.jigs = jigs.reduce((a, p) => a + p.jigs!, 0)
    const cal = [...line.cal].sort((a, b) => b[1] - a[1])[0]?.[0]
    line.kind = isShell ? (cal ? `${cal}"` : '') : line.category === '연발' ? 'CAKE' : 'SINGLE'
    const { byPos: _b, cal: _c, ...clean } = line
    result.push(clean)
  }

  // 타상 줄: Control → 인치 큰 것부터 → 접두어. 그 밖: Control → 연발·단발 → 기본 접두어(C/S) 먼저 → 이름순
  const inch = (l: LayoutLine) => parseFloat(l.kind) || 0
  const base = (l: LayoutLine) => (l.prefix === 'C' || l.prefix === 'S' ? 0 : 1)
  return result.sort(
    (a, b) =>
      Number(a.category !== '타상') - Number(b.category !== '타상') ||
      naturalCompare(a.control, b.control) ||
      (a.category === '타상' ? inch(b) - inch(a) : CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || base(a) - base(b)) ||
      naturalCompare(a.prefix, b.prefix)
  )
}

/**
 * 한 줄의 위치들이 모듈을 모두 나눠 쓰면 (예: H1-01~16이 모듈 2D·2F·30·31의 핀을 하나씩) 한 칸으로 합친다.
 * 사람이 만든 레이아웃도 "H-01: 2DF 2FF 30F 31F"처럼 적는다.
 */
function mergeSharedModules(positions: LayoutPosition[], isShell: boolean): LayoutPosition[] {
  if (positions.length < 2) return positions
  const users = new Map<string, number>()
  for (const p of positions) for (const m of p.modules) users.set(m.module, (users.get(m.module) ?? 0) + 1)
  if (users.size === 0 || [...users.values()].some((n) => n < 2)) return positions
  const merged = new Map<string, LayoutModuleEntry>()
  for (const p of positions)
    for (const m of p.modules) {
      const cur = merged.get(m.module)
      const sep = m.label.includes('-') ? '-' : ''
      const last = cur && parseInt(cur.lastPin, sep ? 10 : 16) > parseInt(m.lastPin, sep ? 10 : 16) ? cur.lastPin : m.lastPin
      const shells = (cur?.shells ?? 0) + m.shells
      const base = `${m.module}${sep}${last}`
      merged.set(m.module, { module: m.module, lastPin: last, shells, label: isShell ? `${base} (${shells})` : base })
    }
  const first = positions[0]
  const last = positions[positions.length - 1]
  return [
    {
      pos: `${first.pos}~${last.pos}`,
      number: 1,
      modules: [...merged.values()].sort((a, b) => parseInt(a.module, 16) - parseInt(b.module, 16) || naturalCompare(a.module, b.module)),
      shells: positions.reduce((a, p) => a + p.shells, 0)
    }
  ]
}

/**
 * 레이아웃 줄 → 격자 시트 (퐁피두 LAYOUT 양식).
 * 내용이 달라도 칸 모양·색·글꼴은 이전 양식과 같게 해서 현장 혼선을 줄인다.
 * 거리(<<------ M------>>)와 타상 각도 칸은 자리만 만들어 두고 비워 둔다 (CSV에 없음).
 */
export function layoutSheet(title: string, lines: LayoutLine[]): GridSheet {
  const cells = new Map<string, GridCell>()
  const merges: GridSheet['merges'] = []
  /** 같은 칸에 두 번 쓰면 나중 것 (테두리 칸을 내용이 덮을 수 있게) */
  const put = (row: number, col: number, value: string, format: CellFormat) => cells.set(`${row}:${col}`, { row, col, value, format })
  const box = { top: 'thin', left: 'thin', right: 'thin', bottom: 'thin' } as const
  const colOf = (n: number, max: number) => (max <= 1 ? Math.round((FIRST_COL + LAST_COL) / 2) : FIRST_COL + Math.round(((n - 1) * (LAST_COL - FIRST_COL)) / (max - 1)))
  const shellMax = Math.max(1, ...lines.filter((l) => l.category === '타상').flatMap((l) => l.positions.map((p) => p.number)))

  put(1, 1, `* ${title} LAYOUT`, { size: SMALL, bold: true })
  const frameTop = 3
  // 오른쪽 요약 머리글
  put(frameTop + 1, SUMMARY_COL, '인치', { size: SMALL, bold: true, fill: COLOR.kind, border: box })
  put(frameTop + 1, SUMMARY_COL + 1, '발수', { size: SMALL, bold: true, fill: COLOR.count, border: box })
  put(frameTop + 1, SUMMARY_COL + 2, '모듈수량', { size: SMALL, bold: true, fill: COLOR.modules, border: box })

  let row = frameTop + 2
  let totalModules = 0
  const sections: { shell: boolean; lines: LayoutLine[]; start: number; end: number }[] = []
  for (const line of lines) {
    const shell = line.category === '타상'
    if (sections.at(-1)?.shell !== shell) sections.push({ shell, lines: [], start: 0, end: 0 })
    sections.at(-1)!.lines.push(line)
  }

  for (const sec of sections) {
    sec.start = row
    let lastControl: string | null = null
    for (const line of sec.lines) {
      if (line.control !== lastControl && line.control) {
        put(row, FRAME_LEFT + 1, line.control, { size: SMALL, bold: true })
        lastControl = line.control
      }
      const isShell = line.category === '타상'
      // 한 칸으로 합친 줄(H1-01~H1-16)은 가운데
      const merged = line.positions.length === 1 && line.positions[0].pos.includes('~')
      const max = merged ? 1 : isShell ? shellMax : Math.max(1, ...line.positions.map((p) => p.number))

      // 오른쪽 요약: 인치·종류 / 발수 (단발은 치구 수) / 모듈수량
      put(row, SUMMARY_COL, line.kind, { size: SMALL, bold: true, fill: COLOR.kind, border: box })
      const count = isShell ? String(line.shells) : line.jigs !== undefined ? `치구 ${line.jigs}` : ''
      put(row, SUMMARY_COL + 1, count, { size: SMALL, bold: true, fill: COLOR.count, border: box })
      put(row, SUMMARY_COL + 2, String(line.modules), { size: SMALL, bold: true, fill: COLOR.modules, border: box })
      totalModules += line.modules

      const cols = line.positions.map((p) => colOf(p.number, max))
      let height = 0
      line.positions.forEach((p, i) => {
        const col = cols[i]
        put(row, col, p.pos, { size: SMALL, bold: true, fill: COLOR.name, border: box })
        // 타상: 이름 옆 각도 칸(회색, 빨간 글씨) — CSV에 없어 비워 둠
        if (isShell) put(row, col + 1, '', { size: SMALL, bold: true, color: COLOR.red, fill: COLOR.angle, border: box })
        // 다음 위치까지 거리 화살표 (거리는 비워 둠)
        const next = cols[i + 1]
        if (next !== undefined) {
          const from = col + (isShell ? 2 : 1)
          const to = next - 1
          if (to >= from) {
            put(row, from, to > from ? '<<------ M------>>' : '<<-- M-->>', { size: SMALL, bold: true })
            if (to > from) merges.push([row, from, row, to])
          }
        }
        if (isShell) {
          // 타상: 검은 칸에 모듈 두 개씩 "3FF (19)", 그 아래 흰 칸 "발수 | 발"
          const h = Math.max(1, Math.ceil(p.modules.length / 2))
          for (let r = 0; r < h; r++)
            for (let c = 0; c < 2; c++) {
              const m = p.modules[r * 2 + c]
              put(row + 1 + r, col + c, m?.label ?? '', { size: SMALL, bold: true, color: COLOR.white, fill: COLOR.black, border: box })
            }
          put(row + 1 + h, col, String(p.shells), { size: SMALL, bold: true, border: box })
          put(row + 1 + h, col + 1, '발', { size: SMALL, bold: true, border: box })
          height = Math.max(height, h + 1)
        } else {
          // 단발·연발: 보라 칸에 모듈 하나씩
          p.modules.forEach((m, k) => put(row + 1 + k, col, m.label, { size: SMALL, bold: true, color: COLOR.white, fill: COLOR.purple, border: box }))
          height = Math.max(height, p.modules.length)
        }
      })
      row += height + 2
    }
    sec.end = row - 2
  }

  // 무대 테두리 (하늘색): 위·아래 줄, 왼쪽·오른쪽 열
  const frameBottom = row - 1
  for (let c = FRAME_LEFT; c <= FRAME_RIGHT; c++) {
    put(frameTop, c, '', { fill: COLOR.frame })
    put(frameBottom, c, '', { fill: COLOR.frame })
  }
  for (let r = frameTop + 1; r < frameBottom; r++) {
    if (!cells.has(`${r}:${FRAME_LEFT}`)) put(r, FRAME_LEFT, '', { fill: COLOR.frame })
    put(r, FRAME_RIGHT, '', { fill: COLOR.frame })
  }

  // 왼쪽 구역 이름 열 (금색): 첫 구역은 테두리 위쪽부터, 마지막 구역은 아래쪽까지
  sections.forEach((sec, i) => {
    const top = i === 0 ? frameTop : sec.start
    const bottom = i === sections.length - 1 ? frameBottom : sections[i + 1].start - 1
    put(top, 2, sec.shell ? 'shell' : 'cake\n&\nsingle\nshot', { size: SMALL, fill: COLOR.band, wrap: true })
    for (let r = top + 1; r <= bottom; r++) put(r, 2, '', { fill: COLOR.band })
    if (bottom > top) merges.push([top, 2, bottom, 2])
  })

  // 맨 아래 금색 줄: 관객 방향 + 전체 모듈 수
  const bottomRow = frameBottom + 1
  put(bottomRow, FRAME_LEFT, '관객', { size: SMALL, bold: true, fill: COLOR.band })
  merges.push([bottomRow, FRAME_LEFT, bottomRow, SUMMARY_COL])
  put(bottomRow, SUMMARY_COL + 1, String(totalModules), { size: SMALL, bold: true, fill: COLOR.band })
  put(bottomRow, SUMMARY_COL + 2, 'EA', { size: SMALL, bold: true, fill: COLOR.band })

  const widths: Record<number, number> = { 1: 7.625, 2: 12, [FRAME_LEFT]: 6, [FRAME_RIGHT]: 6 }
  for (let c = FIRST_COL - 1; c <= SUMMARY_COL + 2; c++) if (c !== FRAME_RIGHT) widths[c] = c >= SUMMARY_COL ? 16 : 14
  const heights: Record<number, number> = {}
  for (let r = 2; r <= bottomRow; r++) heights[r] = 24
  return { name: 'LAYOUT', cells: [...cells.values()], widths, heights, merges, fitLandscape: true }
}

/**
 * ③ 시트 정리 Excel 맨 앞에 붙일 LAYOUT·치구 배치도.
 * 치구 배치도는 단발 주소가 이미 치구 순서(① 결과)일 때만 넣는다. 아니면 배치도의 주소가 시트와 달라지기 때문.
 */
export function extraSheets(
  csv: ParsedCsv,
  rules: RuleSet,
  resolutions: Record<string, Resolution>,
  settings: JigSettings,
  opts: { layout: boolean; jig: boolean; title: string }
): { grids: GridSheet[]; notes: string[] } {
  const notes: string[] = []
  const plan = opts.layout || opts.jig ? planJigs(csv, rules, settings) : null
  const cols = detectColumns(csv.headers)
  const addrCol = cols.get('ADDR')
  const arranged =
    !!plan &&
    !plan.blocked &&
    plan.positions.length > 0 &&
    addrCol !== undefined &&
    plan.positions.every((p) => p.cues.every((c) => normalizeAddress(csv.rows[c.rowIndex][addrCol] ?? '') === c.address))
  const grids: GridSheet[] = []
  if (opts.layout) grids.push(layoutSheet(opts.title, layoutLines(csv, rules, resolutions, arranged ? plan!.positions : [])))
  if (opts.jig && plan && plan.positions.length) {
    if (arranged) grids.push(jigSheet(plan.positions, settings.cols))
    else notes.push('단발 주소가 치구 순서로 매겨지지 않은 파일이라 치구 배치도는 넣지 않았습니다.')
  }
  return { grids, notes }
}

/** 치구 배치도: 위치마다 치구를 가로로 늘어놓고, 치구마다 줄×칸 격자 */
export function jigSheet(positions: JigPosition[], cols: number): GridSheet {
  const cells: GridCell[] = []
  const put = (row: number, col: number, value: string, style?: GridCell['style']) => value !== '' && cells.push({ row, col, value, style })
  put(1, 1, '치구 배치도 — 관객석에서 본 칸 배치. 각도는 TILT와 같은 바닥 기준, 90° = 수직 (↖ 왼쪽으로 눕힘, ↑ 수직, ↗ 오른쪽으로 눕힘)', 'title')
  let row = 3
  const heights: Record<number, number> = {}
  for (const p of positions) {
    const field = new Set(p.fieldWiring)
    put(row, 1, `${p.control ? p.control + ' ' : ''}${p.pos}`, 'pos')
    put(
      row,
      2,
      `핀 ${p.cues.length} · 약 ${p.shells}발 · 직렬 ${p.series} · 모듈 ${p.modules.length} · 치구 ${p.jigs.length}${p.fieldWiring.length ? ` · 현장 결선 ${p.fieldWiring.length}핀` : ''}`,
      'note'
    )
    row++
    let col = 1
    const gridRows = Math.max(...p.jigs.map((j) => j.grid.length))
    // 치구마다: 제목 줄, "1칸…5칸" 줄, 그 아래 "1줄…4줄" × 칸
    p.jigs.forEach((jig, j) => {
      const width = Math.max(cols, jig.grid[0]?.length ?? cols)
      put(row, col, `치구 ${j + 1} · 모듈 ${jig.modules.join(', ')}${jig.home.length < jig.modules.length ? ` (미리 결선: ${jig.home.join(', ') || '없음'})` : ''} · ${jig.shells}발`, 'header')
      for (let c = 0; c < width; c++) put(row + 1, col + 1 + c, `${c + 1}칸`, 'note')
      jig.grid.forEach((lane, r) => {
        put(row + 2 + r, col, `${r + 1}줄`, 'note')
        lane.forEach((slot, c) => {
          if (!slot) return
          const cue = p.cues[slot.cue]
          const shot = cue.tilts.length > 1 ? ` (직렬 ${slot.shot}/${cue.tilts.length})` : ''
          put(row + 2 + r, col + 1 + c, `${cue.address}${shot}\n${tiltLabel(slot.tilt)}${cue.estimated ? '?' : ''}\n${cue.effect}`, field.has(slot.cue) ? 'slot-field' : cue.estimated ? 'slot-estimated' : 'slot')
        })
      })
      col += width + 2
    })
    for (let r = 0; r < gridRows; r++) heights[row + 2 + r] = 48
    row += gridRows + 4
  }
  const widths: Record<number, number> = {}
  for (let c = 1; c <= 60; c++) widths[c] = 16
  return { name: '치구 배치도', cells, widths, heights }
}

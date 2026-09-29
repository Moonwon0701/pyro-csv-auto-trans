/**
 * 1→2단계: 주소가 없는 원본 CSV에 FM-A 주소를 매긴다.
 *
 * FM-A 주소 = 모듈(16진 2자리, 00과 xE 제외) + 핀(16진 1자리 0~F). 예: 1F0, 4C8
 * - Control마다 주소 공간이 따로 있다.
 * - Position마다 주소 범위를 정하고, 그 안에서 순서대로 핀을 채운다.
 * - Position 안의 순서: 효과순(Effect Description 알파벳순 → 시간순) 또는 시간순
 * - 이미 주소가 있는 행은 그대로 두고, 그 주소는 다른 행에 쓰지 않는다.
 */
import { detectColumns } from './columns'
import { parsePosition } from './position'
import { findPositionRule } from './rules'
import { CATEGORIES, type Category, type Issue, type ParsedCsv, type RuleSet } from './types'

export const PINS_PER_MODULE = 16
/** FM-A 모듈 번호: 01~FF 중 00과 두 번째 자리가 E인 것 제외 */
export const MODULES: string[] = []
for (let m = 1; m < 256; m++) {
  const h = m.toString(16).toUpperCase().padStart(2, '0')
  if (h[1] !== 'E') MODULES.push(h)
}
const MAX_INDEX = MODULES.length * PINS_PER_MODULE - 1

/** "1F0" → 순번. 형식이 틀리면 null. 엑셀이 앞자리 0을 지운 "28"(=028)도 허용 */
export function addressToIndex(addr: string): number | null {
  const a = addr.trim().toUpperCase().padStart(3, '0')
  if (!/^[0-9A-F]{3}$/.test(a)) return null
  const mi = MODULES.indexOf(a.slice(0, 2))
  if (mi < 0) return null
  return mi * PINS_PER_MODULE + parseInt(a[2], 16)
}

export function indexToAddress(i: number): string {
  return MODULES[Math.floor(i / PINS_PER_MODULE)] + (i % PINS_PER_MODULE).toString(16).toUpperCase()
}

/** 주소 표기 통일: "28" → "028" */
export function normalizeAddress(addr: string): string {
  const i = addressToIndex(addr)
  return i === null ? addr.trim() : indexToAddress(i)
}

export interface AddressRange {
  start: number
  /** 포함. null이면 필요한 만큼 */
  end: number | null
}

/** "210-22F, 110-113" 또는 "210" (시작만) → 범위 목록. 틀린 부분은 errors로 */
export function parseRanges(text: string): { ranges: AddressRange[]; errors: string[] } {
  const ranges: AddressRange[] = []
  const errors: string[] = []
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const [a, b] = part.split(/[-~]/)
    const start = addressToIndex(a ?? '')
    const end = b === undefined || b === '' ? null : addressToIndex(b)
    if (start === null || (b !== undefined && b !== '' && end === null)) errors.push(`주소 형식 오류: ${part}`)
    else if (end !== null && end < start) errors.push(`범위가 거꾸로임: ${part}`)
    else ranges.push({ start, end })
  }
  return { ranges, errors }
}

export function formatRanges(ranges: AddressRange[]): string {
  return ranges.map((r) => (r.end === null ? indexToAddress(r.start) : `${indexToAddress(r.start)}-${indexToAddress(r.end)}`)).join(', ')
}

export type SortMode = 'effect' | 'time'

export interface PositionSlot {
  control: string
  pos: string
  category: Category | null
  rows: number
  /** 이미 주소가 있는 행 수 */
  assigned: number
  /** 새로 필요한 핀 수 */
  needed: number
  existing: string[]
}

export interface AssignPlanEntry {
  control: string
  pos: string
  ranges: string
}

export interface AssignOptions {
  sortMode: SortMode
  plan: AssignPlanEntry[]
}

const keyOf = (control: string, pos: string) => `${control}\u0000${pos}`
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** 원본 CSV에서 Control × POS 목록과 필요한 핀 수를 뽑는다 */
export function listPositions(csv: ParsedCsv, rules: RuleSet): PositionSlot[] {
  const cols = detectColumns(csv.headers)
  const get = (row: string[], k: 'CONTROL' | 'POS' | 'ADDR') => {
    const i = cols.get(k)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }
  const map = new Map<string, PositionSlot>()
  for (const row of csv.rows) {
    const control = get(row, 'CONTROL')
    const pos = get(row, 'POS')
    if (!pos) continue
    let slot = map.get(keyOf(control, pos))
    if (!slot) {
      const parsed = parsePosition(pos)
      const rule = parsed ? findPositionRule(rules.positionRules, parsed.prefix) : undefined
      const category = rule && rule.category !== '제외' ? rule.category : null
      slot = { control, pos, category, rows: 0, assigned: 0, needed: 0, existing: [] }
      map.set(keyOf(control, pos), slot)
    }
    slot.rows++
    const addr = get(row, 'ADDR')
    if (addr) {
      slot.assigned++
      slot.existing.push(normalizeAddress(addr))
    } else slot.needed++
  }
  const catOrder = (c: Category | null) => (c ? CATEGORIES.indexOf(c) : CATEGORIES.length)
  return [...map.values()].sort(
    (a, b) => naturalCompare(a.control, b.control) || catOrder(a.category) - catOrder(b.category) || naturalCompare(a.pos, b.pos)
  )
}

/**
 * 자동 배정 제안: Control마다 startModule부터, Position마다 새 모듈에서 시작해 필요한 핀만큼 연속 배정.
 * 이미 쓰인 주소는 건너뛴다.
 */
export function proposePlan(slots: PositionSlot[], startModule = '01'): AssignPlanEntry[] {
  const plan: AssignPlanEntry[] = []
  const byControl = new Map<string, PositionSlot[]>()
  for (const s of slots) {
    if (!byControl.has(s.control)) byControl.set(s.control, [])
    byControl.get(s.control)!.push(s)
  }
  const start = addressToIndex(`${startModule}0`) ?? 0
  for (const [control, list] of byControl) {
    const used = new Set(list.flatMap((s) => s.existing.map(addressToIndex).filter((x): x is number => x !== null)))
    let cursor = start
    for (const s of list) {
      if (s.needed === 0) {
        plan.push({ control, pos: s.pos, ranges: '' })
        continue
      }
      // 새 모듈에서 시작
      cursor = Math.ceil(cursor / PINS_PER_MODULE) * PINS_PER_MODULE
      const first = nextFree(cursor, used)
      let last = first
      let count = 0
      for (let i = first; count < s.needed && i <= MAX_INDEX; i++) {
        if (used.has(i)) continue
        used.add(i)
        last = i
        count++
      }
      plan.push({ control, pos: s.pos, ranges: `${indexToAddress(first)}-${indexToAddress(last)}` })
      cursor = last + 1
    }
  }
  return plan
}

function nextFree(i: number, used: Set<number>) {
  while (used.has(i)) i++
  return i
}

export interface AssignResult {
  csv: ParsedCsv
  issues: Issue[]
  blocked: boolean
  /** Position별 실제로 쓴 주소 요약 */
  summary: { control: string; pos: string; rows: number; newAddresses: number; range: string; error?: string }[]
}

/** 계획대로 주소를 채운 새 CSV를 만든다. 원본은 바꾸지 않는다 */
export function assignAddresses(csv: ParsedCsv, opts: AssignOptions): AssignResult {
  const headers = [...csv.headers]
  let cols = detectColumns(headers)
  let rows = csv.rows.map((r) => [...r])
  if (!cols.has('ADDR')) {
    headers.push('ADDR')
    rows = rows.map((r) => [...r, ''])
    cols = detectColumns(headers)
  }
  const idx = (k: 'CONTROL' | 'POS' | 'ADDR' | 'HH' | 'MM' | 'SS' | 'FF' | 'EFFECT') => cols.get(k)
  const val = (r: string[], k: Parameters<typeof idx>[0]) => {
    const i = idx(k)
    return i === undefined ? '' : (r[i] ?? '').trim()
  }
  const addrCol = idx('ADDR')!
  const issues: Issue[] = []
  const summary: AssignResult['summary'] = []

  // Control별 사용 중인 주소 (기존 주소 + 계획 범위 겹침 검사)
  const usedByControl = new Map<string, Map<number, string>>()
  const usedOf = (c: string) => {
    if (!usedByControl.has(c)) usedByControl.set(c, new Map())
    return usedByControl.get(c)!
  }
  rows.forEach((r) => {
    const a = val(r, 'ADDR')
    if (!a) return
    const i = addressToIndex(a)
    if (i === null) {
      issues.push({ code: 'BAD_EXISTING_ADDR', severity: 'warning', message: `FM-A 형식이 아닌 기존 주소: ${a} (그대로 둠)` })
      return
    }
    usedOf(val(r, 'CONTROL')).set(i, val(r, 'POS'))
  })

  const time = (r: string[]) => (['HH', 'MM', 'SS', 'FF'] as const).map((k) => Number(val(r, k)) || 0).reduce((a, b) => a * 100 + b, 0)
  const effect = (r: string[]) => val(r, 'EFFECT').toLowerCase()

  for (const entry of opts.plan) {
    const target = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => val(r, 'CONTROL') === entry.control && val(r, 'POS') === entry.pos && !val(r, 'ADDR'))
    if (target.length === 0) continue
    const label = `${entry.control ? entry.control + ' ' : ''}${entry.pos}`
    const { ranges, errors } = parseRanges(entry.ranges)
    if (errors.length || ranges.length === 0) {
      const error = errors.join(', ') || '주소 범위가 비어 있습니다'
      issues.push({ code: 'BAD_RANGE', severity: 'blocking', message: `${label}: ${error}` })
      summary.push({ control: entry.control, pos: entry.pos, rows: target.length, newAddresses: 0, range: entry.ranges, error })
      continue
    }
    target.sort((a, b) =>
      opts.sortMode === 'effect'
        ? (effect(a.r) < effect(b.r) ? -1 : effect(a.r) > effect(b.r) ? 1 : 0) || time(a.r) - time(b.r) || a.i - b.i
        : time(a.r) - time(b.r) || a.i - b.i
    )
    const used = usedOf(entry.control)
    const got: number[] = []
    const collisions = new Set<string>()
    outer: for (const range of ranges) {
      const end = range.end ?? MAX_INDEX
      for (let i = range.start; i <= end && got.length < target.length; i++) {
        const owner = used.get(i)
        if (owner !== undefined) {
          if (owner !== entry.pos) collisions.add(`${indexToAddress(i)}(${owner})`)
          continue
        }
        got.push(i)
        if (got.length === target.length) break outer
      }
    }
    if (collisions.size) {
      issues.push({
        code: 'RANGE_OVERLAP',
        severity: 'warning',
        message: `${label}: 범위 안에 다른 위치가 쓰는 주소가 있어 건너뛰었습니다`,
        details: [...collisions].slice(0, 20)
      })
    }
    if (got.length < target.length) {
      const error = `주소가 ${target.length - got.length}개 부족합니다 (필요 ${target.length}, 가능 ${got.length})`
      issues.push({ code: 'RANGE_TOO_SMALL', severity: 'blocking', message: `${label}: ${error}` })
      summary.push({ control: entry.control, pos: entry.pos, rows: target.length, newAddresses: got.length, range: entry.ranges, error })
      continue
    }
    target.forEach(({ i }, n) => {
      rows[i][addrCol] = indexToAddress(got[n])
      used.set(got[n], entry.pos)
    })
    summary.push({
      control: entry.control,
      pos: entry.pos,
      rows: target.length,
      newAddresses: got.length,
      range: `${indexToAddress(Math.min(...got))} ~ ${indexToAddress(Math.max(...got))}`
    })
  }

  const missing = rows.filter((r) => val(r, 'POS') && !val(r, 'ADDR')).length
  if (missing) {
    issues.push({ code: 'STILL_MISSING', severity: 'warning', message: `주소가 매겨지지 않은 행이 ${missing}개 남았습니다` })
  }
  return {
    csv: { ...csv, headers, rows },
    issues,
    blocked: issues.some((i) => i.severity === 'blocking'),
    summary
  }
}

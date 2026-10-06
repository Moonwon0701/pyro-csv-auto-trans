/**
 * 라벨 인쇄용 엑셀 (폼텍 DesignPro가 [타상$]·[연발$]·[단발$] 시트를 읽는다).
 * 울주 라벨작업(2026-07)을 CSV와 대조해 정한 규칙:
 * - 시트: 원본 전체 → 타상 → 연발 → 단발. 열은 CSV 그대로 (라벨이 Effect Description·POS·ADDR·CUSTOM1~3·QTY를 쓴다)
 * - 타상: 한 행 = 라벨 한 장. QTY 2면 Effect 뒤에 " 2직", chain이면 " 3초 체인"(DUR ÷ 간격 수)
 * - 연발·단발: 직렬(QTY>1)은 발마다 한 행으로 펼친다. 각도는 TILT 그대로 왼쪽(음수)=CUSTOM1, 수직(90)=CUSTOM2, 오른쪽(양수)=CUSTOM3
 *   연발은 한 발짜리 수직 케이크에는 각도를 적지 않고, Event가 R이면 CUSTOM2에 (START_R)
 * - ADDR은 3자리 (엑셀에서 잘린 "30" → "030")
 */
import { normalizeHeader } from './columns'
import { parseTilts, VERTICAL } from './jig'
import { repairAddress } from './restore'
import { resolveCategory } from './rules'
import { sanitizeSheetName } from './transform'
import { CATEGORIES, EXCLUDE, type Category, type Issue, type ParsedCsv, type Resolution, type RuleSet, type SheetModel } from './types'

export const LABEL_ANGLE_COLUMNS = ['CUSTOM1', 'CUSTOM2', 'CUSTOM3'] as const
export const START_R_TEXT = '(START_R)'

export interface LabelCount {
  category: Category
  /** CSV 행 수 */
  sourceRows: number
  /** 라벨 장수 (직렬을 펼친 뒤) */
  labels: number
}

export interface LabelResult {
  /** 원본 + 타상·연발·단발 (plain 시트) */
  sheets: SheetModel[]
  counts: LabelCount[]
  issues: Issue[]
}

interface LabelRow {
  cells: string[]
  effect: string
  addr: string
  /** 정렬용 각도: [왼쪽 0 / 오른쪽 1 / 수직·없음 2, 값] */
  angle: [number, number]
  order: number
}

const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' })

/** 체인 간격(초): DUR(1/100초)을 간격 수로 나눈다. 1200, 5발 → 3 */
function chainSeconds(dur: string, qty: number): string | null {
  const d = Number(dur)
  if (!(d > 0) || qty < 2) return null
  const s = Math.round((d / 100 / (qty - 1)) * 10) / 10
  return String(s)
}

export function buildLabelSheets(csv: ParsedCsv, rules: RuleSet, resolutions: Record<string, Resolution> = {}): LabelResult {
  const find = (name: string) => csv.headers.findIndex((h) => normalizeHeader(h) === name)
  const headers = [...csv.headers]
  const angleCols = LABEL_ANGLE_COLUMNS.map((c) => {
    const i = find(c)
    if (i >= 0) return i
    headers.push(c)
    return headers.length - 1
  })
  const [c1, c2, c3] = angleCols
  const col = {
    pos: find('POS'),
    type: find('TYPE'),
    qty: find('QTY'),
    tilt: find('TILT'),
    addr: find('ADDR'),
    effect: find('EFFECTDESCRIPTION'),
    event: find('EVENTDESCRIPTION'),
    dur: find('DUR')
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  const byCategory = new Map<Category, LabelRow[]>(CATEGORIES.map((c) => [c, []]))
  const sourceRows = new Map<Category, number>(CATEGORIES.map((c) => [c, 0]))
  const unclassified: number[] = []
  const estimated: string[] = []
  const overwritten: number[] = []

  csv.rows.forEach((row, i) => {
    const line = csv.lineNumbers[i] ?? i + 2
    const category = resolveCategory(rules, resolutions, get(row, col.pos), get(row, col.type))
    if (category === EXCLUDE) return
    if (!category) {
      unclassified.push(line)
      return
    }
    sourceRows.set(category, sourceRows.get(category)! + 1)
    const base = headers.map((_, j) => row[j] ?? '')
    if (col.addr >= 0) base[col.addr] = repairAddress(base[col.addr])
    const qty = Math.max(1, Number(get(row, col.qty)) || 1)
    const effect = get(row, col.effect)
    const addr = col.addr >= 0 ? base[col.addr] : ''
    const list = byCategory.get(category)!

    if (category === '타상') {
      if (qty > 1 && col.effect >= 0) {
        const chain = /chain/i.test(get(row, col.event)) ? chainSeconds(get(row, col.dur), qty) : null
        base[col.effect] = `${base[col.effect]} ${chain ? `${chain}초 체인` : `${qty}직`}`
      }
      list.push({ cells: base, effect, addr, angle: [2, 0], order: list.length })
      return
    }

    if (angleCols.some((j) => (row[j] ?? '').trim())) overwritten.push(line)
    const t = parseTilts(get(row, col.tilt), qty)
    if (qty > 1 && t.estimated) estimated.push(`${line}행 ${get(row, col.pos)}: QTY=${qty}, TILT=${get(row, col.tilt)}`)
    const startR = category === '연발' && get(row, col.event).toUpperCase() === 'R'
    for (const tilt of t.tilts) {
      const cells = [...base]
      for (const j of angleCols) cells[j] = ''
      let angle: [number, number] = [2, 0]
      const skipVertical = category === '연발' && qty === 1
      if (Math.abs(tilt) === VERTICAL) {
        if (!skipVertical) cells[c2] = String(VERTICAL)
      } else if (tilt < 0) {
        cells[c1] = String(tilt)
        angle = [0, tilt]
      } else {
        cells[c3] = String(tilt)
        angle = [1, tilt]
      }
      if (startR && !cells[c2]) cells[c2] = START_R_TEXT
      list.push({ cells, effect, addr, angle, order: list.length })
    }
  })

  const byAngle = (a: LabelRow, b: LabelRow) => a.angle[0] - b.angle[0] || a.angle[1] - b.angle[1]
  const sorters: Record<Category, (a: LabelRow, b: LabelRow) => number> = {
    // 같은 제품끼리, 주소순
    타상: (a, b) => compareText(a.effect, b.effect) || compareText(a.addr, b.addr) || a.order - b.order,
    // 같은 제품·주소의 직렬 발은 붙여 둔다
    연발: (a, b) => compareText(a.effect, b.effect) || compareText(a.addr, b.addr) || byAngle(a, b) || a.order - b.order,
    // 같은 제품 안에서 각도별로 (치구에 꽂는 순서)
    단발: (a, b) => compareText(a.effect, b.effect) || byAngle(a, b) || compareText(a.addr, b.addr) || a.order - b.order
  }

  const used = new Set<string>(CATEGORIES.map((c) => c.toLowerCase()))
  const plain = (name: string, category: SheetModel['category'], rows: string[][], sourceRowCount: number): SheetModel => ({
    name,
    control: '',
    category,
    plain: true,
    title: '',
    summary: '',
    columns: headers,
    rows: rows.map((r) => r.map((value) => ({ value }))),
    sourceRowCount
  })
  const sheets: SheetModel[] = [
    plain(
      sanitizeSheetName(csv.fileName.replace(/\.[^.]+$/, '') || '원본', used),
      '원본',
      csv.rows.map((r) => headers.map((_, j) => r[j] ?? '')),
      csv.rows.length
    ),
    ...CATEGORIES.map((c) => plain(c, c, byCategory.get(c)!.sort(sorters[c]).map((r) => r.cells), sourceRows.get(c)!))
  ]

  const issues: Issue[] = []
  if (estimated.length) {
    issues.push({
      code: 'LABEL_TILT_DAMAGED',
      severity: 'warning',
      message: '직렬 TILT가 엑셀에서 계산된 값이라 발별 각도를 알 수 없습니다. 평균값으로 적었습니다. 파일 도구 → 엑셀 손상 복원으로 원본과 대조한 뒤 다시 만드세요.',
      count: estimated.length,
      details: estimated.slice(0, 10)
    })
  }
  if (unclassified.length) {
    issues.push({
      code: 'LABEL_UNCLASSIFIED',
      severity: 'warning',
      message: '타상·연발·단발로 분류하지 못한 행은 라벨에서 뺐습니다. Rule 관리에서 접두어를 등록하세요.',
      count: unclassified.length,
      lines: unclassified.slice(0, 20)
    })
  }
  if (overwritten.length) {
    issues.push({
      code: 'LABEL_CUSTOM_OVERWRITTEN',
      severity: 'info',
      message: 'CUSTOM1~3에 있던 값을 라벨 각도로 덮어썼습니다.',
      count: overwritten.length,
      lines: overwritten.slice(0, 20)
    })
  }
  return {
    sheets,
    counts: CATEGORIES.map((c) => ({ category: c, sourceRows: sourceRows.get(c)!, labels: byCategory.get(c)!.length })),
    issues
  }
}

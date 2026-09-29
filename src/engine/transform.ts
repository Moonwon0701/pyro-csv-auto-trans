import { OUTPUT_KEYS, PASSTHROUGH_AFTER_EFFECT, PASSTHROUGH_BEFORE_EFFECT, detectColumns } from './columns'
import { formatPosition, parsePosition } from './position'
import { findPositionRule, findTypeRule } from './rules'
import {
  CATEGORIES,
  CATEGORY_PREFIX,
  EXCLUDE,
  type Analysis,
  type Category,
  type ColumnKey,
  type Issue,
  type ParsedCsv,
  type PrefixMapping,
  type Resolution,
  type RuleSet,
  type SheetCell,
  type SheetModel,
  type TransformOptions,
  type TransformResult
} from './types'

const MAX_LINES = 50
const TIME_KEYS: ColumnKey[] = ['HH', 'MM', 'SS', 'FF']
const MAX_DETAILS = 100
const NO_CONTROL = 'NO-CONTROL'
export const MISSING_ADDRESS_TEXT = '주소없음'
export const UNPLACED_COLUMN = '미배치 POS'

interface PositionSlot {
  values: string[]
  missing: boolean
}

interface Group {
  key: Partial<Record<ColumnKey, string>>
  extras: Map<ColumnKey, string[]>
  positions: Map<number, PositionSlot>
  unplaced: string[]
  sourceRows: number
}

interface SheetBucket {
  control: string
  category: Category
  groups: Map<string, Group>
  outputPrefix: string
  rowCount: number
}

class IssueCollector {
  private map = new Map<string, Issue>()

  add(code: string, severity: Issue['severity'], message: string, opts: { line?: number; detail?: string } = {}) {
    let issue = this.map.get(code)
    if (!issue) {
      issue = { code, severity, message, count: 0 }
      this.map.set(code, issue)
    }
    issue.count = (issue.count ?? 0) + 1
    if (opts.line !== undefined) {
      issue.lines ??= []
      if (issue.lines.length < MAX_LINES) issue.lines.push(opts.line)
    }
    if (opts.detail !== undefined) {
      issue.details ??= []
      if (issue.details.length < MAX_DETAILS) issue.details.push(opts.detail)
    }
  }

  list(): Issue[] {
    const order = { blocking: 0, warning: 1, info: 2 }
    return [...this.map.values()].sort((a, b) => order[a.severity] - order[b.severity])
  }
}

function pushUnique(arr: string[], v: string) {
  if (v !== '' && !arr.includes(v)) arr.push(v)
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Sheet'
  base = base.slice(0, 31)
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export function transform(
  csv: ParsedCsv,
  rules: RuleSet,
  resolutions: Record<string, Resolution>,
  opts: TransformOptions
): TransformResult {
  const cols = detectColumns(csv.headers)
  const issues = new IssueCollector()
  const get = (row: string[], key: ColumnKey) => {
    const idx = cols.get(key)
    return idx === undefined ? '' : (row[idx] ?? '').trim()
  }
  const headerOf = (key: ColumnKey) => csv.headers[cols.get(key)!]
  /** HH/MM/SS/FF는 숫자면 2자리로 맞춘다 (0 → 00) */
  const getKey = (row: string[], key: ColumnKey) => {
    const v = get(row, key)
    return TIME_KEYS.includes(key) && /^\d$/.test(v) ? `0${v}` : v
  }

  // ---- 컬럼 수준 검사 ----
  if (csv.headers.length === 0) {
    issues.add('NO_HEADER', 'blocking', 'CSV에서 헤더 행을 찾지 못했습니다.')
  } else if (!cols.has('POS')) {
    issues.add('NO_POS_COLUMN', 'blocking', 'POS 컬럼이 없어 위치를 계산할 수 없습니다.')
  }
  for (const k of ['HH', 'MM', 'SS', 'FF'] as ColumnKey[]) {
    if (csv.headers.length && !cols.has(k)) issues.add('NO_TIME_COLUMN', 'warning', `시간 컬럼이 없습니다: ${k}`, { detail: k })
  }
  if (csv.headers.length && !cols.has('EFFECT')) {
    issues.add('NO_EFFECT_COLUMN', 'warning', 'Effect Description 컬럼이 없습니다. 병합 기준에서 빠집니다.')
  }
  if (csv.headers.length && !cols.has('CONTROL')) {
    issues.add('NO_CONTROL_COLUMN', 'warning', 'CONTROL 컬럼이 없어 단일 Control로 처리합니다.')
  }
  const hasAddr = cols.has('ADDR')
  const hasModulePin = cols.has('MODULE') && cols.has('PIN')
  if (csv.headers.length && !hasAddr && !hasModulePin) {
    issues.add('NO_ADDRESS_COLUMN', 'warning', 'ADDR 컬럼도, MODULE/PIN 컬럼도 없습니다. 위치 셀에 주소를 넣을 수 없습니다.')
  }

  // ---- 행 단위 처리 ----
  const buckets = new Map<string, SheetBucket>()
  const controlCounts = new Map<string, number>()
  const prefixInfo = new Map<string, { rowCount: number; examples: string[]; typeVotes: Map<Category, number> }>()
  const unclassified: { row: string[]; line: number }[] = []
  const addrSummary = { addr: 0, modulePin: 0, none: 0 }

  csv.rows.forEach((row, i) => {
    const line = csv.lineNumbers[i]
    const control = get(row, 'CONTROL')
    if (cols.has('CONTROL') && !control) issues.add('EMPTY_CONTROL', 'warning', 'CONTROL 값이 비어 있는 행이 있습니다.', { line })
    controlCounts.set(control, (controlCounts.get(control) ?? 0) + 1)

    const posRaw = get(row, 'POS')
    const typeRaw = get(row, 'TYPE')
    const typeRule = findTypeRule(rules.typeRules, typeRaw)
    const parsed = parsePosition(posRaw)

    // ① Position Rule → ② TYPE Rule → ③ 미분류
    let category: Resolution | null = null
    let outputPrefix: string | null = null
    let positionNumber: number | null = null
    if (parsed) {
      let info = prefixInfo.get(parsed.prefix)
      if (!info) prefixInfo.set(parsed.prefix, (info = { rowCount: 0, examples: [], typeVotes: new Map() }))
      info.rowCount++
      if (info.examples.length < 3) pushUnique(info.examples, posRaw)
      if (typeRule) info.typeVotes.set(typeRule.category, (info.typeVotes.get(typeRule.category) ?? 0) + 1)

      const rule = findPositionRule(rules.positionRules, parsed.prefix)
      const resolved = rule ? rule.category : resolutions[parsed.prefix]
      if (!resolved) return // 미등록 prefix: 사용자 결정 전까지 보류 (Blocking)
      category = resolved
      if (resolved !== EXCLUDE) {
        outputPrefix = (rule?.output_prefix || CATEGORY_PREFIX[resolved]).toUpperCase()
        positionNumber = parsed.number
        if (typeRule && typeRule.category !== resolved) {
          issues.add('TYPE_MISMATCH', 'info', 'POS Rule과 TYPE의 분류가 다른 행이 있습니다. POS Rule을 우선 적용했습니다.', {
            line,
            detail: `${line}행: ${posRaw} → ${resolved} (TYPE=${typeRaw})`
          })
        }
      }
    } else {
      if (posRaw) {
        issues.add('UNPARSED_POS', 'warning', 'POS 형식을 인식하지 못한 행이 있습니다. "미배치 POS" 열에 보존합니다.', {
          line,
          detail: `${line}행: "${posRaw}"`
        })
      } else {
        issues.add('EMPTY_POS', 'warning', 'POS 값이 비어 있는 행이 있습니다.', { line })
      }
      if (typeRule) category = typeRule.category
    }

    if (category === EXCLUDE) return
    if (!category) {
      issues.add('UNCLASSIFIED', 'warning', '분류할 수 없는 행이 있어 "미분류" 시트에 원본 그대로 보존합니다.', { line })
      unclassified.push({ row, line })
      return
    }

    // 주소
    const addr = get(row, 'ADDR')
    const mod = get(row, 'MODULE')
    const pin = get(row, 'PIN')
    let address = ''
    if (opts.addressSource !== 'module_pin' && addr) {
      address = addr
      addrSummary.addr++
    } else if (opts.addressSource !== 'addr' && mod && pin) {
      address = `${mod}-${pin}`
      addrSummary.modulePin++
    } else {
      addrSummary.none++
      issues.add('NO_ADDRESS', 'warning', `주소 값이 없는 행이 있습니다. 위치 셀에 "${MISSING_ADDRESS_TEXT}"로 표시합니다.`, { line })
    }

    if (['HH', 'MM', 'SS', 'FF'].some((k) => cols.has(k as ColumnKey) && get(row, k as ColumnKey) === '')) {
      issues.add('MISSING_TIME', 'warning', 'HH/MM/SS/FF 값이 비어 있는 행이 있습니다.', { line })
    }
    if (cols.has('EFFECT') && get(row, 'EFFECT') === '') {
      issues.add('MISSING_EFFECT', 'warning', 'Effect Description이 비어 있는 행이 있습니다. 병합 기준에 영향을 줍니다.', { line })
    }

    // 그룹 병합
    const bucketKey = `${control}\u0000${category}`
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      bucket = { control, category, groups: new Map(), outputPrefix: CATEGORY_PREFIX[category], rowCount: 0 }
      buckets.set(bucketKey, bucket)
    }
    bucket.rowCount++
    const groupKey = opts.groupKeys.map((k) => getKey(row, k)).join('\u0001')
    let group = bucket.groups.get(groupKey)
    if (!group) {
      const key: Group['key'] = {}
      for (const k of [...TIME_KEYS, 'EFFECT'] as ColumnKey[]) key[k] = getKey(row, k)
      group = { key, extras: new Map(), positions: new Map(), unplaced: [], sourceRows: 0 }
      bucket.groups.set(groupKey, group)
    }
    group.sourceRows++
    for (const k of [...PASSTHROUGH_BEFORE_EFFECT, ...PASSTHROUGH_AFTER_EFFECT]) {
      if (!cols.has(k)) continue
      if (!group.extras.has(k)) group.extras.set(k, [])
      pushUnique(group.extras.get(k)!, get(row, k))
    }
    if (positionNumber !== null && outputPrefix) {
      bucket.outputPrefix = outputPrefix
      let slot = group.positions.get(positionNumber)
      if (!slot) group.positions.set(positionNumber, (slot = { values: [], missing: false }))
      if (address) pushUnique(slot.values, address)
      else slot.missing = true
    } else {
      group.unplaced.push(address ? `${posRaw || '(POS 없음)'}=${address}` : posRaw || '(POS 없음)')
    }
  })

  if (csv.rows.length > 0 && addrSummary.addr === 0 && addrSummary.modulePin === 0 && addrSummary.none > 0) {
    issues.add(
      'NO_ADDRESS_ANY',
      'warning',
      '이 CSV에는 주소(ADDR 또는 MODULE-PIN)가 하나도 없습니다. 주소를 매기기 전 원본 파일인지 확인하세요.'
    )
  }

  // ---- 미등록 prefix / 매핑 표 ----
  const prefixMappings: PrefixMapping[] = []
  for (const [prefix, info] of [...prefixInfo.entries()].sort((a, b) => naturalCompare(a[0], b[0]))) {
    const rule = findPositionRule(rules.positionRules, prefix)
    let suggestion: Category | undefined
    let best = 0
    for (const [cat, n] of info.typeVotes) if (n > best) ((best = n), (suggestion = cat))
    if (rule) {
      prefixMappings.push({
        prefix,
        status: 'rule',
        category: rule.category,
        outputPrefix: rule.category === EXCLUDE ? null : rule.output_prefix || CATEGORY_PREFIX[rule.category],
        rowCount: info.rowCount,
        ruleSource: rule.source,
        examples: info.examples
      })
    } else {
      const res = resolutions[prefix]
      prefixMappings.push({
        prefix,
        status: res ? 'resolved' : 'unknown',
        category: res ?? null,
        outputPrefix: res && res !== EXCLUDE ? CATEGORY_PREFIX[res] : null,
        rowCount: info.rowCount,
        suggestion,
        examples: info.examples
      })
      if (!res) {
        issues.add('UNKNOWN_PREFIX', 'blocking', '미등록 POS Prefix가 있습니다. 카테고리를 선택해야 Excel을 만들 수 있습니다.', {
          detail: `${prefix}-* (${info.rowCount}행)`
        })
      }
    }
  }

  // ---- 시트 생성 ----
  const controls = [...controlCounts.keys()].sort(naturalCompare)
  const single = controls.length <= 1
  const usedNames = new Set<string>()
  const sheets: SheetModel[] = []
  const maxPosition = new Map<Category, number>()
  for (const b of buckets.values()) {
    for (const g of b.groups.values()) {
      for (const n of g.positions.keys()) maxPosition.set(b.category, Math.max(maxPosition.get(b.category) ?? 0, n))
    }
  }
  const baseFileName = csv.fileName.replace(/\.[^.]+$/, '')
  const groupKeyLabel = opts.groupKeys.map((k) => (cols.has(k) ? headerOf(k) : k)).join(' + ')
  const addressLabel = addrSummary.addr >= addrSummary.modulePin ? (addrSummary.addr ? 'ADDR' : '없음') : 'MODULE-PIN'
  const categoryStats: Analysis['categoryStats'] = []

  for (const control of controls) {
    for (const category of CATEGORIES) {
      const bucket = buckets.get(`${control}\u0000${category}`)
      categoryStats.push({ control, category, rows: bucket?.rowCount ?? 0, groups: bucket?.groups.size ?? 0 })
      if (!bucket && !opts.createEmptySheets) continue
      const baseName =
        single && opts.singleControlSheetNaming === 'simple' ? category : `${control || NO_CONTROL} ${category}`
      sheets.push(buildSheet(sanitizeSheetName(baseName, usedNames), control, category, bucket))
    }
  }
  if (unclassified.length) {
    sheets.push({
      name: sanitizeSheetName('미분류', usedNames),
      control: '',
      category: '미분류',
      title: `${baseFileName} - 미분류`,
      summary: `분류할 수 없는 원본 ${unclassified.length}행 (POS Rule·TYPE Rule 모두 해당 없음)`,
      columns: ['원본 줄', ...csv.headers],
      rows: unclassified.map(({ row, line }) => [{ value: String(line) }, ...row.map((v) => ({ value: v }))]),
      sourceRowCount: unclassified.length
    })
  }

  function buildSheet(name: string, control: string, category: Category, bucket?: SheetBucket): SheetModel {
    const groups = bucket ? [...bucket.groups.values()] : []
    const prefix = bucket?.outputPrefix ?? CATEGORY_PREFIX[category]
    const numbers = Array.from({ length: maxPosition.get(category) ?? 0 }, (_, i) => i + 1)
    const hasUnplaced = groups.some((g) => g.unplaced.length > 0)

    const lead: ColumnKey[] = (['HH', 'MM', 'SS', 'FF'] as ColumnKey[]).filter((k) => cols.has(k))
    const before = PASSTHROUGH_BEFORE_EFFECT.filter((k) => cols.has(k))
    const effect: ColumnKey[] = cols.has('EFFECT') ? ['EFFECT'] : []
    const after = PASSTHROUGH_AFTER_EFFECT.filter((k) => cols.has(k))
    const columns = [
      'CUE',
      ...[...lead, ...before, ...effect, ...after].map(headerOf),
      ...numbers.map((n) => formatPosition(prefix, n)),
      ...(hasUnplaced ? [UNPLACED_COLUMN] : [])
    ]

    const rows: SheetCell[][] = groups.map((g, idx) => {
      const cells: SheetCell[] = [{ value: String(idx + 1) }]
      for (const k of lead) cells.push({ value: g.key[k] ?? '' })
      for (const k of before) cells.push({ value: (g.extras.get(k) ?? []).join(', ') })
      for (const k of effect) cells.push({ value: g.key[k] ?? '' })
      for (const k of after) cells.push({ value: (g.extras.get(k) ?? []).join(', ') })
      for (const n of numbers) {
        const slot = g.positions.get(n)
        if (!slot) cells.push({ value: '' })
        else if (slot.values.length === 0) cells.push({ value: MISSING_ADDRESS_TEXT, flag: 'missing' })
        else {
          const conflict = slot.values.length > 1
          if (conflict) {
            issues.add('MULTI_ADDRESS', 'warning', '같은 Cue·같은 Position에 주소가 여러 개 있습니다. 모두 보존했습니다.', {
              detail: `${name} / ${[g.key.HH, g.key.MM, g.key.SS, g.key.FF].join(':')} ${g.key.EFFECT ?? ''} / ${formatPosition(prefix, n)} = ${slot.values.join(', ')}`
            })
          }
          cells.push({ value: slot.values.join(', '), flag: conflict ? 'conflict' : undefined })
        }
      }
      if (hasUnplaced) cells.push({ value: g.unplaced.join(', ') })
      return cells
    })

    const sourceRowCount = bucket?.rowCount ?? 0
    return {
      name,
      control,
      category,
      title: `${baseFileName} - ${name}`,
      summary: `원본 ${sourceRowCount}행 → ${rows.length}개 그룹 | 병합 기준: ${groupKeyLabel} | 위치값: ${addressLabel} | POS 표준화: ${category} 동일 끝번호끼리 통합`,
      columns,
      rows,
      sourceRowCount
    }
  }

  const detectedColumns = [...cols.entries()].map(([key, idx]) => ({ key, header: csv.headers[idx] }))
  const used = new Set(OUTPUT_KEYS.filter((k) => cols.has(k)).map((k) => cols.get(k)!))
  const ignoredColumns = csv.headers.filter((h, i) => h && !used.has(i))

  const dominant: Analysis['addressSummary']['dominant'] =
    addrSummary.addr === 0 && addrSummary.modulePin === 0
      ? '없음'
      : addrSummary.addr >= addrSummary.modulePin
        ? 'ADDR'
        : 'MODULE-PIN'

  const issueList = issues.list()
  return {
    analysis: {
      fileName: csv.fileName,
      encoding: csv.encoding,
      totalRows: csv.rows.length,
      detectedColumns,
      ignoredColumns,
      controls: controls.map((name) => ({ name: name || NO_CONTROL, rowCount: controlCounts.get(name)! })),
      addressSummary: { dominant, ...addrSummary },
      prefixMappings,
      categoryStats: categoryStats.map((s) => ({ ...s, control: s.control || NO_CONTROL })),
      issues: issueList,
      blocked: issueList.some((i) => i.severity === 'blocking')
    },
    sheets
  }
}

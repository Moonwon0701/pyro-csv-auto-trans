export const CATEGORIES = ['타상', '연발', '단발'] as const
export type Category = (typeof CATEGORIES)[number]
export const EXCLUDE = '제외'
export type Resolution = Category | typeof EXCLUDE

export const CATEGORY_PREFIX: Record<Category, string> = { 타상: 'P', 연발: 'C', 단발: 'S' }

/**
 * 결과 시트의 위치 열 접두어. 타상(3P~6P)만 같은 끝번호끼리 P-01로 합치고,
 * 연발·단발은 원래 접두어를 그대로 쓴다 (C/CF, S/GI/GO는 현장에서 서로 다른 위치)
 */
export function outputPrefixOf(prefix: string, category: Resolution): string {
  if (category === EXCLUDE) return ''
  return category === '타상' ? CATEGORY_PREFIX.타상 : prefix.trim().toUpperCase()
}

/** 엔진이 인식하는 표준 컬럼 키 */
export type ColumnKey =
  | 'CONTROL' | 'CUE' | 'HH' | 'MM' | 'SS' | 'FF' | 'TYPE' | 'POS'
  | 'ADDR' | 'MODULE' | 'PIN'
  | 'QTY' | 'REF' | 'MFG' | 'PRICE1' | 'PFT' | 'PAN' | 'TILT'
  | 'EVENT' | 'EFFECT'

export interface PositionRule {
  /** 예: "3P-*" */
  pattern: string
  category: Resolution
  output_prefix: string
  active: boolean
  source: 'default' | 'shared' | 'user'
  created_at?: string
  /** 치구(단발 거치대)에 꽂는 위치. ① 치구 배치에서 각도순으로 나누고 그 순서대로 주소를 매긴다 */
  jig?: boolean
}

export interface TypeRule {
  type: string
  category: Category
}

export type AddressSource = 'auto' | 'addr' | 'module_pin'

export interface Profile {
  profile_name: string
  address_source: AddressSource
  group_keys: ColumnKey[]
  create_empty_sheets: boolean
  single_control_sheet_naming: 'simple' | 'full'
  row_order?: 'time' | 'effect'
  include_source_sheet?: boolean
}

export interface RuleSet {
  version: number
  updated_at?: string
  positionRules: PositionRule[]
  typeRules: TypeRule[]
  profiles: Profile[]
}

export interface TransformOptions {
  addressSource: AddressSource
  groupKeys: ColumnKey[]
  createEmptySheets: boolean
  singleControlSheetNaming: 'simple' | 'full'
  /** 결과 행 순서: 제품명순(같은 효과끼리 → 시간순, 기본) 또는 시간순(원본 등장 순서) */
  rowOrder: 'time' | 'effect'
  /** 맨 앞에 원본(주소 매긴) 데이터 전체를 시트로 넣는다 */
  includeSourceSheet: boolean
  /** Excel 맨 앞에 LAYOUT 시트 */
  includeLayout: boolean
  /** 단발 주소가 치구 순서로 매겨진 파일이면 치구 배치도 시트 */
  includeJigSheet: boolean
}

export const DEFAULT_OPTIONS: TransformOptions = {
  addressSource: 'auto',
  groupKeys: ['HH', 'MM', 'SS', 'FF', 'EFFECT'],
  createEmptySheets: true,
  singleControlSheetNaming: 'simple',
  rowOrder: 'effect',
  includeSourceSheet: false,
  includeLayout: true,
  includeJigSheet: true
}

export interface ParsedCsv {
  fileName: string
  encoding: string
  /** 원본 헤더 텍스트 (헤더 행 기준) */
  headers: string[]
  /** 데이터 행. 각 행은 headers와 같은 길이의 문자열 배열 */
  rows: string[][]
  /** rows[i]의 원본 파일 줄 번호(1부터) */
  lineNumbers: number[]
}

export type Severity = 'blocking' | 'warning' | 'info'

export interface Issue {
  code: string
  severity: Severity
  message: string
  /** 원본 CSV 줄 번호 (최대 일부만) */
  lines?: number[]
  count?: number
  /** 사람이 읽을 상세 목록 (최대 일부만) */
  details?: string[]
}

export interface PrefixMapping {
  prefix: string
  status: 'rule' | 'unknown' | 'resolved'
  category: Resolution | null
  outputPrefix: string | null
  rowCount: number
  ruleSource?: PositionRule['source']
  /** 미등록 prefix에 대한 TYPE 기반 제안 (자동 적용하지 않음) */
  suggestion?: Category
  examples: string[]
}

export interface SheetCell {
  value: string
  /** conflict: 동일 Position 복수 주소, missing: 주소 없음 */
  flag?: 'conflict' | 'missing'
}

/**
 * 시트 안의 표 하나. SheetModel의 columns·rows 중 일부를 인덱스로 가리킨다.
 * 연발·단발은 접두어(C/CF, S/GI/GO …)마다 표를 따로 만들어 위아래로 쌓는다 (혜원 2026-09-29)
 */
export interface SheetBlock {
  /** 위치 접두어(S, GI …) 또는 미배치 POS */
  label: string
  columns: number[]
  rows: number[]
}

export interface SheetModel {
  name: string
  control: string
  category: Category | '미분류' | '원본'
  /** true면 제목·요약 줄 없이 1행이 헤더 */
  plain?: boolean
  /** Excel 1행: 제목 */
  title: string
  /** Excel 2행: 원본 행 수·병합 기준 요약 */
  summary: string
  columns: string[]
  rows: SheetCell[][]
  /** 있으면 Excel·미리보기는 이 표들을 위에서부터 쌓는다. 없으면 columns·rows 전체가 표 하나 */
  blocks?: SheetBlock[]
  sourceRowCount: number
}

export interface Analysis {
  fileName: string
  encoding: string
  totalRows: number
  detectedColumns: { key: ColumnKey; header: string }[]
  ignoredColumns: string[]
  controls: { name: string; rowCount: number }[]
  addressSummary: { dominant: 'ADDR' | 'MODULE-PIN' | '없음'; addr: number; modulePin: number; none: number }
  prefixMappings: PrefixMapping[]
  categoryStats: { control: string; category: Category; rows: number; groups: number }[]
  issues: Issue[]
  blocked: boolean
}

export interface TransformResult {
  analysis: Analysis
  sheets: SheetModel[]
}

export const CATEGORIES = ['타상', '연발', '단발'] as const
export type Category = (typeof CATEGORIES)[number]
export const EXCLUDE = '제외'
export type Resolution = Category | typeof EXCLUDE

export const CATEGORY_PREFIX: Record<Category, string> = { 타상: 'P', 연발: 'C', 단발: 'S' }

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
  /** 결과 행 순서: 시간순(원본 등장 순서) 또는 효과순(같은 효과끼리 → 시간순) */
  rowOrder: 'time' | 'effect'
  /** 맨 앞에 원본(주소 매긴) 데이터 전체를 시트로 넣는다 */
  includeSourceSheet: boolean
}

export const DEFAULT_OPTIONS: TransformOptions = {
  addressSource: 'auto',
  groupKeys: ['HH', 'MM', 'SS', 'FF', 'EFFECT'],
  createEmptySheets: true,
  singleControlSheetNaming: 'simple',
  rowOrder: 'time',
  includeSourceSheet: false
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

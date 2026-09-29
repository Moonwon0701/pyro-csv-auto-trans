import { readFileSync } from 'fs'
import { resolve } from 'path'
import iconv from 'iconv-lite'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  buildXlsx,
  parseCsv,
  transform,
  type Resolution,
  type RuleSet,
  type SheetModel,
  type TransformOptions
} from '../../src/engine'

const RULES: RuleSet = JSON.parse(readFileSync(resolve(__dirname, '../../rules/rules.json'), 'utf8'))

const HEADER = 'CONTROL,CUE,HH,MM,SS,FF,TYPE,POS,ADDR,MODULE,PIN,QTY,Effect Description'

function run(lines: string[], opts: Partial<TransformOptions> = {}, resolutions: Record<string, Resolution> = {}, header = HEADER) {
  const csv = parseCsv(Buffer.from([header, ...lines].join('\r\n'), 'utf8'), 'test.csv')
  return transform(csv, RULES, resolutions, { ...DEFAULT_OPTIONS, ...opts })
}

function sheet(sheets: SheetModel[], name: string): SheetModel {
  const s = sheets.find((x) => x.name === name)
  if (!s) throw new Error(`sheet not found: ${name} (have ${sheets.map((x) => x.name).join(', ')})`)
  return s
}

function cell(s: SheetModel, row: number, column: string): string {
  const idx = s.columns.indexOf(column)
  if (idx < 0) throw new Error(`column not found: ${column} (have ${s.columns.join(', ')})`)
  return s.rows[row][idx].value
}

describe('Spec 10. Acceptance Test', () => {
  it('T01 3P/4P/5P/6P-01 → P-01', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,shell,3P-01,101,,,1,A',
      'FC-01,2,00,00,02,00,shell,4P-01,102,,,1,B',
      'FC-01,3,00,00,03,00,shell,5P-01,103,,,1,C',
      'FC-01,4,00,00,04,00,shell,6P-01,104,,,1,D'
    ])
    const s = sheet(sheets, '타상')
    expect(s.columns.filter((c) => /^P-/.test(c))).toEqual(['P-01'])
    expect(s.rows.map((r) => cell(s, s.rows.indexOf(r), 'P-01'))).toEqual(['101', '102', '103', '104'])
  })

  // 스펙은 연발·단발도 끝번호로 합치라고 했지만, 현장에서 C/CF, S/GI/GO는 서로 다른 위치라 따로 둔다 (혜원 2026-09-29)
  it('T02 연발 CF/CK/SCK-03은 C-03으로 합치지 않고 각자 열', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,cake,CF-03,1,,,1,A',
      'FC-01,2,00,00,02,00,cake,CK-03,2,,,1,B',
      'FC-01,3,00,00,03,00,cake,SCK-03,3,,,1,C'
    ])
    const s = sheet(sheets, '연발')
    expect(s.columns.filter((c) => /-\d+$/.test(c))).toEqual(['CF-01', 'CF-02', 'CF-03', 'CK-01', 'CK-02', 'CK-03', 'SCK-01', 'SCK-02', 'SCK-03'])
    expect([cell(s, 0, 'CF-03'), cell(s, 1, 'CK-03'), cell(s, 2, 'SCK-03')]).toEqual(['1', '2', '3'])
  })

  it('T03 단발 G/H1/H2/TX-08도 각자 열', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,single_shot,G-08,1,,,1,A',
      'FC-01,2,00,00,02,00,single_shot,H1-08,2,,,1,B',
      'FC-01,3,00,00,03,00,single_shot,H2-08,3,,,1,C',
      'FC-01,4,00,00,04,00,single_shot,TX-08,4,,,1,D'
    ])
    const s = sheet(sheets, '단발')
    expect(s.columns.filter((c) => /-08$/.test(c))).toEqual(['G-08', 'H1-08', 'H2-08', 'TX-08'])
    expect(s.columns.some((c) => /^S-/.test(c))).toBe(false)
    expect(s.rows).toHaveLength(4)
  })

  it('여수: 같은 시간의 GI-04/GO-04가 한 칸에 섞이지 않고, 열은 접두어끼리 묶고 기본 접두어 먼저', () => {
    const { sheets, analysis } = run(
      [
        'FC-01,1,00,00,01,00,single_shot,S-01,D24,,,1,A',
        'FC-01,2,00,00,02,00,single_shot,GO-04,BCA,,,1,B',
        'FC-01,3,00,00,02,00,single_shot,GI-04,AC2,,,1,B',
        'FC-01,4,00,00,03,00,cake,C-01,8F6,,,1,C',
        'FC-01,5,00,00,03,00,cake,CF-01,958,,,1,C'
      ],
      {},
      { GI: '단발', GO: '단발' }
    )
    const s = sheet(sheets, '단발')
    expect(s.columns.filter((c) => /-\d+$/.test(c))).toEqual(['S-01', 'GI-01', 'GI-02', 'GI-03', 'GI-04', 'GO-01', 'GO-02', 'GO-03', 'GO-04'])
    expect([cell(s, 1, 'GI-04'), cell(s, 1, 'GO-04')]).toEqual(['AC2', 'BCA'])
    expect(analysis.issues.find((i) => i.code === 'MULTI_ADDRESS')).toBeUndefined()
    expect(analysis.prefixMappings.find((m) => m.prefix === 'GI')!.outputPrefix).toBe('GI')
    const c = sheet(sheets, '연발')
    expect(c.columns.filter((x) => /-\d+$/.test(x))).toEqual(['C-01', 'CF-01'])
    expect([cell(c, 0, 'C-01'), cell(c, 0, 'CF-01')]).toEqual(['8F6', '958'])
  })

  it('여수: 접두어별 표를 옆이 아니라 위아래로 쌓는다 (S 표 끝나고 GI 표)', async () => {
    const { sheets } = run(
      [
        'FC-01,1,00,00,01,00,single_shot,S-01,D24,,,1,A',
        'FC-01,2,00,00,02,00,single_shot,GI-02,AA2,,,1,B',
        'FC-01,3,00,00,03,00,single_shot,S-02,D8A,,,1,C',
        'FC-01,4,00,00,03,00,single_shot,GI-01,A91,,,1,C'
      ],
      {},
      { GI: '단발' }
    )
    const s = sheet(sheets, '단발')
    const view = (i: number) => ({
      label: s.blocks![i].label,
      columns: s.blocks![i].columns.map((c) => s.columns[c]),
      rows: s.blocks![i].rows.map((r) => s.rows[r][0].value)
    })
    expect(s.blocks).toHaveLength(2)
    expect(view(0)).toEqual({ label: 'S', columns: ['CUE', 'HH', 'MM', 'SS', 'FF', 'QTY', 'Effect Description', 'S-01', 'S-02', 'NOTE'], rows: ['1', '3'] })
    expect(view(1)).toEqual({ label: 'GI', columns: ['CUE', 'HH', 'MM', 'SS', 'FF', 'QTY', 'Effect Description', 'GI-01', 'GI-02', 'NOTE'], rows: ['2', '3'] })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await buildXlsx(sheets)) as unknown as ExcelJS.Buffer)
    const ws = wb.getWorksheet('단발')!
    const text = (r: number) => (ws.getRow(r).values as unknown[]).slice(1).map(String)
    expect(text(3).slice(7)).toEqual(['S-01', 'S-02', 'NOTE'])
    expect(text(4)[7]).toBe('D24')
    expect(text(5)[8]).toBe('D8A')
    expect(ws.getRow(6).cellCount).toBe(0)
    expect(text(7).slice(7)).toEqual(['GI-01', 'GI-02', 'NOTE'])
    expect(text(8)[8]).toBe('AA2')
    expect(text(9)[7]).toBe('A91')
  })

  it('접두어가 하나뿐이면 표를 나누지 않는다', () => {
    const { sheets } = run(['FC-01,1,00,00,01,00,shell,3P-01,1,,,1,A', 'FC-01,2,00,00,02,00,shell,4P-02,2,,,1,B'])
    expect(sheet(sheets, '타상').blocks).toBeUndefined()
  })

  it('T04/T11 신규 번호는 질문 없이 열 자동 생성 (P-01 ~ 최대 P-12 연속)', () => {
    const { sheets, analysis } = run([
      'FC-01,1,00,00,01,00,shell,3P-01,1,,,1,A',
      'FC-01,2,00,00,02,00,shell,3P-12,2,,,1,A',
      'FC-01,3,00,00,03,00,shell,7P-08,3,,,1,A'
    ], {}, { '7P': '타상' })
    const s = sheet(sheets, '타상')
    expect(s.columns.filter((c) => /^P-/.test(c))).toEqual(Array.from({ length: 12 }, (_, i) => `P-${String(i + 1).padStart(2, '0')}`))
    expect(cell(s, 2, 'P-08')).toBe('3')
    expect(analysis.issues.find((i) => i.code === 'UNKNOWN_PREFIX')).toBeUndefined()
  })

  it('T05 신규 Prefix FX-01은 추측하지 않고 Blocking', () => {
    const { analysis, sheets } = run(['FC-01,1,00,00,01,00,single_shot,FX-01,1,,,1,A'])
    expect(analysis.blocked).toBe(true)
    const m = analysis.prefixMappings.find((p) => p.prefix === 'FX')!
    expect(m.status).toBe('unknown')
    expect(m.category).toBeNull()
    expect(m.suggestion).toBe('단발') // 제안만 하고 적용하지 않음
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true)
  })

  it('T05b 사용자가 FX를 단발로 지정하면 단발 시트의 FX-01 열로 처리', () => {
    const { analysis, sheets } = run(['FC-01,1,00,00,01,00,single_shot,FX-01,77,,,1,A'], {}, { FX: '단발' })
    expect(analysis.blocked).toBe(false)
    expect(cell(sheet(sheets, '단발'), 0, 'FX-01')).toBe('77')
  })

  it('T06 ADDR=221 → 위치 셀 221', () => {
    const { sheets, analysis } = run(['FC-01,1,00,01,40,05,shell,3P-01,221,12,29,1,A'])
    expect(cell(sheet(sheets, '타상'), 0, 'P-01')).toBe('221')
    expect(analysis.addressSummary.dominant).toBe('ADDR')
  })

  it('T07 ADDR 없음 + MODULE=12 PIN=29 → 12-29', () => {
    const { sheets, analysis } = run(['firepioneer,1,00,01,40,05,shell,3P-01,,12,29,1,A'])
    expect(cell(sheet(sheets, '타상'), 0, 'P-01')).toBe('12-29')
    expect(analysis.addressSummary.dominant).toBe('MODULE-PIN')
  })

  it('T08 동일 Cue에서 P-01 주소 221, 241 → 모두 보존 + Warning', () => {
    const { sheets, analysis } = run([
      'FC-01,1,00,01,40,05,shell,3P-01,221,,,1,3 Orange Strobe',
      'FC-01,2,00,01,40,05,shell,4P-01,241,,,1,3 Orange Strobe',
      'FC-01,3,00,01,40,05,shell,5P-01,221,,,1,3 Orange Strobe'
    ])
    const s = sheet(sheets, '타상')
    expect(s.rows).toHaveLength(1)
    expect(cell(s, 0, 'P-01')).toBe('221, 241')
    expect(s.rows[0][s.columns.indexOf('P-01')].flag).toBe('conflict')
    expect(analysis.issues.find((i) => i.code === 'MULTI_ADDRESS')?.severity).toBe('warning')
  })

  it('T09 FC-01, FC-02 → Control × 3 카테고리 = 6개 시트', () => {
    const { sheets } = run([
      'FC-02,1,00,00,01,00,shell,3P-01,1,,,1,A',
      'FC-01,2,00,00,02,00,cake,CF-01,2,,,1,B'
    ])
    expect(sheets.map((s) => s.name)).toEqual([
      'FC-01 타상', 'FC-01 연발', 'FC-01 단발', 'FC-02 타상', 'FC-02 연발', 'FC-02 단발'
    ])
  })

  it('T09b FC-03이 추가되면 9개 시트 (하드코딩 없음)', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,shell,3P-01,1,,,1,A',
      'FC-02,1,00,00,01,00,shell,3P-01,1,,,1,A',
      'FC-03,1,00,00,01,00,shell,3P-01,1,,,1,A'
    ])
    expect(sheets).toHaveLength(9)
  })

  it('T10 CONTROL 1종 → 타상/연발/단발 3개 시트', () => {
    const { sheets } = run(['firepioneer,1,00,00,01,00,shell,3P-01,,1,2,1,A'])
    expect(sheets.map((s) => s.name)).toEqual(['타상', '연발', '단발'])
    const full = run(['firepioneer,1,00,00,01,00,shell,3P-01,,1,2,1,A'], { singleControlSheetNaming: 'full' })
    expect(full.sheets[0].name).toBe('firepioneer 타상')
  })

  it('T12 같은 HH/MM/SS/FF/Effect의 여러 행 → 1행 병합 (Spec 11장 예시)', () => {
    const { sheets } = run([
      'FC-01,1,00,01,40,05,shell,3P-01,221,,,1,3 Orange Strobe',
      'FC-01,2,00,01,40,05,shell,4P-02,241,,,1,3 Orange Strobe',
      'FC-01,3,00,01,40,05,shell,5P-03,261,,,1,3 Orange Strobe'
    ])
    const s = sheet(sheets, '타상')
    expect(s.columns).toEqual(['CUE', 'HH', 'MM', 'SS', 'FF', 'QTY', 'Effect Description', 'P-01', 'P-02', 'P-03', 'NOTE'])
    expect(s.rows.map((r) => r.map((c) => c.value))).toEqual([
      ['1', '00', '01', '40', '05', '1', '3 Orange Strobe', '221', '241', '261', '']
    ])
  })
})

describe('Spec 10.1 실패하면 안 되는 항목', () => {
  it('영숫자 ADDR(47A, 1F0)와 앞자리 0을 xlsx에서 문자열로 유지', async () => {
    const { sheets } = run([
      'FC-01,1,00,01,40,05,shell,3P-01,47A,,,1,A',
      'FC-01,2,00,01,40,06,shell,3P-02,1F0,,,1,B',
      'FC-01,3,00,01,40,07,shell,3P-03,0012,,,1,C'
    ])
    const bytes = await buildXlsx(sheets)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
    const ws = wb.getWorksheet('타상')!
    expect(ws.getCell('A1').value).toBe('test - 타상')
    expect(ws.getCell('B4').value).toBe('00')
    const pCol = (ws.getRow(3).values as string[]).indexOf('P-01')
    expect(ws.getRow(4).getCell(pCol).value).toBe('47A')
    expect(ws.getRow(5).getCell(pCol + 1).value).toBe('1F0')
    expect(ws.getRow(6).getCell(pCol + 2).value).toBe('0012')
  })

  it('미등록 Prefix를 TYPE만 보고 자동 분류하지 않는다', () => {
    const { analysis } = run(['FC-01,1,00,00,01,00,shell,ZZ-01,1,,,1,A'])
    expect(analysis.prefixMappings[0].category).toBeNull()
    expect(analysis.blocked).toBe(true)
  })

  it('Position 최대값을 고정하지 않는다 (H1-23, P-99)', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,single_shot,H1-23,1,,,1,A',
      'FC-01,2,00,00,02,00,shell,3P-99,1,,,1,A'
    ])
    expect(sheet(sheets, '단발').columns).toContain('H1-23')
    expect(sheet(sheets, '타상').columns).toContain('P-99')
  })
})

describe('보조 규칙', () => {
  it('원본 데이터 시트 옵션: 맨 앞에 원본 전체, xlsx에서는 1행이 헤더', async () => {
    const lines = ['FC-01,1,00,00,01,00,shell,3P-01,047,,,1,A']
    expect(run(lines).sheets.some((s) => s.category === '원본')).toBe(false)
    const { sheets } = run(lines, { includeSourceSheet: true })
    expect(sheets[0].name).toBe('원본 데이터')
    expect(sheets[0].columns).toEqual(HEADER.split(','))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await buildXlsx(sheets)) as unknown as ExcelJS.Buffer)
    const ws = wb.getWorksheet('원본 데이터')!
    expect(ws.getCell('A1').value).toBe('CONTROL')
    expect(ws.getCell('I2').value).toBe('047')
  })

  it('CUE는 그룹 첫 행의 원본 CUE, 기본(제품명순)은 같은 효과끼리 모은다', () => {
    const lines = [
      'FC-01,7,00,00,01,00,shell,3P-01,1,,,1,Zeta',
      'FC-01,8,00,00,02,00,shell,3P-01,2,,,1,alpha',
      'FC-01,9,00,00,03,00,shell,3P-01,3,,,1,Zeta'
    ]
    const time = sheet(run(lines, { rowOrder: 'time' }).sheets, '타상')
    expect(time.rows.map((r) => r[0].value)).toEqual(['7', '8', '9'])
    const effect = sheet(run(lines).sheets, '타상')
    expect(effect.rows.map((r) => r[0].value)).toEqual(['8', '7', '9'])
  })

  it('시간 값 한 자리는 두 자리로 맞춤 (0 → 00)', () => {
    const { sheets } = run(['FC-01,1,0,1,40,5,shell,3P-01,221,,,1,A'])
    expect(sheet(sheets, '타상').rows[0].slice(1, 5).map((c) => c.value)).toEqual(['00', '01', '40', '05'])
  })

  it('빈 시트도 파일 전체 최대 번호까지 Position 열을 가진다', () => {
    const { sheets } = run(['FC-01,1,00,00,01,00,shell,3P-03,1,,,1,A', 'FC-02,1,00,00,01,00,cake,C-01,1,,,1,A'])
    expect(sheet(sheets, 'FC-02 타상').columns.filter((c) => /^P-/.test(c))).toEqual(['P-01', 'P-02', 'P-03'])
  })

  it('PFT, REF, MFG, PRICE1은 결과에서 제외', () => {
    const { sheets, analysis } = run(['FC-01,1,00,00,01,00,shell,3P-01,1,M,9.9,100,A,R'], {}, {}, 'CONTROL,CUE,HH,MM,SS,FF,TYPE,POS,ADDR,MFG,PRICE1,PFT,Effect Description,REF')
    expect(sheet(sheets, '타상').columns).toEqual(['CUE', 'HH', 'MM', 'SS', 'FF', 'Effect Description', 'P-01', 'NOTE'])
    expect(analysis.ignoredColumns).toEqual(['MFG', 'PRICE1', 'PFT', 'REF'])
  })

  it('POS가 비어 있으면 TYPE으로 분류하고 미배치 POS 열에 보존', () => {
    const { sheets, analysis } = run(['FC-01,1,00,00,01,00,cake,,55,,,1,A'])
    const s = sheet(sheets, '연발')
    expect(cell(s, 0, '미배치 POS')).toBe('(POS 없음)=55')
    expect(analysis.issues.some((i) => i.code === 'EMPTY_POS')).toBe(true)
  })

  it('POS와 TYPE 모두 분류 불가하면 미분류 시트에 원본 보존', () => {
    const { sheets } = run(['FC-01,1,00,00,01,00,,,55,,,1,A'])
    const s = sheet(sheets, '미분류')
    expect(s.rows[0][0].value).toBe('2')
  })

  it('제외로 지정한 Prefix는 결과에서 빠진다', () => {
    const { sheets, analysis } = run(['FC-01,1,00,00,01,00,shell,ABC-01,1,,,1,A'], {}, { ABC: '제외' })
    expect(analysis.blocked).toBe(false)
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true)
  })

  it('빈 시트 옵션 OFF면 데이터 있는 조합만', () => {
    const { sheets } = run(['FC-01,1,00,00,01,00,shell,3P-01,1,,,1,A'], { createEmptySheets: false })
    expect(sheets.map((s) => s.name)).toEqual(['타상'])
  })

  it('주소가 없으면 "주소없음"으로 표시하고 Warning', () => {
    const { sheets, analysis } = run(['FC-01,1,00,00,01,00,shell,3P-01,,,,1,A'])
    expect(cell(sheet(sheets, '타상'), 0, 'P-01')).toBe('주소없음')
    expect(analysis.issues.some((i) => i.code === 'NO_ADDRESS')).toBe(true)
    expect(analysis.issues.some((i) => i.code === 'NO_ADDRESS_ANY')).toBe(true)
  })

  it('기타 컬럼: 같으면 한 번, 다르면 ", "로 연결', () => {
    const { sheets } = run([
      'FC-01,1,00,00,01,00,shell,3P-01,1,,,2,A',
      'FC-01,2,00,00,01,00,shell,3P-02,2,,,2,A',
      'FC-01,3,00,00,01,00,shell,3P-03,3,,,3,A'
    ])
    expect(cell(sheet(sheets, '타상'), 0, 'QTY')).toBe('2, 3')
  })

  it('Group Key 비교 시 앞뒤 공백 무시, 원본 첫 등장 순서 유지', () => {
    const { sheets } = run([
      'FC-01,1,00,00,09,00,shell,3P-01,1,,,1,Later',
      'FC-01,2,00,00,01,00,shell,3P-01,2,,,1, Early ',
      'FC-01,3,00,00,01,00,shell,3P-02,3,,,1,Early'
    ], { rowOrder: 'time' })
    const s = sheet(sheets, '타상')
    expect(s.rows.map((r) => r[s.columns.indexOf('Effect Description')].value)).toEqual(['Later', 'Early'])
  })

  it('CP949 인코딩 CSV와 헤더 앞 제목 줄을 처리', () => {
    const text = ['불꽃쇼 디자인 Export', HEADER, 'FC-01,1,00,00,01,00,shell,3P-01,221,,,1,빨강 스트로브'].join('\r\n')
    const csv = parseCsv(iconv.encode(text, 'cp949'), 'kr.csv')
    expect(csv.encoding).toBe('CP949')
    const { sheets } = transform(csv, RULES, {}, DEFAULT_OPTIONS)
    expect(cell(sheet(sheets, '타상'), 0, 'Effect Description')).toBe('빨강 스트로브')
  })

  it('헤더 대소문자·공백 차이를 허용 (effect description, Addr)', () => {
    const { sheets } = run(['FC-01,00,00,01,00,shell,3P-01,221,A'], {}, {}, 'Control,hh,mm,ss,ff,Type,Pos,Addr,effect description')
    expect(cell(sheet(sheets, '타상'), 0, 'P-01')).toBe('221')
  })

  it('시트명 금지문자와 31자 제한 처리', () => {
    const { sheets } = run(['FC/01:[A],1,00,00,01,00,shell,3P-01,1,,,1,A', 'B,1,00,00,01,00,shell,3P-01,1,,,1,A'])
    expect(sheets[0].name).toBe('B 타상')
    expect(sheets.find((s) => s.name.startsWith('FC_01_'))).toBeTruthy()
  })
})

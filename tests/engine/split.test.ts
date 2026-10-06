import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { parseCsv, serializeCsv, splitCandidates, splitCsv } from '../../src/engine'

const TEXT = `CUE,HH,MM,SS,FF,PFT,ADDR,CONTROL,POS,QTY,TILT,CUSTOM4
0,01,00,01,19,1.1,560,개막선언,C-02,1,90,FC-01
1,01,00,01,19,,480,개막선언,C-04,1,90,FC-02
2,00,00,04,28,,0F3,메인,3P-02,2,-60-60,FC-01
3,00,00,07,11,,030,메인,S-01,1,90,FC-02
`

describe('CSV 나누기', () => {
  const csv = parseCsv(new Uint8Array(iconv.encode(TEXT, 'cp949')), '#0 통합.csv')

  it('나눌 기준 후보: CONTROL·CUSTOM·HH를 앞에', () => {
    expect(splitCandidates(csv).map((c) => c.header).slice(0, 3)).toEqual(['CONTROL', 'CUSTOM4', 'HH'])
  })

  it('구간별로 나누고 HH를 당긴다. 값·인코딩은 그대로', () => {
    const parts = splitCsv(csv, { by: 'CONTROL', dropColumns: ['PFT'], resetHH: true })
    expect(parts.map((p) => [p.key, p.csv.fileName, p.csv.rows.length])).toEqual([
      ['개막선언', '#0 통합 개막선언.csv', 2],
      ['메인', '#0 통합 메인.csv', 2]
    ])
    const [open, main] = parts
    expect(open.csv.headers).not.toContain('PFT')
    expect(open.csv.rows.map((r) => r[1])).toEqual(['00', '00'])
    expect(main.csv.rows.map((r) => r[1])).toEqual(['00', '00'])
    expect(main.csv.rows.map((r) => [r[5], r[9]])).toEqual([
      ['0F3', '-60-60'],
      ['030', '90']
    ])
    expect(iconv.decode(Buffer.from(serializeCsv(main.csv)), 'cp949')).toBe(
      'CUE,HH,MM,SS,FF,ADDR,CONTROL,POS,QTY,TILT,CUSTOM4\r\n2,00,00,04,28,0F3,메인,3P-02,2,-60-60,FC-01\r\n3,00,00,07,11,030,메인,S-01,1,90,FC-02\r\n'
    )
  })

  it('FC별로 나누면 행이 빠짐없이 나뉜다', () => {
    const parts = splitCsv(csv, { by: 'CUSTOM4', dropColumns: [], resetHH: false })
    expect(parts.map((p) => p.key)).toEqual(['FC-01', 'FC-02'])
    expect(parts.flatMap((p) => p.csv.rows).sort()).toEqual([...csv.rows].sort())
  })
})

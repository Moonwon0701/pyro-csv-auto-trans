import { useEffect, useState } from 'react'
import type { SheetModel } from '@engine/types'

const MAX_ROWS = 300
const POS_COLUMN = /^[A-Z]+-\d+$/

export default function SheetPreview({ sheets }: { sheets: SheetModel[] }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (idx >= sheets.length) setIdx(0)
  }, [sheets, idx])
  const sheet = sheets[idx] ?? sheets[0]
  if (!sheet) return <div className="preview empty-sheet">만들어질 시트가 없습니다.</div>

  const posCols = sheet.columns.map((c) => POS_COLUMN.test(c))
  const blocks = sheet.blocks ?? [{ label: '', columns: sheet.columns.map((_, i) => i), rows: sheet.rows.map((_, i) => i) }]
  // 미리보기는 모든 표를 합쳐 MAX_ROWS행까지만
  let budget = MAX_ROWS
  const shown = blocks.map((b) => {
    const rows = b.rows.slice(0, Math.max(0, budget))
    budget -= rows.length
    return { ...b, rows }
  })
  const totalRows = blocks.reduce((n, b) => n + b.rows.length, 0)
  return (
    <div className="preview">
      <div className="sheet-tabs">
        {sheets.map((s, i) => (
          <button key={s.name} className={`sheet-tab ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
            {s.name}
            <span className="n">{s.rows.length}</span>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        {sheet.rows.length === 0 ? (
          <div className="empty-sheet">이 시트에는 데이터가 없습니다 (빈 시트로 생성됨)</div>
        ) : (
          <table className="xl">
            {shown.map((b, bi) =>
              b.rows.length === 0 ? null : (
                <tbody key={bi} className={bi > 0 ? 'block-next' : ''}>
                  <tr>
                    {b.columns.map((c) => (
                      <th key={c}>{sheet.columns[c]}</th>
                    ))}
                  </tr>
                  {b.rows.map((r) => (
                    <tr key={r}>
                      {b.columns.map((c) => {
                        const cell = sheet.rows[r][c]
                        return (
                          <td key={c} className={[cell.flag ?? '', posCols[c] ? 'pos' : ''].join(' ')}>
                            {cell.value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              )
            )}
          </table>
        )}
      </div>
      <div className="preview-foot">
        <span>
          원본 {sheet.sourceRowCount}행 → {sheet.rows.length}개 그룹
          {blocks.length > 1 && ` · 표 ${blocks.length}개 (${blocks.map((b) => b.label).join(', ')})`}
          {totalRows > MAX_ROWS && ` (미리보기는 처음 ${MAX_ROWS}행)`}
        </span>
        <span>
          <span className="swatch" style={{ background: 'var(--conflict)' }} />
          같은 위치 복수 주소
        </span>
        <span>
          <span className="swatch" style={{ background: 'var(--missing)' }} />
          주소없음
        </span>
      </div>
    </div>
  )
}

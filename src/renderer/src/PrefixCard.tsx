import { CATEGORIES, EXCLUDE, type PrefixMapping, type Resolution } from '@engine/types'

const RESOLUTIONS: Resolution[] = [...CATEGORIES, EXCLUDE]

interface Props {
  /** Rule에 없는 접두어 */
  mappings: PrefixMapping[]
  resolutions: Record<string, Resolution>
  setResolutions: (update: (r: Record<string, Resolution>) => Record<string, Resolution>) => void
  saveToMaster: Record<string, boolean>
  setSaveToMaster: (update: (s: Record<string, boolean>) => Record<string, boolean>) => void
  /** 튜토리얼 중에는 Rule을 저장하지 않는다 */
  tutorial?: boolean
  /** Rule 저장 열 설명 */
  saveTitle: string
}

/** 처음 보는 POS 접두어(예: FX-01)의 분류를 고르는 카드. 추측하지 않고 사용자에게 묻는다 */
export default function PrefixCard({ mappings, resolutions, setResolutions, saveToMaster, setSaveToMaster, tutorial, saveTitle }: Props) {
  if (mappings.length === 0) return null
  const unresolved = mappings.filter((m) => !resolutions[m.prefix])
  return (
    <div className={`card ${unresolved.length ? 'alert' : ''}`}>
      <h3>
        처음 보는 위치 접두어 <span className="count">{mappings.length}</span>
        <span className="spacer" />
        {unresolved.some((m) => m.suggestion) && (
          <button
            className="btn small"
            onClick={() =>
              setResolutions((r) => {
                const next = { ...r }
                unresolved.forEach((m) => m.suggestion && (next[m.prefix] = m.suggestion))
                return next
              })
            }
          >
            TYPE 제안대로 선택
          </button>
        )}
      </h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Prefix</th>
            <th className="num">행</th>
            <th>분류</th>
            <th title={saveTitle}>Rule 저장</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((m) => (
            <tr key={m.prefix}>
              <td>
                <span className="mono">{m.prefix}-*</span>
                <div className="hint">
                  예: {m.examples.join(', ')}
                  {m.suggestion && ` · TYPE 제안: ${m.suggestion}`}
                </div>
              </td>
              <td className="num">{m.rowCount}</td>
              <td>
                <select
                  value={resolutions[m.prefix] ?? ''}
                  onChange={(e) =>
                    setResolutions((r) => {
                      const next = { ...r }
                      if (e.target.value) next[m.prefix] = e.target.value as Resolution
                      else delete next[m.prefix]
                      return next
                    })
                  }
                >
                  <option value="">선택하세요</option>
                  {RESOLUTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={!tutorial && (saveToMaster[m.prefix] ?? true)}
                  disabled={tutorial}
                  title={tutorial ? '튜토리얼 중에는 Rule을 저장하지 않습니다' : undefined}
                  onChange={(e) => setSaveToMaster((s) => ({ ...s, [m.prefix]: e.target.checked }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

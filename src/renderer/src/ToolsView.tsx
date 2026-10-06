import { useEffect, useState } from 'react'
import type { FileInfo, RestoreSummary, SplitSource } from '../../preload'
import IssueItem from './IssueItem'

type Which = 'originals' | 'damaged'

/**
 * 파일 도구
 * - 엑셀 손상 복원: 엑셀로 열어 저장한 CSV(직렬 TILT 합계, 주소 앞자리 0 …)를 엑셀을 거치지 않은 원본과 대조해 되돌린다
 * - CSV 나누기: FC·구간별 파일을 엑셀 없이 만든다 (값이 깨지지 않는다)
 */
export default function ToolsView() {
  return (
    <div className="tools-page">
      <RestoreCard />
      <SplitCard />
    </div>
  )
}

function DropBox({ label, hint, files, onFiles, onPick }: { label: string; hint: string; files: FileInfo[]; onFiles: (paths: string[]) => void; onPick: () => void }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`dropbox ${over ? 'over' : ''}`}
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const paths = window.api.pathsOf([...e.dataTransfer.files])
        if (paths.length) onFiles(paths)
      }}
    >
      <b>{label}</b>
      {files.length === 0 ? (
        <span className="hint">{hint}</span>
      ) : (
        files.map((f) => (
          <span key={f.path} className="mono small-line">
            {f.fileName} <span className="hint">· {f.rows.toLocaleString()}행 · {f.encoding}</span>
          </span>
        ))
      )}
    </div>
  )
}

function RestoreCard() {
  const [files, setFiles] = useState<Record<Which, FileInfo[]>>({ originals: [], damaged: [] })
  const [results, setResults] = useState<RestoreSummary[] | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string; path?: string }>({ kind: '', text: '' })

  async function set(which: Which, paths: string[] | null) {
    if (!paths?.length) return
    try {
      const loaded = await window.api.restoreSet(which, paths)
      setFiles((f) => ({ ...f, [which]: loaded }))
      setStatus({ kind: '', text: '' })
    } catch (e) {
      setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${(e as Error).message ?? e}` })
    }
  }

  useEffect(() => {
    if (!files.originals.length || !files.damaged.length) return setResults(null)
    window.api
      .restoreRun()
      .then(setResults)
      .catch((e) => setStatus({ kind: 'err', text: String(e.message ?? e) }))
  }, [files])

  async function save() {
    try {
      const r = await window.api.restoreSave()
      setStatus({ kind: 'ok', text: `${r.files.length}개 파일을 “_복원.csv”로 저장했습니다.`, path: r.files[0] })
    } catch (e) {
      setStatus({ kind: 'err', text: String((e as Error).message ?? e) })
    }
  }

  return (
    <div className="card">
      <h3>엑셀 손상 복원</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        CSV를 엑셀로 열었다 저장하면 직렬 TILT(<span className="mono">-60-60</span>)가 합계(<span className="mono">-120</span>)로, 주소{' '}
        <span className="mono">030</span>이 <span className="mono">30</span>으로 바뀝니다. 엑셀을 거치지 않은 원본(디자인 프로그램에서 바로 내보낸 파일이나 이 앱이
        저장한 파일)과 대조해서 엑셀이 바꾼 값만 되돌립니다. 나눈 범위·지운 열·일부러 고친 값은 그대로 둡니다.
      </p>
      <div className="dropbox-row">
        <DropBox
          label="① 원본 CSV"
          hint="여기에 끌어다 놓거나 클릭 (여러 개 가능)"
          files={files.originals}
          onFiles={(p) => set('originals', p)}
          onPick={async () => set('originals', await window.api.restorePick('originals'))}
        />
        <DropBox
          label="② 엑셀로 저장한 CSV"
          hint="나눈 파일 여러 개를 한 번에 넣어도 됩니다"
          files={files.damaged}
          onFiles={(p) => set('damaged', p)}
          onPick={async () => set('damaged', await window.api.restorePick('damaged'))}
        />
      </div>

      {results && (
        <table className="grid" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>파일</th>
              <th className="num">행</th>
              <th className="num">원본에서 찾음</th>
              <th>되돌린 값</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.path}>
                <td className="mono">{r.fileName}</td>
                <td className="num">{r.rows}</td>
                <td className="num">{r.matched === r.rows ? '전부' : `${r.matched}`}</td>
                <td>
                  {r.fixes.length === 0 ? (
                    <span className="hint">없음</span>
                  ) : (
                    <details>
                      <summary>{r.fixes.map((f) => `${f.column} ${f.count}`).join(' · ')}</summary>
                      <div className="hint">
                        {r.fixes.map((f) => (
                          <div key={f.column}>
                            <b>{f.column}</b> {f.examples.join(', ')}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {r.damagedBefore > 0 && (
                    <div className="hint">
                      직렬 TILT 손상 {r.damagedBefore}행 → {r.issues.find((i) => i.code === 'RESTORE_STILL_DAMAGED')?.count ?? 0}행
                    </div>
                  )}
                  {r.issues.map((i) => (
                    <IssueItem key={i.code} issue={i} />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!results?.length} onClick={save}>
          복원본 저장 (각 파일 옆에 _복원.csv)
        </button>
        <span className={`status-line ${status.kind}`}>
          {status.text}
          {status.path && (
            <button className="btn link" style={{ marginLeft: 10 }} onClick={() => window.api.showItem(status.path!)}>
              폴더 열기
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

function SplitCard() {
  const [source, setSource] = useState<SplitSource | null>(null)
  const [by, setBy] = useState('')
  const [drop, setDrop] = useState<string[]>([])
  const [resetHH, setResetHH] = useState(false)
  const [parts, setParts] = useState<{ key: string; fileName: string; rows: number }[] | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string; path?: string }>({ kind: '', text: '' })

  async function open(path: string | null) {
    if (!path) return
    try {
      const s = await window.api.splitOpen(path)
      setSource(s)
      setBy(s.candidates[0]?.header ?? '')
      setDrop([])
      setResetHH(false)
      setStatus({ kind: '', text: '' })
    } catch (e) {
      setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${(e as Error).message ?? e}` })
    }
  }

  const opts = { by, dropColumns: drop, resetHH }
  useEffect(() => {
    if (!source || !by) return setParts(null)
    window.api
      .splitPreview(opts)
      .then(setParts)
      .catch((e) => setStatus({ kind: 'err', text: String(e.message ?? e) }))
  }, [source, by, drop, resetHH])

  async function save() {
    try {
      const r = await window.api.splitSave(opts)
      if (!r) return setStatus({ kind: '', text: '저장을 취소했습니다.' })
      setStatus({ kind: 'ok', text: `${r.files.length}개 파일로 나눴습니다.`, path: r.files[0] })
    } catch (e) {
      setStatus({ kind: 'err', text: String((e as Error).message ?? e) })
    }
  }

  return (
    <div className="card">
      <h3>CSV 나누기</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        FC별·구간별 파일을 엑셀 없이 만듭니다. 값은 한 글자도 바꾸지 않고 원본과 같은 인코딩으로 저장하므로 직렬 TILT·주소가 깨지지 않습니다.
      </p>
      <DropBox
        label="나눌 CSV"
        hint="여기에 끌어다 놓거나 클릭"
        files={source ? [source] : []}
        onFiles={(p) => open(p[0])}
        onPick={async () => open(await window.api.splitPick())}
      />

      {source && (
        <div style={{ marginTop: 12 }}>
          <label className="opt">
            나눌 기준 열
            <select value={by} onChange={(e) => setBy(e.target.value)}>
              {source.candidates.length === 0 && <option value="">나눌 만한 열이 없습니다</option>}
              {source.candidates.map((c) => (
                <option key={c.header} value={c.header}>
                  {c.header} ({c.values}개 값)
                </option>
              ))}
            </select>
          </label>
          <label className="opt">
            파일마다 가장 이른 HH를 0으로 당기기 (통합 파일의 HH=1 구간 → 00)
            <input type="checkbox" checked={resetHH} onChange={(e) => setResetHH(e.target.checked)} />
          </label>
          <div className="opt" style={{ alignItems: 'flex-start' }}>
            <span>지울 열</span>
            <span className="chips" style={{ justifyContent: 'flex-end' }}>
              {source.headers
                .filter((h) => h.trim())
                .map((h) => (
                  <label key={h} className={`chip toggle ${drop.includes(h) ? '' : 'dim'}`}>
                    <input
                      type="checkbox"
                      checked={drop.includes(h)}
                      onChange={(e) => setDrop((d) => (e.target.checked ? [...d, h] : d.filter((x) => x !== h)))}
                    />{' '}
                    {h}
                  </label>
                ))}
            </span>
          </div>

          {parts && (
            <table className="grid" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>{by}</th>
                  <th>파일 이름</th>
                  <th className="num">행</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.key}>
                    <td className="mono">{p.key}</td>
                    <td className="mono">{p.fileName}</td>
                    <td className="num">{p.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!parts?.length} onClick={save}>
          나눠서 저장 (폴더 선택)
        </button>
        <span className={`status-line ${status.kind}`}>
          {status.text}
          {status.path && (
            <button className="btn link" style={{ marginLeft: 10 }} onClick={() => window.api.showItem(status.path!)}>
              폴더 열기
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

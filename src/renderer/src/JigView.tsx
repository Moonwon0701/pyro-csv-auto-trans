import { useEffect, useState } from 'react'
import { leanLabel, leanOf, type JigPosition, type JigSettings } from '@engine/jig'
import { outputPrefixOf, type Issue, type PositionRule, type Resolution } from '@engine/types'
import type { RulesState } from '../../main/rules-store'
import type { AssignSource, JigRun, OpenedFile } from '../../preload'
import { loadJigSettings, saveJigSettings } from './jigSettings'
import PrefixCard from './PrefixCard'

interface Props {
  active: boolean
  rules: RulesState | null
  /** Rule이 바뀔 때마다 증가 (다시 계산) */
  rulesRev: number
  onRulesChanged: (s: RulesState) => void
  /**
   * 같은 원본을 ② 주소 매기기로 넘긴다.
   * session: 처음 보는 접두어 중 Rule로 저장하지 않고 이번 작업에만 쓰는 분류 (③까지 이어짐)
   */
  onSendToAssign: (s: AssignSource, session: Record<string, Resolution>) => void
}

const keyOf = (p: JigPosition) => `${p.control}\u0000${p.pos}`
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
const prefixOf = (pos: string) => pos.replace(/\s*-?\s*\d+$/, '')
const numberOf = (pos: string) => parseInt(pos.match(/(\d+)$/)?.[1] ?? '0', 10)

/**
 * ① 치구 배치: 원본 CSV의 단발을 치구·모듈로 나눈다 (혜원: "치구 배치 후에 주소 배정").
 * 위: 무대 지도 (레이아웃처럼 위치를 가로로) → 위치를 누르면 아래에 확대도 (부채꼴 + 치구 칸 배치표).
 * 아직 주소가 없어서 핀은 "M1-3"(그 위치의 1번째 모듈, 3번 핀)으로 보이고, ②에서 같은 순서로 실제 주소가 붙는다.
 */
export default function JigView({ active, rules, rulesRev, onRulesChanged, onSendToAssign }: Props) {
  const [source, setSource] = useState<OpenedFile | null>(null)
  const [settings, setSettings] = useState<JigSettings>(loadJigSettings)
  const [run, setRun] = useState<JigRun | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [saveToMaster, setSaveToMaster] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | ''; text: string }>({ kind: '', text: '' })

  useEffect(() => saveJigSettings(settings), [settings])

  // 앱 아이콘에 끌어다 놓거나 더블클릭으로 연 파일
  useEffect(() => {
    window.api.onJigOpened((f) => load(Promise.resolve(f)))
  }, [])

  useEffect(() => {
    if (!source) return
    let cancelled = false
    window.api
      .jigRun(settings)
      .then((r) => {
        if (cancelled) return
        setRun(r)
        setSelected((s) => (s && r.positions.some((p) => keyOf(p) === s) ? s : r.positions[0] ? keyOf(r.positions[0]) : null))
      })
      .catch((e) => !cancelled && setStatus({ kind: 'err', text: String(e.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [source, settings, rulesRev])

  useEffect(() => {
    if (!active) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) load(window.api.jigOpenDropped(f))
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', drop)
    }
  }, [active])

  function load(p: Promise<OpenedFile | null>) {
    p.then((f) => {
      if (!f) return
      setSource(f)
      setRun(null)
      setResolutions({})
      setSaveToMaster({})
      setStatus({ kind: '', text: '' })
    }).catch((e) => setStatus({ kind: 'err', text: `파일을 열 수 없습니다: ${e.message ?? e}` }))
  }

  async function next() {
    setBusy(true)
    try {
      // 처음 보는 접두어: “Rule 저장”이면 내 PC Rule로, 아니면 이번 작업에만
      const prefixes = run?.prefixes ?? []
      const chosen = prefixes.filter((m) => resolutions[m.prefix])
      const toSave = chosen.filter((m) => saveToMaster[m.prefix] ?? true)
      if (toSave.length && rules) {
        const now = new Date().toISOString()
        const added: PositionRule[] = toSave.map((m) => ({
          pattern: `${m.prefix}-*`,
          category: resolutions[m.prefix],
          output_prefix: outputPrefixOf(m.prefix, resolutions[m.prefix]),
          active: true,
          source: 'user',
          created_at: now
        }))
        const keep = rules.local.positionRules.filter((r) => !added.some((n) => n.pattern === r.pattern))
        onRulesChanged(await window.api.saveLocalRules({ ...rules.local, positionRules: [...keep, ...added] }))
      }
      const session = Object.fromEntries(chosen.filter((m) => !toSave.includes(m)).map((m) => [m.prefix, resolutions[m.prefix]]))
      onSendToAssign(await window.api.jigToAssign(settings), session)
    } catch (e) {
      setStatus({ kind: 'err', text: String((e as Error).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  if (!source) {
    return (
      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onClick={() => load(window.api.jigPick())}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
      >
        <div className="icon">🎯</div>
        <h2>디자인 프로그램에서 뽑은 CSV를 끌어다 놓으세요</h2>
        <p>
          ① 단발을 치구에 어떻게 꽂을지 정하고 → ② 그 순서대로 주소를 매기고 → ③ 현장용 Excel을 만듭니다.
          <br />이미 주소까지 매겨진 CSV라면 위의 <b>③ 시트 정리</b>로 바로 가도 됩니다.
        </p>
        {status.kind === 'err' && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{status.text}</p>}
      </div>
    )
  }

  const positions = run?.positions ?? []
  const sum = (f: (p: JigPosition) => number) => positions.reduce((a, p) => a + f(p), 0)
  const current = positions.find((p) => keyOf(p) === selected)
  const setNum = (k: 'rows' | 'cols', v: string) => setSettings((s) => ({ ...s, [k]: Math.max(1, Math.min(10, parseInt(v, 10) || 1)) }))
  const unresolved = (run?.prefixes ?? []).filter((m) => !resolutions[m.prefix])

  return (
    <>
      <div className="work">
        <div className="side">
          <div className="card file-card">
            <div style={{ flex: 1 }}>
              <div className="name">{source.fileName}</div>
              <div className="meta">
                {source.rows.toLocaleString()}행 · {source.encoding}
              </div>
            </div>
            <button className="btn small" onClick={() => load(window.api.jigPick())}>
              다른 파일
            </button>
          </div>

          <PrefixCard
            mappings={run?.prefixes ?? []}
            resolutions={resolutions}
            setResolutions={setResolutions}
            saveToMaster={saveToMaster}
            setSaveToMaster={setSaveToMaster}
            saveTitle="다음 단계로 넘어갈 때 이 선택을 내 PC Rule로 저장 (끄면 이번 작업에만)"
          />

          {(run?.addressed ?? 0) > 0 && (
            <div className="card alert">
              <h3>이미 주소가 있는 파일</h3>
              <p className="hint" style={{ margin: 0 }}>
                {run!.addressed.toLocaleString()}행에 주소가 있습니다. ②에서는 기존 주소를 그대로 두고 빈 행만 매깁니다 (이미 주소가 있는 단발 위치는 치구
                순서로 다시 매기지 않음). 주소까지 끝난 파일이면 <b>③ 시트 정리</b>로 바로 가세요.
              </p>
            </div>
          )}

          <div className="card">
            <h3>치구 설정</h3>
            <label className="opt">
              치구 크기 (줄 × 한 줄 칸)
              <span className="row">
                <input className="input mono" style={{ width: 48 }} value={settings.rows} onChange={(e) => setNum('rows', e.target.value)} />×
                <input className="input mono" style={{ width: 48 }} value={settings.cols} onChange={(e) => setNum('cols', e.target.value)} />
              </span>
            </label>
            <label className="opt">
              우선순위
              <select value={settings.priority} onChange={(e) => setSettings({ ...settings, priority: e.target.value as JigSettings['priority'] })}>
                <option value="module">모듈 수 먼저 줄이기</option>
                <option value="jig">치구 수 먼저 줄이기</option>
              </select>
            </label>
            <label className="opt">
              모듈이 치구 두 개에 걸쳐도 됨 (현장 결선 생김)
              <input type="checkbox" checked={settings.allowSpan} onChange={(e) => setSettings({ ...settings, allowSpan: e.target.checked })} />
            </label>
            <p className="hint">
              단발(S-*) 약을 기운 방향 순서(왼쪽으로 누운 것 → 수직 → 오른쪽)로 늘어놓고, 모듈은 16핀·치구 한 개를 넘지 않게 나눕니다. 치구에 꽂는 위치는 Rule
              관리의 “치구” 열로 정합니다.
            </p>
          </div>

          <div className="card">
            <h3>합계</h3>
            <dl className="stats">
              <dt>단발 위치</dt>
              <dd>{positions.length}개</dd>
              <dt>치구</dt>
              <dd>
                <b>{sum((p) => p.jigs.length)}</b>
                <span className="hint"> (이론상 최소 {sum((p) => p.lowerBound.jigs)})</span>
              </dd>
              <dt>모듈</dt>
              <dd>
                <b>{sum((p) => p.modules.length)}</b>
                <span className="hint"> (이론상 최소 {sum((p) => p.lowerBound.modules)})</span>
              </dd>
              <dt>현장 결선</dt>
              <dd>{sum((p) => p.fieldWiring.length) ? `${sum((p) => p.fieldWiring.length)}핀` : '없음 ✓ (모든 치구 미리 결선 가능)'}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>검증 결과</h3>
            {!run || run.issues.length === 0 ? <div className="ok-line">문제 없음 ✓</div> : run.issues.map((i, n) => <IssueLine key={n} issue={i} />)}
          </div>
        </div>

        <div className="main">
          <div className="preview">
            {run && positions.length === 0 ? (
              <div className="empty-sheet">
                치구에 꽂는 단발 위치(S-*)가 없습니다. 아래 <b>② 주소 매기기 →</b>로 넘어가세요.
              </div>
            ) : (
              <>
                <StageMap positions={positions} selected={selected} onSelect={setSelected} />
                {current && <JigPreview key={keyOf(current)} position={current} />}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="actionbar">
        <div className={`status ${status.kind}`}>
          {status.text ||
            (run?.blocked
              ? '해결되지 않은 항목이 있습니다.'
              : unresolved.length
                ? `처음 보는 위치 접두어 ${unresolved.length}개의 분류를 왼쪽에서 골라야 다음 단계로 갈 수 있습니다.`
                : `단발 ${positions.length}개 위치 · 치구 ${sum((p) => p.jigs.length)}개 · 모듈 ${sum((p) => p.modules.length)}개 → 다음: 이 순서대로 주소 매기기`)}
        </div>
        <button className="btn primary big" disabled={!run || run.blocked || unresolved.length > 0 || busy} onClick={next}>
          ② 주소 매기기 →
        </button>
      </div>
    </>
  )
}

/** 무대 지도: 레이아웃처럼 Control·접두어별 줄에 위치를 번호 순서로 가로로 놓는다. 누르면 아래에 확대도 */
function StageMap({ positions, selected, onSelect }: { positions: JigPosition[]; selected: string | null; onSelect: (k: string) => void }) {
  const lines = new Map<string, JigPosition[]>()
  for (const p of positions) {
    const k = `${p.control}\u0000${prefixOf(p.pos)}`
    if (!lines.has(k)) lines.set(k, [])
    lines.get(k)!.push(p)
  }
  return (
    <div className="stage">
      <div className="stage-head">
        <b>무대 지도</b>
        <span className="hint"> · 위치를 누르면 아래에 확대도가 나옵니다</span>
      </div>
      {[...lines]
        .sort((a, b) => naturalCompare(a[0], b[0]))
        .map(([k, ps]) => {
          const max = Math.max(...ps.map((p) => numberOf(p.pos)))
          const byNumber = new Map(ps.map((p) => [numberOf(p.pos), p]))
          const [control] = k.split('\u0000')
          return (
            <div key={k} className="stage-line">
              <div className="stage-label">{control}</div>
              <div className="stage-row" style={{ gridTemplateColumns: `repeat(${max}, minmax(64px, 1fr))` }}>
                {Array.from({ length: max }, (_, i) => {
                  const p = byNumber.get(i + 1)
                  if (!p) return <div key={i} />
                  const on = keyOf(p) === selected
                  return (
                    <button key={i} className={`stage-pos ${on ? 'on' : ''}`} onClick={() => onSelect(keyOf(p))}>
                      <span className="stage-name">{p.pos}</span>
                      <span className="stage-jigs">치구 {p.jigs.length}</span>
                      <span className="stage-sub">모듈 {p.modules.length}개</span>
                      <span className="stage-sub">{p.shells}발</span>
                      {p.fieldWiring.length > 0 && <span className="stage-warn">현장 결선 {p.fieldWiring.length}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      <div className="stage-audience">관객석</div>
    </div>
  )
}

/** 확대도: 위치 한 개. 위에 부채꼴(치구·모듈 구간), 아래에 고른 치구의 칸 배치표 */
function JigPreview({ position: p }: { position: JigPosition }) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, p.jigs.length - 1)
  const jig = p.jigs[index]
  return (
    <div className="jig-preview">
      <div className="zoom-head">
        <b>{p.control ? `${p.control} ` : ''}{p.pos} 확대도</b>
        <span className="hint">
          {' '}
          · 핀 {p.cues.length} · 약 {p.shells}발{p.series ? ` · 직렬 ${p.series}` : ''} · 치구 {p.jigs.length} · 모듈{' '}
          {p.modules.map((m) => `${m.module}(${m.pins}핀/${m.shells}발)`).join(' ')}
        </span>
      </div>
      <PositionFan position={p} selected={index} onSelect={setSelected} />
      {jig && <JigTable position={p} jig={jig} index={index} />}
    </div>
  )
}

const FAN = { step: 13, gap: 18, pad: 24, base: 104, length: 64, height: 168 }

/** 관객석에서 본 위치 전체: 약마다 선 하나를 실제 기운 각도로. 아래 괄호가 치구(모듈) 구간 */
function PositionFan({ position: p, selected, onSelect }: { position: JigPosition; selected: number; onSelect: (j: number) => void }) {
  const field = new Set(p.fieldWiring)
  // 치구마다 튜브 끝이 옆으로 뻗는 범위까지 한 덩어리로 보고, 덩어리끼리 겹치지 않게 늘어놓는다
  let cursor = FAN.pad
  const groups = p.jigs.map((jig, j) => {
    const shots = jig.grid.flat().filter((s): s is NonNullable<typeof s> => !!s)
    shots.sort((a, b) => leanOf(a.tilt) - leanOf(b.tilt))
    const tips = shots.map((s) => FAN.length * Math.sin((leanOf(s.tilt) * Math.PI) / 180))
    const minX = Math.min(0, ...tips.map((dx, i) => i * FAN.step + dx))
    const maxX = Math.max((shots.length - 1) * FAN.step, ...tips.map((dx, i) => i * FAN.step + dx))
    const offset = cursor - minX
    const lines = shots.map((s, i) => ({ s, x: offset + i * FAN.step }))
    const box = { left: cursor, right: cursor + (maxX - minX) }
    cursor = box.right + FAN.gap
    return { jig, j, lines, start: lines[0]?.x ?? box.left, end: lines[lines.length - 1]?.x ?? box.left, box }
  })
  const x = cursor
  const width = Math.max(x + FAN.pad, 360)
  return (
    <div className="fan-wrap">
      {/* 약이 많아도 화면 너비에 맞게 줄인다 (적으면 원래 크기) */}
      <svg viewBox={`0 0 ${width} ${FAN.height}`} width="100%" style={{ maxWidth: width }} preserveAspectRatio="xMinYMin meet" className="fan">
        <text x={width - 8} y={14} textAnchor="end" className="fan-note">
          관객석에서 본 모습 · 치구를 누르면 칸 배치
        </text>
        <line x1={FAN.pad - 8} x2={x - FAN.gap + 8} y1={FAN.base} y2={FAN.base} className="fan-ground" />
        {groups.map(({ jig, j, lines, start, end, box }) => {
          const on = j === selected
          return (
            <g key={j} className={`fan-jig ${j % 2 ? 'alt' : ''} ${on ? 'on' : ''}`} onClick={() => onSelect(j)}>
              <rect x={box.left - 6} y={4} width={box.right - box.left + 12} height={FAN.height - 8} className="fan-hit" />
              {lines.map(({ s, x: lx }, i) => {
                const rad = (leanOf(s.tilt) * Math.PI) / 180
                const cue = p.cues[s.cue]
                return (
                  <line
                    key={i}
                    x1={lx}
                    y1={FAN.base}
                    x2={lx + FAN.length * Math.sin(rad)}
                    y2={FAN.base - FAN.length * Math.cos(rad)}
                    className={`fan-tube ${field.has(s.cue) ? 'field' : ''} ${cue.estimated ? 'estimated' : ''}`}
                  >
                    <title>{`${cue.address} ${leanLabel(s.tilt)}${cue.estimated ? ' (추정)' : ''}\n${cue.effect}`}</title>
                  </line>
                )
              })}
              <path d={`M${start - 4},${FAN.base + 8} v6 H${end + 4} v-6`} className="fan-bracket" />
              <text x={(start + end) / 2} y={FAN.base + 30} textAnchor="middle" className="fan-label">
                치구 {j + 1}
              </text>
              <text x={(start + end) / 2} y={FAN.base + 45} textAnchor="middle" className="fan-sub">
                {`모듈 ${jig.modules.join('·')}`}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 치구 한 개의 칸 배치표: 줄 × 칸, 칸마다 핀 주소와 현장 각도 표기 */
function JigTable({ position: p, jig, index }: { position: JigPosition; jig: JigPosition['jigs'][number]; index: number }) {
  const field = new Set(p.fieldWiring)
  const cols = jig.grid[0]?.length ?? 5
  return (
    <div className="jig-table-wrap">
      <div className="jig-title">
        치구 {index + 1} · 모듈 {jig.modules.join(', ')} · {jig.shells}발
        {jig.home.length < jig.modules.length && <span className="hint"> · 미리 결선: {jig.home.join(', ') || '없음'} (나머지는 현장 결선)</span>}
      </div>
      <table className="jig-table">
        <thead>
          <tr>
            <th />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c}>{c + 1}칸</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jig.grid.map((lane, r) => (
            <tr key={r}>
              <th>{r + 1}줄</th>
              {lane.map((slot, c) => {
                if (!slot) return <td key={c} className="empty" />
                const cue = p.cues[slot.cue]
                return (
                  <td
                    key={c}
                    className={`${field.has(slot.cue) ? 'field' : ''} ${cue.estimated ? 'estimated' : ''}`}
                    title={`${cue.effect}\n${cue.time} · TILT ${slot.tilt}${cue.tilts.length > 1 ? `\n직렬 ${slot.shot}/${cue.tilts.length}발 (같은 핀)` : ''}`}
                  >
                    <div className="addr mono">
                      {cue.address}
                      {cue.tilts.length > 1 && <span className="series"> 직렬{slot.shot}</span>}
                    </div>
                    <div className="lean">
                      {leanLabel(slot.tilt)}
                      {cue.estimated ? '?' : ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">
        관객석에서 본 칸 배치 · <b>M1-3</b> = 이 위치의 1번째 모듈 3번 핀 (실제 주소는 ②에서 이 순서대로 붙음) · 각도는 수직 기준(↖ 왼쪽으로 눕힘 / ↑ 수직 /
        ↗ 오른쪽) · 칸에 마우스를 올리면 효과 · <span className="swatch" style={{ background: 'var(--warn-soft)' }} />
        추정 각도 · <span className="swatch" style={{ background: '#fde2d3' }} />
        현장 결선
      </div>
    </div>
  )
}

function IssueLine({ issue }: { issue: Issue }) {
  if (!issue.details?.length) return <div className={`issue ${issue.severity}`}>{issue.message}</div>
  return (
    <details className={`issue ${issue.severity}`}>
      <summary>
        {issue.message}
        {issue.count && issue.count > 1 ? ` (${issue.count})` : ''}
      </summary>
      <div className="detail">{issue.details.join(', ')}</div>
    </details>
  )
}

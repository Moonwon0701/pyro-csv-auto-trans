import { useState } from 'react'
import { CATEGORIES, CATEGORY_PREFIX, EXCLUDE, type PositionRule, type Resolution } from '@engine/types'
import type { RulesState } from '../../main/rules-store'

interface Props {
  rules: RulesState
  onRulesChanged: (s: RulesState) => void
}

const RESOLUTIONS: Resolution[] = [...CATEGORIES, EXCLUDE]
const prefixOf = (pattern: string) => pattern.trim().replace(/-?\*$/, '').toUpperCase()
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

const SOURCE_LABEL = { remote: 'GitHub 최신', cache: '마지막으로 받은 사본', bundled: '프로그램 기본값' }

export default function RulesView({ rules, onRulesChanged }: Props) {
  const [newPrefix, setNewPrefix] = useState('')
  const [newCat, setNewCat] = useState<Resolution>('타상')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const sharedPrefixes = new Set(rules.shared.positionRules.map((r) => prefixOf(r.pattern)))
  const localPrefixes = new Set(rules.local.positionRules.map((r) => prefixOf(r.pattern)))
  const rows = [...rules.effective.positionRules].sort(
    (a, b) =>
      CATEGORIES.indexOf(a.category as never) - CATEGORIES.indexOf(b.category as never) ||
      naturalCompare(a.pattern, b.pattern)
  )

  async function saveLocal(positionRules: PositionRule[]) {
    onRulesChanged(await window.api.saveLocalRules({ ...rules.local, positionRules }))
  }

  /** 해당 prefix의 내 PC Rule을 새 값으로 덮어쓴다 */
  function upsert(rule: PositionRule) {
    const p = prefixOf(rule.pattern)
    const others = rules.local.positionRules.filter((r) => prefixOf(r.pattern) !== p)
    return saveLocal([...others, { ...rule, source: 'user', created_at: rule.created_at ?? new Date().toISOString() }])
  }

  function removeLocal(pattern: string) {
    const p = prefixOf(pattern)
    return saveLocal(rules.local.positionRules.filter((r) => prefixOf(r.pattern) !== p))
  }

  async function add() {
    const p = newPrefix.trim().toUpperCase().replace(/-?\*?$/, '')
    if (!p) return
    await upsert({
      pattern: `${p}-*`,
      category: newCat,
      output_prefix: newCat === EXCLUDE ? '' : CATEGORY_PREFIX[newCat],
      active: true,
      source: 'user'
    })
    setNewPrefix('')
    setMsg(`${p}-* 를 ${newCat}(으)로 추가했습니다.`)
  }

  async function refresh() {
    setBusy(true)
    const s = await window.api.refreshRules()
    onRulesChanged(s)
    setMsg(s.fetchError ? `GitHub에서 받지 못했습니다: ${s.fetchError}` : 'GitHub에서 최신 공용 Rule을 받았습니다.')
    setBusy(false)
  }

  async function share() {
    setBusy(true)
    try {
      const r = await window.api.shareRules()
      onRulesChanged(r.state)
      setMsg(
        r.count === 0
          ? '내 PC Rule이 모두 이미 공용 Rule에 들어 있어서 올릴 것이 없습니다.'
          : r.pasteNeeded
            ? `Rule ${r.count}개 요청 페이지를 열었습니다. 내용이 길어서 클립보드에 복사해 두었으니 본문에 붙여넣고 Submit을 누르세요.`
            : `Rule ${r.count}개 요청 페이지를 열었습니다. GitHub에 로그인한 뒤 Submit을 누르면 반영됩니다.`
      )
    } catch (e) {
      setMsg(`올리지 못했습니다: ${(e as Error).message ?? e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rules-page">
      <div className="card">
        <h3>
          POS Prefix Rule <span className="count">{rows.length}</span>
        </h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>카테고리</th>
              <th>변환</th>
              <th>출처</th>
              <th>사용</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = prefixOf(r.pattern)
              const isLocal = localPrefixes.has(p)
              const inShared = sharedPrefixes.has(p)
              return (
                <tr key={r.pattern} className={r.active ? '' : 'inactive'}>
                  <td className="mono">{r.pattern}</td>
                  <td>
                    <select
                      value={r.category}
                      onChange={(e) => {
                        const cat = e.target.value as Resolution
                        upsert({ ...r, category: cat, output_prefix: cat === EXCLUDE ? '' : CATEGORY_PREFIX[cat] })
                      }}
                    >
                      {RESOLUTIONS.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="mono">{r.category === EXCLUDE ? '—' : `${r.output_prefix || CATEGORY_PREFIX[r.category as never]}-*`}</td>
                  <td>
                    <span className={`src ${isLocal ? 'user' : ''}`}>{isLocal ? (inShared ? '내 PC (공용 수정)' : '내 PC') : '공용'}</span>
                  </td>
                  <td>
                    <input className="toggle" type="checkbox" checked={r.active} onChange={(e) => upsert({ ...r, active: e.target.checked })} />
                  </td>
                  <td>
                    {isLocal && (
                      <button className="btn small" onClick={() => removeLocal(r.pattern)}>
                        {inShared ? '공용으로 되돌리기' : '삭제'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card">
          <h3>Rule 추가</h3>
          <div className="row">
            <input
              className="input mono"
              style={{ width: 110 }}
              placeholder="예: FX"
              value={newPrefix}
              onChange={(e) => setNewPrefix(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <span className="mono">-*</span>
            <select className="input" value={newCat} onChange={(e) => setNewCat(e.target.value as Resolution)}>
              {RESOLUTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className="btn primary" onClick={add} disabled={!newPrefix.trim()}>
              추가
            </button>
          </div>
          <p className="hint">위치번호(01, 12…)는 자동으로 유지되므로 Prefix만 등록하면 됩니다.</p>
        </div>

        <div className="card">
          <h3>공용 Rule (GitHub)</h3>
          <dl className="stats">
            <dt>현재 사용 중</dt>
            <dd>{SOURCE_LABEL[rules.sharedSource]}</dd>
            <dt>받은 시각</dt>
            <dd>{rules.sharedFetchedAt ? new Date(rules.sharedFetchedAt).toLocaleString() : '—'}</dd>
            <dt>내 PC Rule</dt>
            <dd>{rules.local.positionRules.length}개</dd>
          </dl>
          {rules.fetchError && <p className="hint" style={{ color: 'var(--warn)' }}>오프라인이거나 받을 수 없음: {rules.fetchError}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={refresh} disabled={busy}>
              최신 공용 Rule 받기
            </button>
            <button className="btn" onClick={share} disabled={busy || rules.local.positionRules.length + rules.local.typeRules.length === 0}>
              공용 Rule로 올리기
            </button>
          </div>
          <p className="hint">
            "공용 Rule로 올리기"를 누르면 공용과 다른 내 PC Rule이 채워진 GitHub 요청 페이지가 열립니다. GitHub 계정으로 로그인해 Submit하면
            자동으로 공용 Rule에 합쳐지고(처음 요청하는 사람은 관리자 확인 후), 다른 PC는 앱을 다시 켜거나 "최신 공용 Rule 받기"로 받습니다.
          </p>
        </div>

        <div className="card">
          <h3>TYPE 보조 분류</h3>
          <table className="grid">
            <tbody>
              {rules.effective.typeRules.map((t) => (
                <tr key={t.type}>
                  <td className="mono">{t.type}</td>
                  <td>
                    <span className={`cat ${t.category}`}>{t.category}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">POS가 비었거나 형식을 알 수 없을 때만 사용합니다. 미등록 Prefix는 TYPE으로 자동 분류하지 않습니다.</p>
        </div>

        {msg && <div className="ok-line">{msg}</div>}
      </div>
    </div>
  )
}

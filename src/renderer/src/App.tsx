import { useCallback, useEffect, useState } from 'react'
import type { RulesState } from '../../main/rules-store'
import type { UpdateStatus } from '../../main/updates'
import ConvertView from './ConvertView'
import RulesView from './RulesView'

type Tab = 'convert' | 'rules'

export default function App() {
  const [tab, setTab] = useState<Tab>(location.hash === '#rules' ? 'rules' : 'convert')
  const [rules, setRules] = useState<RulesState | null>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  /** Rule이 바뀔 때마다 증가시켜 변환 화면이 다시 계산하도록 한다 */
  const [rulesRev, setRulesRev] = useState(0)

  useEffect(() => {
    window.api.getRules().then(setRules)
    window.api.appInfo().then((i) => setVersion(i.version))
    window.api.onUpdate(setUpdate)
  }, [])

  const onRulesChanged = useCallback((s: RulesState) => {
    setRules(s)
    setRulesRev((r) => r + 1)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✦</span>불꽃쇼 CSV 자동 정리
        </div>
        <nav className="tabs">
          <button className={`tab ${tab === 'convert' ? 'active' : ''}`} onClick={() => setTab('convert')}>
            변환
          </button>
          <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
            Rule 관리
          </button>
        </nav>
        <div className="spacer" />
        <span className="version">v{version}</span>
      </header>

      {update?.kind === 'downloaded' && (
        <div className="banner">
          새 버전 {update.version}이 준비됐습니다.
          <button className="btn small" onClick={() => window.api.installUpdate()}>
            지금 재시작해서 적용
          </button>
        </div>
      )}
      {update?.kind === 'available' && (
        <div className="banner">
          새 버전 {update.version}이 나왔습니다.
          <button className="btn small" onClick={() => window.api.openExternal(update.url)}>
            다운로드 페이지 열기
          </button>
        </div>
      )}

      <main className="content">
        <div style={{ display: tab === 'convert' ? 'contents' : 'none' }}>
          <ConvertView rules={rules} rulesRev={rulesRev} onRulesChanged={onRulesChanged} />
        </div>
        {tab === 'rules' && rules && <RulesView rules={rules} onRulesChanged={onRulesChanged} />}
      </main>
    </div>
  )
}

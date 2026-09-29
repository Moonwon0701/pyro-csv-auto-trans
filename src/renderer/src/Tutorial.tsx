import { useState, type ReactNode } from 'react'

const SEEN_KEY = 'pyro.tutorialSeen'

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* 저장 못 해도 다음에 다시 보일 뿐 */
  }
}

interface Slide {
  title: string
  body: ReactNode
}

const SLIDES: Slide[] = [
  {
    title: '불꽃쇼 CSV 자동 정리',
    body: (
      <>
        <p>디자인 프로그램에서 뽑은 CSV를 현장에서 쓰는 Excel로 바꿔주는 프로그램입니다. 두 단계로 진행돼요.</p>
        <div className="flow">
          <div className="flow-box">
            원본 CSV
            <small>주소 없음</small>
          </div>
          <div className="flow-arrow">
            ① 주소 매기기
            <span>→</span>
          </div>
          <div className="flow-box">
            주소 매긴 CSV
            <small>ADDR 채움</small>
          </div>
          <div className="flow-arrow">
            ② 시트 정리
            <span>→</span>
          </div>
          <div className="flow-box accent">
            현장용 Excel
            <small>타상 / 연발 / 단발</small>
          </div>
        </div>
        <p className="hint">이미 주소가 매겨진 CSV라면 ②부터 바로 시작하면 됩니다.</p>
      </>
    )
  },
  {
    title: '① 주소 매기기',
    body: (
      <ol className="steps">
        <li>
          ADDR이 비어 있는 원본 CSV를 창에 <b>끌어다 놓습니다</b>.
        </li>
        <li>
          위치(POS)마다 FM-A 주소 범위가 <b>자동으로 제안</b>됩니다. 위치마다 새 모듈에서 시작하고, 주소는 절대 겹치지 않아요.
        </li>
        <li>
          원하면 표에서 범위를 직접 고칩니다. 예: <span className="mono">310</span>, <span className="mono">310-33F</span>
        </li>
        <li>
          <b>주소 CSV 저장</b>으로 파일을 남기거나, <b>바로 시트 정리 →</b>로 ②로 넘어갑니다.
        </li>
      </ol>
    )
  },
  {
    title: '② 시트 정리',
    body: (
      <>
        <ol className="steps">
          <li>
            CSV를 넣으면 Control, 주소 방식, 분류 결과가 <b>왼쪽</b>에 나오고, 결과 시트가 <b>오른쪽</b>에 미리 보입니다.
          </li>
          <li>
            처음 보는 POS(예: <span className="mono">FX-01</span>)가 있으면 <b>빨간 상자</b>에서 타상/연발/단발을 골라야 합니다.
          </li>
          <li>
            <b>검증 결과</b>의 경고를 확인하고 <b>Excel 생성</b>을 누르면 끝!
          </li>
        </ol>
        <div className="legend">
          <span>
            <i className="swatch" style={{ background: 'var(--conflict)' }} /> 같은 위치에 주소가 여러 개 (모두 보존)
          </span>
          <span>
            <i className="swatch" style={{ background: 'var(--missing)' }} /> 주소없음
          </span>
        </div>
      </>
    )
  },
  {
    title: 'Rule 관리',
    body: (
      <ol className="steps">
        <li>
          POS 앞부분(Prefix)을 어느 분류로 볼지 정한 규칙입니다. 예: <span className="mono">CF-* → 연발</span>
        </li>
        <li>위치번호(01, 12…)는 자동으로 유지되므로 Prefix만 등록하면 됩니다.</li>
        <li>
          새로 등록한 Rule은 이 PC에 저장되고, <b>공용 Rule로 올리기</b>로 다른 디자이너와 공유할 수 있어요. (GitHub 계정 필요)
        </li>
      </ol>
    )
  },
  {
    title: '샘플로 직접 해볼까요?',
    body: (
      <>
        <p>
          가상의 샘플 CSV(60행)로 <b>주소 매기기 → 시트 정리 → Excel 생성</b>까지 따라해 볼 수 있어요. 단계마다 화면 위에 다음에 할 일이
          표시됩니다.
        </p>
        <p className="hint">튜토리얼 중에는 Rule이 저장되지 않습니다. 오른쪽 위 “사용법” 버튼으로 언제든 이 안내를 다시 볼 수 있어요.</p>
      </>
    )
  }
]

export function TutorialModal({ onClose, onStartSample }: { onClose: () => void; onStartSample: () => void }) {
  const [i, setI] = useState(0)
  const last = i === SLIDES.length - 1
  const close = () => {
    markSeen()
    onClose()
  }
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="닫기">
          ×
        </button>
        <div className="modal-step">
          {i + 1} / {SLIDES.length}
        </div>
        <h2>{SLIDES[i].title}</h2>
        <div className="modal-body">{SLIDES[i].body}</div>
        <div className="modal-foot">
          <div className="dots">
            {SLIDES.map((_, n) => (
              <button key={n} className={`dot ${n === i ? 'on' : ''}`} onClick={() => setI(n)} aria-label={`${n + 1}번째`} />
            ))}
          </div>
          <div className="spacer" />
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              이전
            </button>
          )}
          {!last && (
            <button className="btn primary" onClick={() => setI(i + 1)}>
              다음
            </button>
          )}
          {last && (
            <>
              <button className="btn" onClick={close}>
                바로 시작하기
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  markSeen()
                  onStartSample()
                }}
              >
                샘플로 따라하기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 튜토리얼 진행 중 화면 위에 보이는 안내 띠 */
export function TutorialBanner({ step, children, onExit }: { step: string; children: ReactNode; onExit: () => void }) {
  return (
    <div className="tutorial-banner">
      <span className="tutorial-tag">튜토리얼 {step}</span>
      <div className="tutorial-text">{children}</div>
      <button className="btn small" onClick={onExit}>
        튜토리얼 끝내기
      </button>
    </div>
  )
}

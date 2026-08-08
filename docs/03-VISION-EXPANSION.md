# Vision — 확장 경로 (Non-normative)

> **이 문서는 architecture freeze 대상이 아니다.** 어떤 스프린트 범위도 이 문서를 근거로 확장할 수 없다. 유일한 규범적 효력은 §4의 "문 열어두기" 체크리스트뿐이다.
>
> 출처: 2026-08 founder ↔ GPT 대화 + Claude 평가. v0.6 로드맵과의 중복은 명시적으로 표기.

## §1. 확장 6단계

| 단계                        | 내용                                                                | v0.6과의 관계                                          |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Founder OS               | 연결 → 오늘 봐야 할 것 (MVP)                                        | = v0.6 Phase 0~1                                       |
| 2. AI COO                   | Monitor → Recommend → Prepare → Execute                             | = autonomy level 0~4 (§16) — 이미 설계됨               |
| 3. AI Workforce             | 역할별 agent 확장. 차별점: **같은 Company Graph/State 공유**        | = Phase 2 agents. governance layer가 우리 OS           |
| 4. Company App Store        | Pack 설치 (agents + connectors + policies + benchmarks + workflows) | = v0.6 Phase 3 Company Packs                           |
| 5. Company-in-a-Box         | 회사 유형 선택 → 운영 인프라 자동 구성                              | = Company Template. "Start a company. Install the OS." |
| 6. Autonomous Company Infra | 사람 3명 + agent 20~50개. 사람은 목표·자본배분·핵심 결정·관계       | 장기 비전                                              |

## §2. 신규 확장 축 3개 (v0.6에 없던 것)

### 2.1 B2B Agent Network

회사 A의 OS ↔ 회사 B의 OS가 agent-to-agent로 재고·가격·계약조건·invoice를 협상하고 사람은 최종 승인만. 현재 원칙과의 관계: **zero cross-tenant 격리의 완화가 아니라, 명시적 policy가 걸린 별도 채널**로 설계될 것. 기존 agent identity + policy + approval + audit가 그대로 그 채널의 governance 기반.

### 2.2 Financial Layer

Graph에 쌓이는 revenue/payment/contract/churn 이력 → 회사 건강상태의 실시간 파악 → working capital, invoice financing, insurance, corporate card. Stripe의 payments→financial infra 경로와 유사. **유보**: 규제·라이선스 영역 + 운영 데이터의 underwriting 사용은 신뢰 포지셔닝 이슈. 지금의 함의는 "audit/evidence 규율을 은행 수준으로" — 이미 하는 일의 정당화.

### 2.3 AI Agent Governance Platform (IAM for non-human identity)

Agent가 많아질수록 "이 AI가 어디에 접근 가능한가"가 새 IAM 문제. 우리 Policy/Audit/Approval/Agent Identity 레이어 자체가 별도 제품이 될 수 있음. 함의: policy/audit 모듈의 깨끗한 분리 유지 (이미 설계 원칙).

## §3. 사업 규모 사다리

Founder Monitoring SaaS → AI Operations SaaS → AI COO → AI Workforce OS → Company Platform → Company App Store → B2B Agent Network → Financial/Governance Infra → **Operating Infrastructure for AI-native companies**

## §4. 문 열어두기 체크리스트 (유일한 규범 조항)

지금 비용이 0이고 나중에 비용이 큰 것만 지킨다. 이 이상의 선행 구축 금지:

1. agent/policy/benchmark/workflow는 **코드가 아니라 DB 데이터** (pack 설치 = seed 데이터) — 현 스키마 충족
2. 모든 행위 기록에 actor의 agent identity + 소속 tenant 명시 — 현 audit 스키마 충족
3. policy/audit 모듈은 다른 레이어와 import 경계 분리 유지
4. cross-tenant 상호작용은 "존재하지 않음"이 기본값, 미래에 열더라도 명시적 policied 채널로만
5. harness 전 구성요소 버전 태깅 (Lab-ready 데이터 규율) — v0.6 ADR-012 그대로

## §5. 전략 원칙 (원문 유지)

> 처음부터 이 모든 걸 만들면 안 됩니다. Architecture만 확장 가능하게 만들어 놓고, 첫 제품은 극도로 단순해야 합니다. "Stripe + GitHub + Sentry + Slack + Linear를 연결하면, 내가 오늘 회사에서 무엇을 봐야 하는지 AI가 알려준다." **여기서 돈을 받는 것부터 시작해야 합니다.**

---

## §5. 제품 정의 4축 (2026-08-08 추가, non-normative)

출처: founder ↔ GPT 대화 + Fable 평가. **이 절은 마일스톤을 바꾸지 않는다** — M3c 순서는 그대로다.

| 축          | 내용                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| **CONNECT** | API/OAuth/webhook/MCP를 몰라도 클릭으로 연결. MCP는 제품이 아니라 배관 |
| **START**   | 운영 경험 없는 창업자에게 Recommended Setup(preset) 제공               |
| **OPERATE** | 연결로 끝나지 않고 실제 운영을 대행 (report → propose → execute)       |
| **SCALE**   | Startup → Growth → Scale → Enterprise, OS 설정이 함께 고도화           |

내부 정의 문장 (Owner 확정 대기 — positioning은 Owner 결정):

> 회사를 만들 때 **운영체계를 처음부터 발명하지 않아도 되는** 제품.

### 5.1 제품 ≠ moat (중요)

4축은 **제품**이지 **moat가 아니다.** 이를 뭉개면 복제 가능한 부분에 희소한 시간을 쓰게 된다.

- CONNECT — moat 아님. Merge/Zapier/Nango가 이미 존재
- START(preset) — 설계만으로는 moat 아님. 경쟁자가 주말이면 복제
- SCALE(티어) — 패키징
- **moat는 여전히** Company Graph / State / evidence·provenance / company memory / **어떤 운영이 실제로 도움이 되었는지의 축적 데이터**

preset이 moat가 되는 경로는 **2차 효과**다: cross-customer outcome data에서 파생될 때
("당신과 비슷한 회사들이 X를 켜서 Y를 더 일찍 잡았다"). 즉 고객이 먼저 있어야 한다.
지금은 preset을 **차별화 기능**으로 다루되 moat로 계산하지 않는다.

### 5.2 preset의 load-bearing 가정과 검증 경로

"best-practice를 preset으로 만든다"는 **우리가 best practice를 안다**고 가정한다. 지금은 모른다
(운영자 경험 미인코딩, dogfood 데이터 없음, 고객 0). **틀린 preset은 preset 없음보다 나쁘다** —
창업자가 신뢰하고 잘못된 운영을 자동화하기 때문.

검증 경로가 이미 있다: **M3c의 planted-signal 랩이 preset 품질을 측정하는 기계다.**
"이 preset의 monitor 세트가 심은 신호를 잡는가"를 채점할 수 있다. preset은 먼 미래 기능이 아니라
M3c가 검증 도구를 먼저 주는 항목이다.

### 5.3 자율성 티어는 설정이 아니라 측정된 정밀도로 해금 (제안)

"회사가 커지면 자동 실행"이 아니라 **"측정된 추천 정밀도가 임계를 넘으면"** 올라가야 한다.
현재 risk-1 액션 1종에 추천 품질 증거는 0이다. 티어 승급 조건도 M3c 랩으로 측정한다.

### 5.4 Company-in-a-Box: 추천은 찬성, provisioning은 반대

§1 5단계(Company-in-a-Box)에서 **툴 추천**과 **툴 프로비저닝**을 분리한다.

- ✅ **추천**: "B2B SaaS는 보통 Stripe+Linear+Sentry를 씁니다" + deep link — 싸고 안전
- ❌ **프로비저닝**(계정 생성·구성 대행): billing 관계·계정 소유·자격증명 보유가 우리에게 옴.
  신뢰/책임 표면이 폭증하고, 마진이 낮으며 파트너 의존적이고, **moat 기여가 0이다**
  (moat는 graph/state/evidence이지 리셀링이 아니다). 읽기 중심 intelligence 레이어에서
  프로비저너로 성격이 바뀌는 것은 되돌리기 어렵다.

### 5.5 Local/Private LLM — 아키텍처는 이미 준비됨

`packages/llm`은 논리 profile(FAST/BALANCED/REASONING)만 노출하고 provider 모델명·단가는
`providers.ts`의 `routingFromEnv` 한 곳에만 존재한다 (D-010). PRIVATE/LOCAL profile 추가는
비즈니스 코드 변경 0으로 가능하다. **MVP에서 로컬 LLM 운영 기능을 만드는 것은 반대**이며,
사용자에게 Ollama/vLLM을 학습시키는 순간 실패다. 사용자 표면은 `Standard / Private / On-premise`까지.

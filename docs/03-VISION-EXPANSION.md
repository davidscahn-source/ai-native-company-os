# Vision — 확장 경로 (Non-normative)

> **이 문서는 architecture freeze 대상이 아니다.** 어떤 스프린트 범위도 이 문서를 근거로 확장할 수 없다. 유일한 규범적 효력은 §4의 "문 열어두기" 체크리스트뿐이다.
>
> 출처: 2026-08 founder ↔ GPT 대화 + Claude 평가. v0.6 로드맵과의 중복은 명시적으로 표기.

## §1. 확장 6단계

| 단계 | 내용 | v0.6과의 관계 |
|---|---|---|
| 1. Founder OS | 연결 → 오늘 봐야 할 것 (MVP) | = v0.6 Phase 0~1 |
| 2. AI COO | Monitor → Recommend → Prepare → Execute | = autonomy level 0~4 (§16) — 이미 설계됨 |
| 3. AI Workforce | 역할별 agent 확장. 차별점: **같은 Company Graph/State 공유** | = Phase 2 agents. governance layer가 우리 OS |
| 4. Company App Store | Pack 설치 (agents + connectors + policies + benchmarks + workflows) | = v0.6 Phase 3 Company Packs |
| 5. Company-in-a-Box | 회사 유형 선택 → 운영 인프라 자동 구성 | = Company Template. "Start a company. Install the OS." |
| 6. Autonomous Company Infra | 사람 3명 + agent 20~50개. 사람은 목표·자본배분·핵심 결정·관계 | 장기 비전 |

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

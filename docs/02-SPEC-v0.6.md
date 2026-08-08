# AI NATIVE COMPANY OS — 통합 상세 기획서 v0.6

|               |                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Category**  | AI-Native Company Operating System                                                                                             |
| **Promise**   | Connect your company. AI operates the rest.                                                                                    |
| **Long-term** | Start a company. Install the operating system.                                                                                 |
| **문서 상태** | v0.5 Master Spec + Concept v0.1 + 개발기획서 v0.1을 **적대적 검증(2026-08-08 리서치 4건)** 을 거쳐 단일 문서로 통합·업그레이드 |
| **작성일**    | 2026-08-08                                                                                                                     |

---

## 목차

- **PART 0 — 검증 결과 요약** (§0. 무엇이 반박되고 무엇이 살아남았나)
- **PART 1 — 제품과 시장** (§1~7)
- **PART 2 — 제품 상세 설계** (§8~17)
- **PART 3 — 기술 아키텍처** (§18~27)
- **PART 4 — 사업성** (§28~29)
- **PART 5 — ADR 12개 재검토 결과** (§30)
- **PART 6 — 로드맵과 스프린트** (§31~33)
- **PART 7 — 수용 기준과 오픈 이슈** (§34~35)
- **부록 — 리서치 출처** (§36)

---

# PART 0 — 적대적 검증 결과 요약

## §0. 무엇이 반박되고, 무엇이 살아남았나

이 문서의 모든 기술 선택은 2026-08-08에 수행한 독립 리서치 4건(커넥터 인프라 / workflow runtime / LLM gateway / Gmail 규제 + 연구 문헌 검증)으로 공격받았다. 결과:

### 반박되어 수정된 것

| #   | 기존 주장                                                                             | 검증 결과                                                                                                                                                                                                                 | v0.6 반영                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "커넥터당 며칠이면 구현" (5종 공통)                                                   | **Gmail만 반박.** webhook 없음(Pub/Sub watch + 7일 갱신), `gmail.readonly`는 restricted scope → 연례 CASA Tier 2 심사($540~$4,500/년, 최초 1~3개월). 미들웨어를 껴도 우리 서버에 메일 저장 시 면제 불가                   | Gmail을 MVP 5종에서 분리, **별도 트랙 G**로. MVP 5종은 Stripe/GitHub/Slack/Sentry/**Linear** (§21)                                                 |
| 2   | Concept v0.1: "Composio/Pipedream을 underneath infrastructure로"                      | **반박.** Pipedream은 2025-11 Workday 인수 합의(존속 리스크), Composio는 $25M Series A 후 agent-skills 방향 피벗 — 둘 다 tenant 데이터 sync 인프라가 아님. Nango는 ELv2 라이선스, self-host 무료판은 production sync 제외 | ADR-001 "직접 구현" 유지, 근거 강화 (§30)                                                                                                          |
| 3   | Concept v0.1: "LiteLLM을 쓰면 된다"                                                   | **부분 반박.** LiteLLM proxy는 운영 부담 실증(메모리 누수 → 주기 재시작, 오픈 이슈 1,000+, 프로덕션 TCO 월 $2~3.5k). 2-프로바이더 규모엔 thin 자체 계층이 2026 build-vs-buy 컨센서스                                      | ADR-003 유지. 단 exit 경로를 "LiteLLM **SDK**(proxy 아님) 또는 Vercel/Cloudflare AI Gateway(무마진 pass-through)"로 갱신 (§24, §30)                |
| 4   | 개발기획서: 커넥터 5개 개별 구현                                                      | **수정.** 진짜 공수는 개별 로직이 아니라 공통 부분(서명 검증, dedup, cursor/backfill, 재시도)                                                                                                                             | **공용 Sync Harness를 1급 컴포넌트로 승격** — 한 번 만들어 5종이 공유 (§21.1)                                                                      |
| 5   | Concept v0.1의 $49/mo 가격                                                            | **의문 제기.** 무최적화 LLM COGS가 tenant당 월 $25~45로 추산됨 — $49 요금제는 마진이 없다                                                                                                                                 | 단위 경제성 섹션 신설, 최적화 로드맵 + 가격 가설 수정 (§28~29)                                                                                     |
| 6   | 내(Claude) 이전 발언: "SIA/Self-Harness/HarnessOpt-Bench/Harness-Bench는 실존 미확인" | **내 주장이 반박됨.** 4개 전부 실존하는 2026년 arXiv 논문으로 확인 (지식 컷오프 이후 발표)                                                                                                                                | 정정. Improvement Lab 설계(§17)가 Self-Harness의 Weakness Mining→Proposal→Validation 루프와 구조 일치 — 설계 타당성 근거로 인용 (§30 ADR-012, §36) |

### 공격받았지만 살아남은 것 (근거 보강)

| #   | 결정                                                                  | 살아남은 이유                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **MVP 커넥터 직접 구현**                                              | 4종(Stripe/GitHub/Slack/Sentry)은 1급 API로 "며칠" 추정 확인. raw payload + webhook 제어 + credential 자체 보관이 graph 품질의 전제. 경쟁 인프라는 인수/피벗 리스크까지 확인됨                                                                                                                                                          |
| 2   | **Inngest (durable workflow)**                                        | 승인 대기 `waitForEvent`(최대 1년), sleep(무료 7일/Pro 1년), self-host 탈출구 전부 확인. Temporal은 월 $100 최저가 + 최고 학습 곡선으로 "1~2인 팀에 과함" 확인. **새 조건 2개**: payload에 ref만 담기(+암호화 미들웨어), step 단위 과금 모니터링. Trigger.dev v4가 근소한 2위로 벤치마크 후보 교체 (Restate는 seed-stage 리스크로 제외) |
| 3   | **자체 thin LLM gateway**                                             | "라우팅 로직=우리 IP, 호출 계층=commodity" 구분이 2026 컨센서스와 일치. **새 조건**: 1일차부터 요청당 tenant×비용×지연 이벤트 방출 — 이걸 미루면 후회한다는 것이 공통 교훈                                                                                                                                                              |
| 4   | **Postgres 기반 graph/vector/auth/secret/compute 선택 (ADR-007~011)** | 이번 리서치 범위에서 반박 근거 미발견. 기존 근거 유지                                                                                                                                                                                                                                                                                   |

---

# PART 1 — 제품과 시장

## §1. Product Mission

소규모 창업자가 제품을 만드는 것은 점점 쉬워지고 있다. 하지만 회사를 운영하려면 여전히 CRM, Support, Billing, Subscription, Contracts, Product/Bug 관리, Infra 모니터링, Incident, Finance, Email, 내부 커뮤니케이션, Analytics, Access Control, Notifications, Automation이 필요하다.

**AI Native Company OS는 이 제품들을 대체하지 않는다.** 기존 시스템을 연결하고 그 위에 AI Company Control Plane을 만든다.

핵심 operating loop:

> **Observe → Understand → Decide → Act → Verify → Learn**

사용자가 이해해야 하는 개념은 단 두 가지다:

> **Connect my company** / **Ask my company**

## §2. 왜 지금인가

시장은 이미 이 방향으로 움직이고 있다. Pipedream(3,000+ API), Composio(20,000+ agent tools), n8n(AI agent + MCP + 1,000+ integrations), Relevance AI(AI Workforce). **시장 검증은 끝났다.**

하지만 그들 모두의 중심 개념은 "Agent를 만들어라 / Workflow를 만들어라"이다. 우리는 반대로 간다:

> **"회사를 연결하세요. 나머지는 OS가 이해합니다."**

## §3. 경쟁 구도 (2026-08 검증 반영)

| 경쟁자       | 정체                      | 왜 우리와 다른가                                                                         | 검증에서 나온 사실                                               |
| ------------ | ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| n8n          | Workflow builder          | 사용자가 무엇을 자동화할지 알아야 함. 우리는 사용자에게 workflow builder를 노출하지 않음 | 사용자 대면 빌더 — 내부 durable execution 용도 아님              |
| Pipedream    | Integration infra         | Business OS 아님                                                                         | **2025-11 Workday 인수 합의** — 독립 인프라로서의 미래 불확실    |
| Composio     | Agent tool-calling 플랫폼 | 데이터 sync 프레임워크 없음(backfill/cursor/dedup 부재)                                  | $25M Series A 후 "agent skills"로 피벗 — 우리 요구에서 더 멀어짐 |
| Relevance AI | AI Workforce              | "Build your workforce" vs 우리의 "Connect your company"                                  | —                                                                |
| Merge.dev    | Unified API               | 카테고리 불일치(HRIS/ATS 중심), Stripe/Gmail/Slack/Sentry 미지원                         | 카탈로그 확인                                                    |

**포지셔닝 문장: "Build your AI workforce"가 아니라 "Connect your company."**

## §4. 차별점 — Workflow가 아니라 Company Graph

제품의 중심을 workflow가 아니라 **Company Graph**로 만든다.

```
Stripe payment failed
  ↓ Customer A ↓ Annual contract $12,000 ARR
  ↓ Usage ↓28% ↓ 3 support complaints
  ↓ Bug #412 ↓ Deployment #834
→ AI: "Customer A는 단순 결제 실패가 아니라 churn risk가 높습니다."
```

이것이 단순 automation과 **Company Intelligence**의 차이다.

## §5. Market Position

직접 경쟁하지 않는 것: Zapier/n8n/Pipedream replacement, CRM/Stripe/GitHub replacement.

- **Infrastructure beneath us** (사거나 채택): Integration, Authentication, Workflow, LLM, Compute, Observability
- **IP we own** (직접 구축): Company Graph, Operations Ontology, Founder Experience, Company Memory, Operational Intelligence, Policies, Company Benchmarks, Improvement Engine

## §6. Product Moat

Connector 숫자가 아니다 (Pipedream/Composio가 더 많다). LLM도 아니다. Agent builder도 아니다 (경쟁 과밀).

> **Company Operational Graph + Historical Execution Data + Company-specific Benchmark + Operational Policies + Self-improving Harness + Founder Trust**

즉: **"어떤 모델을 쓰든, 시간이 지날수록 그 회사를 더 잘 운영하는 AI."**

단서 (v0.6 신규): Founder Trust는 자신 있게 틀린 답 한 번으로 무너진다. 그래서 §13의 "모른다" 행동과 §16의 evidence 규율이 moat의 전제 조건이다.

## §7. Initial ICP

**1~20인 AI/SaaS startup** — Stripe, GitHub, Cloud, SaaS subscription, 디지털 고객지원을 이미 쓰는 회사. 이 시장은 connector 품질이 가장 좋고, 운영 pain이 크며, AI 수용이 빠르다. 일반 중소기업 전체를 처음부터 잡으면 실패 확률이 높다.

---

# PART 2 — 제품 상세 설계

## §8. Onboarding UX

```
Step 1  Create Company
Step 2  회사 종류 선택 (AI SaaS / SaaS / E-commerce / Agency / Consulting / Marketplace / Other)
Step 3  Connect your tools  — Stripe [Connect] GitHub [Connect] Slack [Connect] Sentry [Connect] Linear [Connect] ...
Step 4  AI가 회사 구조 자동 분석 (실시간 카운트업: "Detected: 428 customers, 317 subscriptions, $84,200 MRR ...")
Step 5  Company OS 생성
```

사용자는 MCP/OAuth/webhook을 몰라도 된다. **User should never configure AI.**

## §9. Founder Command Center (Home)

첫 화면의 목적은 데이터가 아니라 **"오늘 무엇을 해야 하는가"**.

```
Good morning. Your company requires attention in 6 areas.

CRITICAL   Production API error rate +340%. Estimated affected customers: 19
REVENUE    4 failed payments. Revenue at risk: $6,420
CUSTOMER   3 high-value customers at churn risk
PRODUCT    11 customer reports potentially connected to Bug #421
CONTRACT   2 renewals within 14 days
SYSTEM     Infrastructure healthy
AI COST    $312 this month  ↓18% after routing optimization   ← v0.6 신규 (Concept v0.1 채택)
```

중앙: **Ask your company anything** — "What should I worry about today?" / "Why did churn increase?" / "What changed after yesterday's deployment?"

AI COST 카드는 신뢰 장치다: OS가 자기 비용까지 최적화하고 있음을 보여준다. 데이터원은 §24의 비용 이벤트 스트림.

## §10. The Company Graph

핵심 proprietary layer. 기본 entity (32종):

Company, User, Employee, Customer, Contact, Lead, Contract, Subscription, Invoice, Payment, Product, Feature, Usage, Ticket, Bug, Incident, Repository, Commit, PullRequest, Deployment, Service, Vendor, Expense, Task, Decision, Communication, Document, Integration, Agent, Action, Workflow, Event

관계 예: `Customer A → owns Subscription 231 → governed_by Contract 42 → paid Invoice 881 → reported Ticket 431 → affected_by Incident 88 → related_to Deployment 921 → contains PR 331 → resolves Bug 442`

## §11. Entity Resolution — 이 제품에서 가장 어려운 문제 (1급 승격)

> v0.5에서 "90%+ linking accuracy"라는 목표 한 줄이었던 것을 별도 섹션으로 승격한다. **이게 틀리면 "어떤 고객이 영향받았나"라는 핵심 답변이 전부 틀린다.**

### 11.1 매칭 계층

**결정적 매칭 (confidence 1.0) — 항상 우선:**

| 규칙                      | 예                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| provider 내부 FK          | Stripe subscription → customer (`sub.customer`)                                                     |
| 정규화된 이메일 정확 일치 | Stripe customer email = Slack 프로필 email                                                          |
| 명시적 식별자             | Sentry release = GitHub commit SHA, PR merge commit = deployment SHA, Linear issue ↔ GitHub PR 링크 |

**휴리스틱 매칭 (confidence 0.5~0.9):** 이메일 도메인 일치(0.7), 이름 fuzzy + 시간 근접(0.6), Sentry issue ↔ 이슈 제목/스택 유사도(0.65), Slack 스레드 언급 ↔ entity 이름(0.5)

**LLM 매칭 (confidence = 모델 출력, cap 0.9):** 휴리스틱이 후보 2개 이상을 낼 때만. 프롬프트에는 후보의 canonical 요약만 (원문 전체 금지 — 비용 + injection 면적).

### 11.2 알려진 지저분한 케이스 (설계 시 명시)

- 개인 gmail로 결제하고 회사 도메인으로 지원 요청하는 고객
- 한 회사(B2B 고객)에 여러 contact — Customer(회사)와 Contact(사람)를 분리하고 contact→customer는 `member_of`
- 별칭/포워딩 이메일, 이름 로마자/한글 표기 차이
- 같은 사람이 두 tenant의 고객인 경우 (절대 cross-tenant 매칭 금지 — 매칭은 tenant 내부에서만)

### 11.3 측정 방법 (분모 정의 — v0.6 신규)

- **Golden set**: 온보딩된 실제 회사에서 무작위 표본 100 링크를 사람이 채점 (correct / incorrect / ambiguous). ambiguous는 분모 제외하되 비율 자체를 리포트.
- **지표**: precision(연결된 것 중 맞는 비율)과 coverage(연결됐어야 하는 것 중 연결된 비율)를 분리 측정. §34의 "90%"는 **precision ≥ 95%, coverage ≥ 85%** 로 구체화 (오연결이 미연결보다 해롭다 — 잘못된 인과 서사를 만들기 때문).
- **주기**: Phase 1 동안 주 1회 채점, 결과는 benchmark_runs에 기록되어 resolution 로직 변경의 회귀 테스트가 됨.

### 11.4 사용자 루프

- confidence < 0.8 링크는 UI에 "추정 연결" 표시, confirm/reject 가능
- confirm → 1.0 승격 + company memory에 매칭 규칙 학습 기록
- 병합 이력(`entity_merges`) 보존, 자동 병합은 결정적 매칭에서만

## §12. Canonical Event Model

Connector 데이터를 그대로 AI에 던지지 않는다. 먼저 canonical event로 변환한다.

```typescript
type CanonicalEvent = {
  eventId: string;
  tenantId: string;
  source: "stripe" | "github" | "slack" | "sentry" | "linear" | "gmail" | "system" | "agent";
  sourceEventId: string;
  entityType: EntityType;
  entityId: string | null; // resolution 후 채움
  eventType: EventType; // 'payment.failed' 등
  occurredAt: string;
  payload: Record<string, unknown>; // 정규화된 최소 페이로드 (원본은 raw_events)
  confidence: number; // 원본 1.0, 파생 < 1.0
  sensitivity: "normal" | "sensitive" | "restricted";
  correlationId: string | null;
  traceId: string | null;
};
```

**MVP event types**: `customer.created/updated`, `payment.failed/completed`, `subscription.cancelled/updated`, `contract.expiring`, `ticket.created/escalated`, `bug.detected`, `deployment.completed/failed`, `incident.detected/resolved`, `issue.created/updated`(Linear), `communication.received`, 파생: `customer.churn_risk_detected`, `cost.spike_detected`(Phase 2)

파이프라인: `raw_events(원본 무조건 저장) → provider normalizer(순수 함수 + fixture 테스트) → entity resolution → events upsert(idempotent) → relationship 갱신 → workflow trigger 판정`

## §13. Ask — 그리고 "모른다"를 말하는 행동 (v0.6 신규)

open-ended ask는 데모에선 강력하지만, 데이터가 답할 수 없는 질문이 반드시 들어온다. **자신 있게 틀린 답 한 번이 Founder Trust를 부순다.** 따라서 다음을 스펙으로 명시한다:

### 13.1 Answerability 판정

Ask 처리의 첫 단계는 답변 가능성 분류다 (FAST profile):

| 분류                     | 조건                                     | 행동                                                                                                                      |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Answerable**           | 필요한 entity/event가 연결된 소스에 존재 | 정상 응답 (evidence 필수)                                                                                                 |
| **Partially answerable** | 일부 데이터만 존재                       | 답할 수 있는 부분 + **무엇이 없어서 어디까지인지 명시** ("Slack이 연결되지 않아 커뮤니케이션 신호는 반영되지 않았습니다") |
| **Not answerable**       | 데이터 부재 / 범위 밖                    | **모른다고 말하고 이유를 말한다.** 가능하면 연결하면 답할 수 있는 소스 제안                                               |

### 13.2 하드 가드 (프롬프트가 아니라 코드)

- 모든 FACT 주장은 evidence(event_id/entity_id)가 DB에 실재해야 저장/표시 — 불일치 시 INFERENCE로 강등
- INFERENCE는 confidence 없이 출력 불가, confidence < 0.5는 표시하지 않음 (묻으면 "신호가 약해 판단 보류"로)
- 추측성 답변에 "아마", "推定" 같은 말로 얼버무리는 것 금지 — 구조화된 3분류(FACT/INFERENCE/RECOMMENDATION)로만

### 13.3 UI

모든 주장에 FACT / INFERENCE(confidence) / RECOMMENDATION 뱃지 + evidence 링크(클릭 → 원본 event/entity). "모른다" 응답에는 [Connect Slack] 같은 해소 CTA.

## §14. Pre-built Agents

**MVP 4종** (사용자가 만들지 않는다 — 회사 생성 시 이미 설치됨):

| Agent           | Trigger                                                  | 산출물                                                                                  |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Founder**     | 매일 07:00 (tenant TZ) + user ask                        | Morning Brief — 타 agent insights를 종합 (원본 데이터를 직접 다 읽지 않음: 비용/일관성) |
| **Revenue**     | `payment.failed`, `subscription.cancelled`, 일간 스캔    | revenue risk insight, (후반) retry/dunning 제안                                         |
| **Customer**    | `ticket.escalated`, 주간 스캔                            | churn risk insight (confidence 필수)                                                    |
| **Engineering** | `incident.detected`, `deployment.failed`, `bug.detected` | incident→deployment→PR 인과 체인 + 영향 고객                                            |

Phase 2+: Support, Contract, Finance, Growth, Security, Operations.

### AgentDefinition (prompt 하나가 아니다)

```typescript
type AgentDefinition = {
  key: string;
  identity: string;
  objective: string;
  allowedTools: ToolRef[];
  prohibitedTools: ToolRef[];
  memoryPolicy: { read: MemoryScope[]; write: MemoryScope[] };
  contextPolicy: {
    maxEvents: number;
    maxEntities: number;
    lookbackDays: number;
    untrustedContentMode: "summary_only" | "quoted_block";
  };
  modelPolicy: { profile: "FAST" | "BALANCED" | "HIGH_REASONING"; maxTokensPerCall: number };
  costBudget: { perRunUsd: number; perDayUsd: number };
  latencyBudget: { perRunMs: number };
  approvalPolicy: { maxAutoRisk: 0 | 1 };
  retryPolicy: { maxRetries: number };
  escalationPolicy: { onFailure: "notify_owner" | "silent_log" };
  evaluationPolicy: { benchmarkKeys: string[] };
  version: number;
};
```

전 필드는 **코드 레벨로 강제**된다 (프롬프트 강제 아님).

## §15. Killer Workflows — 3개 (v0.6에서 4→3 조정)

Concept v0.1의 판단을 채택: Revenue Risk를 독립 workflow에서 빼고 Morning Brief의 섹션으로 흡수. 더 날카로운 3개에 집중한다.

### 15.1 Morning Founder Brief — "오늘 내가 봐야 할 것은?"

```
cron 07:00 (tenant TZ)
1. 지난 24h 이벤트 통계 집계 (SQL — LLM 아님)
2. open insights 수집 (revenue/customer/engineering agent 산출물)
3. Founder Agent 실행 → 카테고리별 우선순위화 → §9 포맷 brief
4. 저장 + 알림 (Slack DM)
하드 가드: critical 항목에 evidence 없으면 렌더 자체가 안 됨
```

### 15.2 Customer Risk — "지금 떠날 가능성이 높은 고객은?"

```
trigger: ticket.escalated | 주간 스캔
1. 고가치 고객(MRR 상위) × 신호 (지원 빈도↑, 결제 문제, 부정적 커뮤니케이션)
2. Customer Agent → churn_risk insight (confidence 필수)
3. confidence ≥ 0.7 → customer.churn_risk_detected 파생 이벤트
4. recommendation: 대응 draft (Risk 1~2 action)
```

### 15.3 Incident Intelligence — "어제 배포 이후 고객에게 영향을 준 문제는?"

```
trigger: incident.detected (Sentry alert/spike)
1. Incident entity 생성 → 직전 24h deployment 후보 조회
2. Engineering Agent → 인과 체인 (graph.pathBetween + 스택트레이스 대조)
3. graph.impactedCustomers → 영향 고객 추정
4. critical insight → Brief 최상단 + owner 즉시 알림
```

## §16. Action Engine / Autonomy / Policy / Source of Truth

### Risk classification (모든 tool은 등록 시 risk를 코드로 선언 — agent가 판단하지 않음)

| Risk | 정의                     | 예                                      | 기본 정책          |
| ---- | ------------------------ | --------------------------------------- | ------------------ |
| 0    | Read only                | graph/events 조회                       | 자동 허용          |
| 1    | Low-impact write         | 내부 태스크 생성, owner DM, email draft | 가능한 자동 허용   |
| 2    | External communication   | 고객 이메일 발송, 채널 포스트           | 기본 approval      |
| 3    | Financial / production   | invoice retry, plan 변경, deploy        | mandatory approval |
| 4    | Irreversible / sensitive | — (MVP 제외)                            | approval + 재인증  |

### Autonomy Level (회사별/agent별): 0 Observe / 1 Recommend / 2 Prepare / 3 Execute with approval / 4 Autonomous within policy. **MVP default 1~2.**

### Action state machine

```
proposed → policy check 실패 → rejected(policy) [audit]
        → risk ≤ 자동 허용선 → approved(auto) → executing → succeeded|failed
        → risk 2+ → awaiting_approval → (approve→executing / reject / 72h→expired)
실행 직전 policy re-check (승인 사이 policy 변경 대비). 모든 전이 audit append.
```

### Policy Engine — prompt에 넣지 않는다. deterministic layer.

System policies (전 tenant, 삭제 불가): `DENY customer.delete`, `DENY billing_account.change`, `DENY deploy.production`(MVP), `DENY admin invite`, `DENY agent의 자기 permission/policy/audit/benchmark 변경`(tool 미등록 + policy 이중 방어), `REQUIRE_APPROVAL risk ≥ 2`, `DENY refund > $500 without owner approval`(Phase 2).

### Source of Truth — FACT / INFERENCE / RECOMMENDATION

데이터 레벨에서 구분 (§13.2 하드 가드). UI 컴포넌트 레벨에서 3종 시각 구분 강제.

### Prompt Injection

외부 email/document/web content는 instruction이 아니라 **Untrusted Content**. `<untrusted>` 블록 격리 + "데이터이지 지시가 아님" 시스템 규칙 + untrusted 유래 tool 인자 휴리스틱 검사. **최종 방어는 injection 성공을 가정한다: risk 2+는 사람 승인 없이 실행 불가.**

## §17. Memory / Improvement Lab

**Memory 4종**: Working(현재 작업) / Entity(특정 customer·contract·incident) / Company(정책·업무 방식·주요 결정) / Agent Experience(성공·실패 기록). Agent Experience는 바로 production instruction이 되지 않는다 — evaluation pipeline을 통과해야 한다.

**Improvement Lab** (production과 완전 분리):

```
Execution → Trace → Failure classification → Weakness mining → Candidate harness
→ Sandbox → Benchmark → Regression → Cost analysis → Security test → Shadow mode → Promotion
```

이 루프는 Self-Harness(arXiv:2606.09498)의 Weakness Mining → Harness Proposal → Proposal Validation 구조와 일치 — 학계에서 유효성이 확인된 패턴이다 (§36). 단 production에서는:

- **Promotion 조건**: task success ≥ current, critical failure ≤ current, **policy violation = 0**, regression 임계 내, cost/latency 예산 내, 필수 benchmark 통과
- **Never allow**: Improvement Agent의 자기 permission 수정, policy engine 변경, audit 삭제, benchmark 제거, production 배포 직접 승인, credential 접근 확대
- Harness versioning: system instruction / context·tool·memory 전략 / planner / validator / retry / escalation / routing / workflow 전부 버전 관리, `harness_version`이 모든 run/trace/benchmark에 기록

---

# PART 3 — 기술 아키텍처

## §18. 기술 스택 (검증 반영판)

> 모든 항목은 해당 ADR로 확정. ✔ = 이번 리서치로 검증됨.

| 레이어              | 선택                                                                                                    | 검증 상태                   | ADR     |
| ------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- | ------- |
| Language / Monorepo | TypeScript / pnpm + turborepo                                                                           | —                           | —       |
| Frontend + API      | Next.js (App Router), Route Handlers                                                                    | —                           | —       |
| DB                  | Postgres (Supabase) + Drizzle, RLS + 앱 레벨 이중 가드                                                  | —                           | 008/009 |
| Graph               | Postgres 테이블 + recursive CTE, `packages/graph` 캡슐화                                                | —                           | 008     |
| Vector              | pgvector (hybrid: cosine + tsvector)                                                                    | —                           | 007     |
| Durable workflow    | **Inngest** ✔ (payload ref-only + 암호화 미들웨어, step 과금 모니터링) — 벤치마크 2후보: Trigger.dev v4 | ✔ 확정 근거 확보            | 002     |
| Connector           | **직접 구현 5종 + 공용 Sync Harness** ✔                                                                 | ✔ 반박 시도 실패, 근거 강화 | 001     |
| LLM Gateway         | **자체 thin** (Anthropic+OpenAI SDK) ✔ + day-1 비용 이벤트                                              | ✔ 조건부 생존               | 003     |
| Agent Runtime       | 자체 실행 루프 (harness = IP)                                                                           | 문헌 근거 보강              | 004     |
| Observability       | 자체 traces 테이블 = canonical, OTel 계측                                                               | LiteLLM 사례가 반증 강화    | 005     |
| Eval                | 자체 benchmark harness + LLM judge                                                                      | 문헌 근거 보강              | 006     |
| Auth                | Supabase Auth + RLS                                                                                     | —                           | 009     |
| Secrets             | envelope encryption (tenant DEK + cloud KMS root)                                                       | —                           | 010     |
| Hosting             | Vercel(web) + Railway(worker, Docker)                                                                   | —                           | 011     |

## §19. 시스템 아키텍처

```
┌────────────────────────────────────────────────────┐
│ apps/web (Vercel)                                  │
│  UI(onboarding·command center·ask·approvals·audit) │
│  control plane API · webhook 수신(/api/webhooks/*) │
└──────────────┬─────────────────────────────────────┘
               │ Postgres (control.* / data.* 논리 분리)
┌──────────────┴─────────────────────────────────────┐
│ apps/worker (Railway, long-running, Docker)        │
│  Sync Harness(공용) + connector 5종                │
│  normalization → entity resolution → graph         │
│  Agent Runtime · Inngest functions(3 workflows)    │
└────────────────────────────────────────────────────┘
데이터 흐름: External SaaS →(webhook/poll)→ raw_events → canonical events
→ resolution → entities+relationships → workflow trigger → agent → insights
→ (approval) → action 실행 → audit
```

- MVP는 **web + worker + Postgres** 3개 컴포넌트가 전부. 마이크로서비스 금지.
- Control/Data plane은 같은 DB에서 스키마 네임스페이스로 논리 분리 (Phase 3 enterprise 물리 분리 대비).

## §20. DB 스키마 (논리 요약)

> 전 테이블 공통: `id uuid pk, tenant_id not null, created_at, updated_at`. RLS 강제 + Drizzle tenant-scoped client(tenant_id 자동 주입, raw query lint 금지). `audit_log`는 DB role 레벨에서 UPDATE/DELETE 권한 제거(append-only).

**control.***: `tenants`, `users`, `memberships(role: owner|admin|member)`, `integrations(provider, status, credentials_encrypted, scopes, webhook_secret_encrypted, health)`, `agent_definitions(key, version, definition jsonb, harness_version, is_active)`, `policies(rule jsonb, is_system)`, `autonomy_settings`

**data.*** (graph): `entities(type, display_name, canonical jsonb, search tsvector)`, `source_links(entity_id, provider, source_type, source_id, raw_latest — unique(tenant,provider,source_type,source_id))`, `relationships(from, to, type, confidence, evidence, valid_from/to)`, `raw_events(payload, processing_status)`, `events(canonical — unique(tenant,source,source_event_id))`, `entity_merges`

**data.*** (실행): `agent_runs(trigger, status, cost, latency, harness_version)`, `traces(run_id, seq, kind, input/output, model, tokens, cost)`, `insights(kind: fact|inference|recommendation, category, confidence, evidence, status)`, `actions(tool, params, risk_level, status, policy_decision)`, `approvals`, `audit_log`, `memories(scope, content, embedding, status: active|candidate|rejected)`, `documents`/`document_chunks`

**bench.***: `benchmark_scenarios(tenant_id nullable — null=공용, fixture, expected, grading: deterministic|llm_judge|hybrid)`, `benchmark_runs(scenario, agent, harness_version, passed, score, cost, latency)`

Graph 조회 API (`packages/graph`, recursive CTE, depth ≤ 4 가드):
`getEntity / neighbors(depth≤2) / pathBetween(≤4) / timeline / impactedCustomers` — 마지막 것이 Incident Intelligence의 1급 시민.

## §21. Connector Layer (검증 반영 — 최대 수정 영역)

### 21.1 공용 Sync Harness (v0.6 신규 — 1급 컴포넌트)

리서치 결론: "진짜 공수는 커넥터 5개가 아니라 공통 하네스다. 한 번 만들어라."

`packages/connectors/core`가 제공:

- **Webhook 파이프**: provider별 서명 검증(Stripe-Signature/GitHub HMAC/Slack signing/Sentry secret) + 타임스탬프 재생 방지 + `source_event_id` dedup + raw_events 저장까지 공통
- **Backfill 러너**: cursor 관리, 페이지네이션, rate limit(token bucket), 지수 백오프, 진행률 → `integrations.health` (온보딩 카운트업 화면의 데이터원)
- **Reconcile 폴링**: webhook 유실 대비 주기 대사 (provider별 주기 설정만)
- **CredentialVault 접점**: 복호화는 실행 시점, 로그/트레이스 자동 마스킹
- **Untrusted 마킹**: 모든 외부 텍스트 필드 `{value, untrusted: true}` 래핑
- 공통 인터페이스: `connect/disconnect/healthCheck/listCapabilities/backfill/subscribe/verifyWebhook/execute/refreshAuth/getSchema` — 구현은 Direct/MCP Adapter/기타로 교체 가능 (vendor lock-in 금지)

개별 커넥터는 **normalizer(순수 함수) + provider 설정**만 쓰면 된다.

### 21.2 MVP 5종 (개정: Gmail → Linear)

| Provider     | Auth                                           | Backfill                                             | Subscribe                                             | Entity 매핑                                                   |
| ------------ | ---------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| **Stripe**   | Restricted API key (read-only)                 | customers, subscriptions, invoices, charges (12개월) | webhook: `customer.*`, `invoice.*`, `charge.*`        | customer→Customer, invoice→Invoice, charge→Payment            |
| **GitHub**   | GitHub App (repo/issues/deployments read)      | repos, open issues, PRs(90일), deployments           | webhook: issues, PR, push, deployment_status, release | PR body `fixes #N` → resolves 링크, SHA → deployment contains |
| **Slack**    | App OAuth (지정 채널 history/read, users:read) | 지정 채널 30일                                       | Events API: message.channels                          | 멤버→Employee, 스레드→Communication. bot DM은 Risk 1 action   |
| **Sentry**   | Internal Integration token (read)              | projects, unresolved issues(30일), releases          | webhook: issue/metric alerts                          | project→Service, spike→Incident, release↔GitHub SHA           |
| **Linear** ✚ | OAuth (read)                                   | teams, issues(90일), cycles                          | webhook: Issue events                                 | issue→Bug/Task, Linear↔GitHub PR 링크(결정적)                 |

**Linear 승격 근거**: ICP(developer-led startup)의 실사용 도구이고, GitHub와의 결정적 링크가 많아 graph 품질에 즉시 기여하며, 규제 장벽이 없다.

### 21.3 Gmail — 별도 트랙 G (검증 결과 반영)

리서치로 확정된 사실:

- `gmail.readonly`는 **restricted scope** → OAuth 앱 심사(2~~8주) + **연례 CASA Tier 2** (lab 검증 필수 — self-scan 폐지됨, TAC Security 기준 ~~$540부터, 시장 밴드 $500~~4,500/년) + 최초 총 1~~3개월
- `gmail.send`는 **sensitive scope — CASA 불필요** (브랜드 심사만)
- 미검증 테스트 모드: 100명 한도 + **refresh token 7일 만료**
- `gmail.metadata`도 restricted — 우회 안 됨. Pub/Sub watch도 read scope 필요
- Workspace 고객은 domain-wide delegation / admin whitelist로 per-customer 우회 가능

**트랙 G 계획:**

| 단계                  | 내용                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 알파          | Gmail-read를 **테스트 모드**로 자기 회사에만 연결 (7일 재인증 UX 감수). `communication.received` → ticket 후보 분류기 검증      |
| Phase 1 후반          | `gmail.send`만 프로덕션 심사 (CASA 불필요) → dunning/고객 이메일 발송(Risk 2) 활성화                                            |
| Phase 2 진입 3개월 전 | CASA Tier 2 착수 (예산 ~~$1~~5k/년 + 심사 대응 2~4주 엔지니어링). 병행: Workspace 고객은 admin-trust 경로 안내                  |
| 대안 상시 검토        | 포워딩 주소 기반 수신(고객이 support@를 우리 주소로 포워딩 — scope 심사 자체가 불필요)을 support 시나리오의 우회로로 프로토타입 |

## §22. Agent Runtime

실행 루프 (자체 구현 — harness가 IP):

```
1 AgentDefinition 로드 (active version)
2 budget check — 일일 예산 초과 시 즉시 중단 + escalation
3 context assembly — trigger entity의 graph.neighbors(≤2) + events(lookback) + memories
    + untrusted는 <untrusted source=...> 격리
4 model call (LLM Gateway 경유)
5 tool 루프 — allowedTools 검증 → policy pre-check
    → risk 0~1 즉시 실행 / risk 2+ actions(awaiting_approval) 생성 후 계속
    → 모든 결과 trace 기록
6 output — zod 검증, insights[] (evidence 규칙 §13.2)
7 종료 — run/cost/latency 기록, audit
하드 가드: tool call ≤ 20/run, model call ≤ 10/run, evidence DB 실재 검증
```

## §23. Workflow Runtime — Inngest (검증 조건 3개 부착)

1. **Payload ref-only**: step payload에는 id만. 원문 데이터 금지 (Inngest cloud를 payload가 경유하기 때문 — 리서치 확인). 추가 완화: Inngest 암호화 미들웨어 적용
2. **Step 과금 모니터링**: run + step마다 1 execution 과금 (5-step 함수 = 6 executions). 무료 50k exec/월 → 사용량 대시보드에 exec 카운트 포함, Pro($75~99/월) 전환점 추적
3. **도메인 로직 순수 함수 분리**: workflow 파일은 thin orchestration만 — Temporal/Trigger.dev 이전 비용의 상한선

승인 대기는 `step.waitForEvent`(최대 1년), 장기 sleep은 `step.sleep`(무료 7일/Pro 1년) — Proof 4 요구 충족 확인됨. Self-host(오픈소스, 단일 바이너리)가 탈출구.

## §24. LLM Gateway & Routing (검증 조건 부착)

```typescript
llm.call({ tenantId, runId, traceRef,
  profile: 'FAST'|'BALANCED'|'HIGH_REASONING'|'LOW_COST',
  messages, tools?, schema?, maxCostUsd, timeoutMs
}): Promise<LlmResult>   // 항상 tokens/cost/latency 포함
```

- Provider adapter: Anthropic + OpenAI 2개로 시작. profile→model 매핑은 DB config (무배포 교체)
- **Day-1 규칙 (리서치의 공통 교훈)**: 모든 호출이 `{tenant, agent, profile, model, tokens, cost, latency}` 이벤트를 방출 → §9 AI COST 카드 + tenant×agent×일 비용 집계 + budget 차단의 단일 데이터원. **이걸 나중에 붙이려면 후회한다.**
- MVP 라우팅: profile → primary, 비용 초과 시 LOW_COST 강등, 5xx/timeout 시 fallback 1회. task-type/company별 자동 라우팅은 Phase 2+ (historical trace가 원료)
- 졸업 경로(확정): 프로바이더 3~4개 초과 또는 PRIVATE/LOCAL profile 도입 시 → **LiteLLM SDK**(proxy 아님 — proxy는 운영 부담 실증됨) 또는 **Vercel/Cloudflare AI Gateway**(무마진 pass-through, BYOK)를 `llm.call()` 아래에 삽입. 라우터는 계속 우리 것. Portkey/OpenRouter는 라우팅 로직을 뺏기므로 부적합

## §25. 보안 & 멀티테넌시

| 항목             | 구현                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation | ① Postgres RLS 전 테이블 ② Drizzle tenant-scoped client(자동 주입 + raw query lint 금지) ③ CI cross-tenant 침투 테스트 suite. 매칭/검색/graph 순회 전부 tenant 내부로 한정 |
| Credential       | envelope: KMS root → tenant DEK → AES-256-GCM. 복호화는 CredentialVault 모듈 단일 chokepoint, agent tool에서 import 금지(lint + policy 이중)                               |
| Webhook          | 서명 검증 + 재생 방지 (Sync Harness 공통)                                                                                                                                  |
| Prompt injection | untrusted 격리 + tool 인자 검사 + **최종 방어 = approval gate** (§16)                                                                                                      |
| Token            | short-lived 우선 (GitHub App 1h). Stripe restricted key는 read-only 최소 scope                                                                                             |
| Audit            | append-only (DB 권한 레벨)                                                                                                                                                 |
| 암호화           | TLS 전 구간 + at-rest (Supabase 기본)                                                                                                                                      |

## §26. Observability

- `traces` 테이블이 **canonical** (trace는 제품 데이터: Audit UI·evidence·benchmark 원료). 외부 툴(Langfuse self-host 등)은 read-only 미러로만
- run당 필수: context ref, prompt version, model, tool call/result 전문, 토큰/비용/지연
- Connector health: 주기 healthCheck + webhook 수신 간격 감시 → 이상 시 owner 알림
- 비용 대시보드: §24 이벤트 스트림 집계 (LLM) + Inngest exec 카운트 (workflow)

## §27. Evaluation & Benchmark

- 시나리오 = fixture(mock graph 상태) + expected + grading(deterministic / LLM judge / hybrid)
- Company-specific benchmark: 실제 historical operation → regression dataset (예: payment 문제 100, support 200, incident 50, churn 40) — **moat의 실체이므로 시나리오 포맷·채점 기준·이력 전부 자체 소유** (SaaS eval 도구에 위탁 금지)
- LLM judge 신뢰도: 초기 50건 사람 채점과 대조, 일치율 ≥ 90% 확인 후 신뢰
- Proof 6: 동일 task를 harness 2종으로 실행·비교 — HarnessOpt-Bench/Harness-Bench(§36)가 같은 방법론의 학계 선례

---

# PART 4 — 사업성 (v0.6 신규)

## §28. 단위 경제성 — LLM COGS 추정

> 가정: 활성 tenant 1곳(고객 ~400, 일 이벤트 ~500), 2026-08 기준 공시 단가 — BALANCED=Claude Sonnet 5($3/$15 per MTok, 2026-08-31까지 인트로 $2/$10), FAST=Claude Haiku 4.5($1/$5). 추정은 ±2배 오차 가능 — Phase 1에서 실측으로 교체한다 (그래서 day-1 비용 이벤트가 필수).

**무최적화 시 (naive):**

| 항목                                                | 볼륨/일 | 토큰/런 (in/out) | profile  | $/일                  |
| --------------------------------------------------- | ------- | ---------------- | -------- | --------------------- |
| Morning Brief (Founder)                             | 1       | 50k / 3k         | BALANCED | ~$0.20                |
| 하위 agent 런 (revenue/customer/eng, 이벤트 트리거) | 20      | 15k / 1k         | FAST     | ~$0.40                |
| Ask 질의                                            | 5       | 20k / 1.5k       | BALANCED | ~$0.41                |
| Entity resolution LLM 판정                          | 30      | 2k / 0.2k        | FAST     | ~$0.09                |
| 분류기 (ticket 등)                                  | 50      | 1k / 0.1k        | FAST     | ~$0.08                |
| **합계**                                            |         |                  |          | **~$1.2/일 ≈ $35/월** |

여기에 Inngest·호스팅·DB 배분분 ~~$5~10/월을 더하면 **tenant당 원가 $40~~45/월** — Concept v0.1의 $49/mo 요금제는 마진이 사실상 0이다.

**최적화 레버 (적용 순서대로):**

1. **Prompt caching** — agent 시스템 프롬프트/그래프 컨텍스트의 안정 prefix 캐싱: 캐시 읽기 ~~0.1× (브리프·ask의 입력 대부분) → 입력 비용 60~~80% 절감
2. **Batch API** — Morning Brief·주간 스캔은 지연 무관: 50% 할인
3. **FAST 강등** — 하위 agent 스캔의 1차 패스를 FAST로, 신호 감지 시에만 BALANCED 승격
4. **Insight 재사용** — 동일 질문/동일 데이터 상태는 재계산하지 않음 (events 워터마크 기반)

**최적화 후 목표: tenant당 LLM COGS $8~15/월.** 이 수치의 달성 여부 자체를 §34 수용 기준에 넣는다.

## §29. 가격 가설 (v0.6 수정)

| Plan           | 가격 가설  | 포함                                                           | 원가 구조                     |
| -------------- | ---------- | -------------------------------------------------------------- | ----------------------------- |
| **Starter**    | **$99/월** | 커넥터 5, agent 4, 3 workflows, Managed AI (Automatic routing) | COGS $10~20 → 매출총이익 80%± |
| **Growth**     | $249/월    | + 커넥터 추가, autonomy L3, 우선 추론, 사용량 상한 상향        |                               |
| **Private AI** | Phase 3    | dedicated inference, VPC, residency                            |                               |

- $49는 마진 구조상 불가 (§28) — 단 **AI 사용량 상한이 낮은 라이트 플랜**으로는 재검토 가능
- 가격의 최종 검증은 Phase 1 종료 시 실측 COGS + 알파 고객 지불의사 인터뷰로. 이 표는 가설이다
- 사용자에게 보이는 비용 투명성(§9 AI COST 카드)이 가격 저항의 완충재

---

# PART 5 — ADR 12개 재검토 결과

## §30. 재검토 요약표

| ADR                      | 기존 추천                        | 재검토 판정                  | 변경 내용                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **001 Connector**        | 직접 구현 (MVP 5종)              | ✅ **유지 + 근거 강화**      | ① Pipedream: Workday 인수(2025-11) → 후보에서 사실상 탈락 ② Composio: agent-skills 피벗, sync 프레임워크 부재 확인 ③ Nango: ELv2, self-host 무료판은 production sync 제외 — "저비용 자가호스팅" 논거 소멸 ④ **수정**: 5개 개별 구현 → 공용 Sync Harness + normalizer 구조 (§21.1) ⑤ **수정**: MVP 구성 Gmail→Linear, Gmail은 트랙 G                                                                                                  |
| **002 Workflow**         | Inngest                          | ✅ **유지 + 조건 3개**       | ① 승인 대기·sleep·self-host 전부 실증 확인 ② Temporal $100/월 floor + 학습 곡선 확인 ③ **신규 조건**: payload ref-only + 암호화 미들웨어(cloud 경유 확인됨), step 단위 과금 모니터링 ④ **수정**: 벤치마크 2후보를 Restate→**Trigger.dev v4**로 교체 (waitpoint token이 승인 플로우에 우수, 단 코드가 그들 인프라에서 실행 — 프라이버시에서 감점. Restate는 seed-stage 벤더 리스크)                                                   |
| **003 LLM Gateway**      | 자체 thin                        | ✅ **유지 + 2개 갱신**       | ① LiteLLM proxy 운영 부담 실증(메모리 누수, 이슈 1,000+, TCO 월 $2~3.5k) — "그냥 LiteLLM 쓰자"는 반론 기각 ② **신규 조건**: day-1 요청당 비용 이벤트 (§24) ③ **수정**: exit 경로를 LiteLLM **SDK** 또는 Vercel/Cloudflare AI Gateway(무마진 pass-through)로 갱신. Portkey(라우팅이 그들 config DSL로)·OpenRouter(수수료+라우팅 위탁)는 in-house 라우팅 제약과 불일치 확인                                                            |
| **004 Agent Runtime**    | 자체 루프                        | ✅ **유지 + 문헌 보강**      | "harness가 성능을 좌우한다"가 추정이 아니라 문헌으로 확인됨: Harness-Bench(arXiv:2605.27922 — 모델 간 harness 효과 측정), Self-Harness(2606.09498). harness = IP 논거가 강화됨                                                                                                                                                                                                                                                       |
| **005 Observability**    | 자체 traces = canonical          | ✅ **유지**                  | LiteLLM 사례(관측을 proxy에 위탁했을 때의 운영 부담)가 방증. 변경 없음                                                                                                                                                                                                                                                                                                                                                               |
| **006 Evaluation**       | 자체 benchmark harness           | ✅ **유지 + 문헌 보강**      | HarnessOpt-Bench(arXiv:2608.06301 — LLM을 harness optimizer로 평가), Harness-Bench가 우리 Proof 6 방법론의 선례. 시나리오 데이터 자체 소유 원칙 유지                                                                                                                                                                                                                                                                                 |
| **007 Knowledge Store**  | pgvector                         | ✅ **유지**                  | 반박 근거 미발견. 재검토 임계(p95 > 200ms, 수천만 벡터) 유지                                                                                                                                                                                                                                                                                                                                                                         |
| **008 Company Graph**    | Postgres + CTE                   | ✅ **유지**                  | 반박 근거 미발견. 정량 임계(pathBetween p95 > 500ms 지속, depth 5+ 요구, relationship 1천만/tenant) 유지                                                                                                                                                                                                                                                                                                                             |
| **009 Auth/Tenant**      | Supabase Auth + RLS 이중         | ✅ **유지**                  | 변경 없음. Sprint 1에서 RLS+Drizzle 이중 가드 실증이 확정 조건                                                                                                                                                                                                                                                                                                                                                                       |
| **010 Secrets**          | envelope + cloud KMS             | ✅ **유지**                  | 변경 없음. Gmail 트랙 G의 CASA 심사가 어차피 이 수준의 암호화·접근통제를 요구 — 선행 투자가 심사 대비도 됨                                                                                                                                                                                                                                                                                                                           |
| **011 Compute**          | Vercel + Railway + Supabase      | ✅ **유지**                  | 변경 없음. worker Docker 유지가 이전 비용 상한                                                                                                                                                                                                                                                                                                                                                                                       |
| **012 Self-Improvement** | MVP 수동 + Lab-ready 데이터 규율 | ✅ **유지 + 문헌 대폭 보강** | 실존 확인된 직접 문헌: SIA(arXiv:2605.27276 — harness+weight 개선 루프), Self-Harness(우리 Lab 루프와 동형). 확립된 앵커: Darwin Gödel Machine(2505.22954), GEPA(2507.19457, ICLR 2026 Oral), DSPy(2310.03714), AlphaEvolve(2506.13131), ADAS(2408.08435). **결론 불변**: 자동화는 Phase 2+, MVP의 결정은 "데이터를 Lab-ready로 쌓는 것"(harness_version 태깅, 실패 분류 체계, trace→시나리오 변환 가능 포맷, 수동 promotion 게이트) |

> 상세 ADR 문서 12건은 별도 파일로 유지·갱신한다. 이 표가 v0.6 시점의 판정 기록이다.

---

# PART 6 — 로드맵과 스프린트

## §31. Phase 0 — Technical Validation (Sprint 1~3, 3주)

**Sprint 1 — 뼈대 + Proof 1**

- 모노레포, DB 스키마 v1, tenant-scoped client + RLS 이중 가드 (ADR-009 확정)
- **공용 Sync Harness v1** (서명 검증·dedup·cursor·재시도)
- Stripe + GitHub connector (harness 위에 normalizer만)
- LLM Gateway thin v1 — **비용 이벤트 포함** (ADR-003 확정)
- ✅ Proof 1: Stripe test-mode + 격리된 테스트 repo 연결, entity 생성

**Sprint 2 — Graph + Proof 2, 5**

- Entity resolution v1 (결정적 + 이메일) + golden set 채점 절차 수립 (§11.3)
- graph API 5종 (neighbors/timeline/pathBetween/impactedCustomers)
- Agent Runtime 스켈레톤 + traces
- Inngest vs Trigger.dev v4 벤치마크 (Proof 4 시나리오 구현 비교 — ADR-002 확정)
- ✅ Proof 2: customer 1명 payment→ticket(mock)→issue 연결 / ✅ Proof 5: trace 저장·조회

**Sprint 3 — Brief + Proof 3, 4, 6**

- Founder Agent v1 + Morning Brief (evidence 하드 가드)
- Action Engine 최소 (risk 1 tool + approval API) + Policy Engine 최소
- Benchmark harness v1: 시나리오 5개, harness 2종 비교 러너
- ✅ Proof 3: evidence 기반 brief / ✅ Proof 4: recommendation→approval→실행 / ✅ Proof 6: 2-harness 비교 리포트

**게이트: Proof 6종 미통과 시 Phase 1 착수 금지. 실패 시 해당 ADR로 회귀.**

## §32. Phase 1 — Local Alpha (Sprint 4~11, 8주)

| Sprint | 내용                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------- |
| 4      | Onboarding UI 전체 (connect → discovery 카운트업), Sentry connector                                       |
| 5      | **Linear connector**, Slack connector(읽기 + owner DM). Gmail 트랙 G-1: 테스트 모드 read + 분류기         |
| 6      | Customer Risk workflow + Customer Agent, Command Center v1 (AI COST 카드 포함)                            |
| 7      | Ask 화면 (SSE) + **answerability 판정** (§13), Incident Intelligence + Engineering Agent                  |
| 8      | Revenue Agent(Brief 섹션으로), impactedCustomers 최적화, entity resolution 휴리스틱+LLM 계층              |
| 9      | Approvals UI, Entity 페이지(추정 링크 confirm/reject), Audit/Trace UI                                     |
| 10     | Risk 2 tool (slack.post, gmail.send — 트랙 G-2: send-only 심사), execute-time policy re-check             |
| 11     | Hardening: 자기 회사 + 지인 회사 1곳 온보딩, §34 지표 실측, **비용 최적화 1차 (캐싱·배치— §28 레버 1·2)** |

## §33. Phase 2~4 (방향)

- **Phase 2 Private Beta** (10~20사): multi-tenant 운영, billing, RBAC, connector health UI, audit UI, evaluation 운영. **진입 3개월 전 Gmail CASA 착수** (트랙 G-3). Improvement Lab v1 (weakness mining 자동화, promotion은 사람)
- **Phase 3 Commercial**: Company Packs(Startup Pack: agents 5 + integrations 7 + policies 30 + benchmarks 50 + workflows 20 → "Install → Connect → Operational"), connector marketplace(롱테일은 Composio류 어댑터 재검토), Universal Connector(OpenAPI/MCP/문서 URL → connector candidate 자동 생성 + sandbox/schema/auth/read/write 검증 통과 의무), private compute, enterprise isolation
- **Phase 4 Self-Optimizing**: company별 model routing·harness·context·비용 자동 최적화 — 단 promotion은 검증과 policy boundary 안에서. "Company Template / Company in a Box" 비전

---

# PART 7 — 수용 기준과 오픈 이슈

## §34. 수용 기준 (측정 가능 형태)

**속도** (v0.5 유지): 온보딩 10분 내 SaaS 3개 연결 / 30분 내 company model / 24시간 내 Founder Brief.

**품질 (v0.6 구체화):**

| 항목              | 기준                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Entity resolution | **precision ≥ 95%, coverage ≥ 85%** (golden set 100건, 주 1회 채점 — §11.3)                     |
| Evidence          | critical insight의 evidence 100% (하드 가드로 렌더 차단)                                        |
| "모른다"          | answerability 오분류(답 못할 것을 답함) — 알파 기간 표본 검사에서 0 목표                        |
| Audit             | write action audit 기록 100%                                                                    |
| Isolation         | cross-tenant leakage 0 (침투 테스트 suite green)                                                |
| Policy            | critical action policy gate 100%, 우회 경로 0 (테스트로 증명)                                   |
| **비용 (신규)**   | 활성 tenant당 LLM COGS 실측 → 최적화 1차 후 **$20/월 이하** (목표 $8~15)                        |
| Connector         | sandbox/test-mode e2e (backfill 완주 + webhook→event), 서명 검증 테스트, credential 암호화 확인 |

**MVP Must-Not-Build** (v0.5 유지): Full CRM, 회계, payroll, 완전한 계약/프로젝트 관리, 자체 email 클라이언트/Slack/observability 백엔드/vector DB, 수백 개 자체 커넥터, 자체 foundation LLM.

## §35. 오픈 이슈

| #   | 이슈                                                            | 결정 시한       | 비고                                |
| --- | --------------------------------------------------------------- | --------------- | ----------------------------------- |
| 1   | Inngest vs Trigger.dev v4 실측 (Proof 4 시나리오)               | Sprint 2        | ADR-002. Restate 제외 확정          |
| 2   | Gmail 포워딩 주소 방식 프로토타입 (CASA 완전 우회 경로)         | Phase 1 중      | 트랙 G 대안                         |
| 3   | usage 데이터 소스 — 자체 이벤트 수집은 must-not-build 저촉 소지 | Phase 1 중      | Stripe metering / PostHog 연동 검토 |
| 4   | LLM judge 신뢰도 기준 절차 (사람 채점 50건 대조)                | Sprint 3        | ADR-006                             |
| 5   | 가격 $99 가설의 지불의사 검증 방법 (알파 고객 인터뷰 설계)      | Phase 1 종료 시 | §29                                 |
| 6   | Supabase RLS + Drizzle 이중 가드의 성능 오버헤드 실측           | Sprint 1        | ADR-009                             |
| 7   | 임베딩 모델/차원 (pgvector)                                     | Sprint 5 전     | ADR-007                             |
| 8   | Inngest step 과금이 workflow 설계에 주는 제약 (step 병합 기준)  | Sprint 3        | ADR-002 조건                        |

---

# 부록

## §36. 리서치 출처 (2026-08-08 검증)

**커넥터 인프라**: Workday–Pipedream 인수 발표(newsroom.workday.com, 2025-11-19) · Composio Series A(finsmes.com, 2025-07) · Composio triggers/self-host 문서(docs.composio.dev, GitHub #1037) · Nango self-hosting/가격(nango.dev, GitHub #5536) · Merge 카탈로그(merge.dev)

**Gmail/CASA**: Google restricted-scope verification(developers.google.com) · 심사 도움말(support.google.com/cloud/answer/13465431) · App Defense Alliance CASA Tier 2(appdefensealliance.dev) · 가격 밴드(deepstrike.io, switchlabs.dev, TAC Security/Leviathan/Prescient) · 테스트 모드 한도·7일 토큰(support.google.com, unipile.com)

**Workflow**: Inngest 문서(sleeps/wait-for-event/usage-limits/self-hosting/pricing) · Temporal Cloud 가격 개정(temporal.io/blog) · Trigger.dev v4 waitpoints(trigger.dev/changelog) · DBOS(dbos.dev) · Restate seed(restate.dev/blog) · StatusGator uptime

**LLM Gateway**: LiteLLM routing/budgets 문서(docs.litellm.ai) · 가격 분석(truefoundry.com) · 이슈 분석(dev.to) · Vercel AI Gateway/BYOK(vercel.com) · 게이트웨이 비교(api7.ai, mcp.directory) · 2026 build-or-buy(edenai.co)

**연구 문헌 (전부 실존 확인)**: SIA — arXiv:2605.27276 (Hexo Labs, harness+LoRA weight 개선) · Self-Harness — arXiv:2606.09498 (Weakness Mining→Proposal→Validation) · HarnessOpt-Bench — arXiv:2608.06301 · Harness-Bench — arXiv:2605.27922 (harness-bench.ai) · Darwin Gödel Machine — arXiv:2505.22954 (Sakana AI) · GEPA — arXiv:2507.19457 (ICLR 2026 Oral) · DSPy — arXiv:2310.03714 · AlphaEvolve — arXiv:2506.13131 · ADAS — arXiv:2408.08435

**LLM 단가 (2026-08 공시가)**: Claude Sonnet 5 $3/$15 per MTok(인트로 $2/$10, ~2026-08-31) · Claude Haiku 4.5 $1/$5 · Claude Opus 5 $5/$25 · 캐시 읽기 ~0.1× · Batch 50% 할인

---

## 최종 제품 원칙

회사를 운영하려고 AI를 설정하게 하지 않는다. **AI가 회사를 이해하도록 만든다.**

사용자에게 보여줄 제품: **Connect. Ask. Approve.**

그 뒤의 수백 개 기술적 복잡성 — 그리고 이 문서의 전부 — 는 Company OS가 책임진다.

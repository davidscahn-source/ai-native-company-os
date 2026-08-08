# AI Native Company OS

> **Connect your company. AI operates the rest.**

**Status: 기획 단계 (Planning)** — 아직 코드 없음. 현재 상태: v0.6 스펙 확정, v0.7 Architecture Freeze 준비 중.

---

## What is this?

소규모 창업자(1~20인 AI/SaaS startup)를 위한 AI-Native Company Operating System.

CRM, 빌링, 서포트, 인시던트 관리를 대체하지 않는다. 기존 시스템(Stripe, GitHub, Slack, Sentry, Linear...)을 **연결**하고, 그 위에 AI Company Control Plane을 만든다.

```
Observe → Understand → Decide → Act → Verify → Learn
```

사용자가 이해해야 하는 개념은 단 두 가지: **Connect my company** / **Ask my company**

포지셔닝: "Build your AI workforce"(경쟁사)가 아니라 **"Connect your company."**

장기 비전: *Start a company. Install the operating system.*

---

## Documents

| 문서 | 내용 | 상태 |
|---|---|---|
| **[docs/02-SPEC-v0.6.md](./docs/02-SPEC-v0.6.md)** | **통합 상세 기획서 v0.6** — 적대적 검증(독립 리서치 4건) 반영. 제품·시장·아키텍처·사업성·ADR 재검토·로드맵 단일 문서 | **현행 canonical** |
| [docs/00-MASTER-SPEC.md](./docs/00-MASTER-SPEC.md) | Master Product & Technical Specification v0.5 (54 sections) | v0.6에 통합됨 (원본 보존) |
| [docs/01-DEVELOPMENT-SPEC.md](./docs/01-DEVELOPMENT-SPEC.md) | 상세 개발 기획서 v0.1 — DB 스키마·API·화면·스프린트 상세 | v0.6에 요약 통합 (상세 참조용) |
| [docs/adr/](./docs/adr/) | Technology Decision Records 12건 (Proposed) — v0.6 §30에 재검토 판정 기록 | Proposed |

## v0.7 계획 (Architecture Freeze)

리뷰 합의 사항 — v0.6 GO, 아래 반영 후 v0.7에서 freeze:

1. Gmail 관련 수치를 CONFIRMED / PLANNING ASSUMPTION으로 분리 (문서 전체 규칙화)
2. Entity resolution: method별 precision 분리 (deterministic ≥99.5% / heuristic ≥98%), **LLM auto-link 초기 비활성** — candidate/suggestion까지만, `resolution_score`는 confirm/reject 루프로 calibration
3. **Company State 1급 승격**: State Projector + Snapshot + Delta (deterministic 계산, LLM은 "왜"만 설명). `source_watermark`/`completeness`가 answerability 판정의 데이터원
4. AI COST 카드 → AI Operations ROI (단, Phase 1은 셀 수 있는 숫자만 — 신뢰 규율)
5. Phase 0 지표 4개 추가: Company Understanding Score, Evidence Coverage, Abstention Precision/Recall, Cost per Useful Insight
6. 문서 분할: MASTER-SPEC(freeze) / ADR / THREAT-MODEL / CANONICAL-SCHEMA / CONNECTOR-SPEC / AGENT-RUNTIME-SPEC / EVAL-SPEC / PHASE-0-EXECUTION

**Sprint 1 원칙**: 첫 코드는 agent가 아니다. `Tenant → Stripe/GitHub → Raw Event → Canonical Event → Entity → Relationship → Company State` 파이프라인이 **LLM 0회 호출로** 관통해야 한다. 확실한 것은 deterministic system이, 해석이 필요한 것만 AI가.

---

## Phase 0 — Technical Validation 체크리스트

- [ ] **Proof 1** — Stripe + GitHub 연결
- [ ] **Proof 2** — 하나의 customer를 payment → support → issue와 연결
- [ ] **Proof 3** — AI가 evidence 기반 Founder Brief 생성
- [ ] **Proof 4** — AI recommendation → approval → safe action
- [ ] **Proof 5** — execution trace 저장
- [ ] **Proof 6** — 같은 task를 두 harness로 실행하고 benchmark 비교

## MVP Hard Scope

- **Connectors**: Stripe, GitHub, Slack, Sentry, **Linear** (Gmail은 별도 트랙 G — CASA 이슈, v0.6 §21.3)
- **Agents**: Founder, Revenue, Customer, Engineering
- **Killer workflows** (3): Morning Founder Brief · Customer Risk · Incident Intelligence

Must-not-build 목록은 v0.6 §34 참조.

# ADR-002: Workflow Runtime

- **Status:** Proposed (Sprint 3 전 확정 — Proof 4 의존)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

"invoice 실패 → 분석 → draft → 승인 대기 → 6시간 대기 → retry → 검증" 같은 장시간·승인 포함 프로세스를 서버 재시작에도 유실 없이 실행할 durable execution 기반 (§17).

## 2. Requirements

- durable step, sleep(시간 단위), 사람 승인 대기(waitForEvent), 재시도/백오프
- idempotency, 실행 이력 조회 (audit 연계)
- TypeScript 1급 지원, 로컬 개발 용이
- MVP 트래픽: 일 수백~수천 step (소규모)

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. Inngest | 이벤트 기반 durable functions, serverless 친화, managed |
| B. Temporal (Cloud) | 업계 표준 durable execution, 표현력 최강 |
| C. Restate | 신흥 durable execution, 경량 |
| D. 자체 (pg-boss + state machine) | Postgres 큐 + 수동 상태 관리 |

## 4. Benchmark

Sprint 2 말 A/B 각각으로 Proof 4 시나리오(제안→승인 대기→실행→검증) 구현 비교: 구현 시간, 로컬 DX, 승인 대기(수일) 처리, 관측성, 장애 주입(프로세스 킬) 후 재개 정확성.

## 5. Security

- A/B(Cloud): step payload가 외부 SaaS 경유 — **payload에 원문 데이터 넣지 말고 ref(id)만 전달**하는 규칙으로 완화. 이 규칙은 어느 후보든 적용.
- D: 데이터 반출 없음.

## 6. Cost

- A: free tier로 MVP 충분, 이후 실행량 과금.
- B: Temporal Cloud 최소 비용 + 운영 학습 곡선 비용. self-host는 인프라 부담 큼 (§36 정신 위배).
- D: 개발·디버깅 시간 = 숨은 최대 비용.

## 7. Vendor lock-in

- A: 중간 — step 코드는 TS 함수라 이식 가능하나 sleep/waitForEvent 시맨틱 종속.
- B: 중간(동일 구조).
- 완화책(공통): workflow 정의를 `packages/workflows`에 격리, 도메인 로직은 순수 함수로 분리해 런타임 API 접촉면 최소화.

## 8. Operational burden

- A: 매우 낮음. B(Cloud): 낮음~중간(개념 학습 곡선). D: 높음 — 스케줄러/재시도/유실 처리를 직접 소유.

## 9. Migration difficulty

도메인 로직 분리 규칙을 지키면 A↔B 이전은 workflow 파일 재작성 수준 (추정 1~2주). D→A/B는 쉬움, 역방향은 어려움.

## 10. Recommendation

**A. Inngest** — MVP.

- 승인 대기(waitForEvent)·장기 sleep·재시도가 모두 내장이고 web(Vercel)+worker 혼합 배포와 궁합.
- 팀 규모(1~2인)에서 Temporal의 표현력보다 운영 단순성이 우선.
- 채택 조건: payload-ref-only 규칙 + 도메인 로직 순수 함수 분리 (7절 완화책) 강제.

## 11. Rejection reasons

- D 자체 구현: durable execution은 미분화 중노동의 전형 — §45 "buy" 목록.
- B Temporal: 훌륭하나 현 팀 규모에 과함. Phase 2+ 복잡 workflow(다단계 보상 트랜잭션)가 필요해지면 재평가.
- C Restate: 성숙도 리스크.

## 12. Exit strategy

Inngest 가격/신뢰성 문제 또는 workflow 복잡도 임계 초과 시 Temporal Cloud로 이전. `packages/workflows` 격리 + 순수 함수 분리가 이전 비용의 상한 (재작성 범위 = thin orchestration 코드만).

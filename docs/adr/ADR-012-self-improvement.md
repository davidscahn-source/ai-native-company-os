# ADR-012: Self-Improvement Architecture

- **Status:** Proposed (구현은 Phase 2+ — 단, 데이터 수집 구조는 Sprint 1부터 영향)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

§28~31의 Self-Improving Harness — production 실행에서 약점을 발굴해 harness 개선안을 만들고, 검증 후 promotion하는 Improvement Lab — 를 어떤 아키텍처로 구현할 것인가. 그리고 MVP 시점에 무엇을 미리 깔아둬야 하는가.

## 2. Requirements

- Production agent는 자기 코드를 수정하지 않음 — Lab은 완전 분리 (§28)
- Loop: trace → failure classification → weakness mining → candidate → sandbox → benchmark → regression → cost → security → shadow → promotion
- Promotion 게이트 (§30): success ≥ current, critical failure ≤ current, policy violation = 0, cost/latency 예산 내
- Never-allow (§31): Lab agent의 권한/policy/audit/benchmark 변경 불가 — 구조로 강제
- Harness 전체가 버전 관리 대상 (§29): system instruction, context/tool/memory 전략, planner, validator, retry, escalation, routing, workflow

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. Offline Improvement Lab (별도 환경 + 사람 최종 승인 promotion) | 배치 분석 → 후보 생성 → benchmark → 사람이 promote |
| B. Online 자동 최적화 (production 내 A/B + 자동 promotion) | shadow 트래픽 자동 실험 |
| C. 수동 개선만 (Lab 없음) | 사람이 trace 보고 직접 harness 수정 |

## 4. Benchmark

Phase 2에서 A의 최소 구현으로 검증: 실 trace 100건 → failure 분류 정확도, 생성된 candidate가 benchmark에서 실제 개선을 내는 비율. 이 지표가 무의미하면 C로 후퇴 (Lab 유지비 절감).

## 5. Security

- A: promotion에 사람 승인 필수 → §31 위반 경로가 구조적으로 차단. Lab 환경은 production credential 접근 불가 (합성/익명화 fixture만).
- B: 자동 promotion은 §30 게이트를 코드로 완벽 구현해야 하며 policy violation=0 판정 자체의 신뢰가 전제 — 현 성숙도에서 위험.
- 공통: harness 저장소와 policy/audit/benchmark 저장소는 쓰기 권한 분리 (Lab 서비스 계정은 harness candidate 테이블에만 write).

## 6. Cost

- A: benchmark 실행 LLM 비용 (제어 가능 — 배치 주기 조절). B: shadow 트래픽 = production 비용 2배 구간 발생.

## 7. Vendor lock-in

- 자체 아키텍처 결정이므로 벤더 이슈 없음. 의존물: ADR-005 trace 스키마, ADR-006 benchmark — 이 두 데이터 자산이 Lab의 입력.

## 8. Operational burden

- A: 배치 파이프라인 + candidate 리뷰 UI. C: 0 (사람 시간으로 지불). B: 실험 인프라 운영 최대.

## 9. Migration difficulty

A → B는 promotion 게이트 자동화만 추가하면 됨 (단방향 진화). C → A는 Lab 구축 전체 — 단 trace/benchmark 데이터가 쌓여 있으면 착수 가능. **즉 MVP의 진짜 결정은 "지금 데이터를 Lab-ready로 쌓는가"이다.**

## 10. Recommendation

**단계적: MVP는 C(수동) + Lab-ready 데이터 규율, Phase 2에 A, Phase 4에 B의 부분 자동화.**

MVP(지금)에서 반드시 지킬 것 — 이 ADR의 실질 결정사항:

1. harness 구성요소 전부 버전 태깅 (`harness_version`이 agent_runs/traces/benchmark_runs에 기록) — 이미 스키마 반영.
2. 모든 실패는 trace에 분류 가능한 형태로 남김 (error 코드 체계).
3. benchmark 시나리오 포맷을 production trace에서 변환 가능하게 설계 (ADR-006).
4. promotion 개념을 MVP부터 사용: 수동 harness 변경도 benchmark 통과 후 `is_active` 전환 (§30 게이트의 수동 버전).

Phase 2에 A: weakness mining(LLM 기반 trace 분석) + candidate 생성 자동화, promotion은 사람.
Phase 4에 B 일부: 게이트 전 항목 자동 판정이 검증된 영역(예: 프롬프트 미세 변경)에 한해 자동 promotion — §31 never-allow 대상은 영구 수동.

## 11. Rejection reasons

- B 즉시 도입: 게이트 판정 신뢰가 없는 상태의 자동 promotion은 §30~31 위반 리스크. 비용도 2배.
- 순수 C 영구 유지: §53 moat(self-improving harness) 포기 — 전략적으로 불가.

## 12. Exit strategy

Lab의 개선 히트율이 낮으면 (candidate 중 promotion 도달 < 10% 지속): 자동 생성 범위를 축소하고 weakness mining 리포트만 사람에게 제공하는 반자동으로 후퇴. 데이터 자산(trace/benchmark)은 어느 경로든 유효.

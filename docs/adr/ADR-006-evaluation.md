# ADR-006: Evaluation

- **Status:** Proposed (Sprint 3 전 확정 — Proof 6 의존)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

Agent benchmark(§26), company-specific benchmark(§27), harness 비교(Proof 6), promotion 게이트(§30)를 구동할 evaluation 체계를 어떻게 구축할 것인가.

## 2. Requirements

- 시나리오 = fixture(입력 상태) + expected(기대 산출) + grading 방식 (개발기획서 §6.4)
- grading 혼합: deterministic validator / LLM judge / (Phase 2+) human feedback, business metric (§25)
- harness A/B를 동일 시나리오로 실행해 비교 리포트 (§29~30)
- production trace → 시나리오 변환 파이프라인 (§27 — historical operation을 regression dataset으로)
- CI 연동: system policy 위반 = 0 게이트

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. 자체 benchmark harness (`benchmarks/` + bench.* 테이블) | 시나리오 러너 + 채점기 자체 구현 |
| B. Braintrust | eval SaaS, 데이터셋/실험 관리 우수 |
| C. promptfoo | 오픈소스 eval 러너, config 기반 |
| D. Langfuse evals | trace 연계 eval |

## 4. Benchmark

Sprint 3에서 A로 시나리오 5개 + 2-harness 비교(Proof 6) 구현. 자체 구현이 3일을 초과하면 C(promptfoo)를 러너로 차용하는 하이브리드 검토.

## 5. Security

- 시나리오 fixture에 실 고객 데이터 포함 (§27) → tenant 격리 + 반출 금지가 하드 요구. SaaS(B)는 이 지점에서 감점. 익명화 파이프라인을 만들면 완화 가능하나 MVP 범위 밖.

## 6. Cost

- A: 초기 3~5일. LLM judge 호출 비용은 후보 공통.
- B: 좌석+볼륨 과금.

## 7. Vendor lock-in

- A: 없음. B: 데이터셋/실험 이력 종속 — **benchmark 자산은 moat(§53)이므로 외부 종속 자체가 전략 리스크**.
- C: 낮음 (config 파일).

## 8. Operational burden

- A: 러너 유지보수 — 단순 (실행→채점→기록 루프).
- B: 최소. C: 낮음.

## 9. Migration difficulty

시나리오를 `bench.benchmark_scenarios` (fixture/expected/grading) 포맷으로 소유하면 러너는 교체 가능. 시나리오 데이터 소유가 이 ADR의 핵심 보험.

## 10. Recommendation

**A. 자체 benchmark harness.**

- company-specific benchmark는 §53이 명시한 moat — 시나리오 포맷·채점 기준·이력 전부 우리 데이터여야 함 (§45 build 목록의 "Benchmark Framework").
- LLM judge는 LLM Gateway 경유(HIGH_REASONING), judge 프롬프트도 버전 관리.
- judge 신뢰도 검증: 초기 50건은 사람 채점과 대조해 judge 일치율 ≥ 90% 확인 후 신뢰 (오픈 이슈 #6).

## 11. Rejection reasons

- B Braintrust: 우수하나 moat 데이터 외부 종속 + 고객 데이터 반출.
- C/D 단독: 시나리오-그래프 fixture 로딩, promotion 게이트 등 우리 고유 요구를 커버 못함 — 차용은 가능하되 중심은 자체.

## 12. Exit strategy

러너가 병목이면 promptfoo 등 오픈소스 러너를 실행 계층으로 차용 — 시나리오/이력 데이터는 자체 테이블 유지. eval 결과 스키마(`benchmark_runs`) 불변이면 promotion 게이트 코드 무변경.

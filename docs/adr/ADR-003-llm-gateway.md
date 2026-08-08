# ADR-003: LLM Gateway

- **Status:** Proposed (Sprint 2 전 확정)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

멀티 프로바이더 LLM 호출, profile 기반 라우팅(§14~15), 비용/지연 추적, fallback을 담당할 게이트웨이를 자체 구축할 것인가, 기존 게이트웨이(LiteLLM, OpenRouter, Portkey 등)를 채택할 것인가.

## 2. Requirements

- logical profile(FAST/BALANCED/HIGH_REASONING/LOW_COST) → 모델 매핑, 무배포 교체
- per-call cost cap, tenant×agent 비용 집계, fallback
- structured output(zod schema), tool use, 스트리밍(Ask 화면) 3종 동시 지원
- 모든 호출이 traces에 기록 — Phase 4 historical routing의 데이터 원료 (§15)
- 라우팅 로직은 우리 IP — 외부 위임 불가 (§45 build 목록)
- PRIVATE/LOCAL profile 로드맵 (§14, §16)과 양립

## 3. Candidates

| 후보                                             | 요약                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| A. 자체 thin gateway (Anthropic/OpenAI SDK 직접) | `packages/llm` — profile 매핑 + fallback + 계측 |
| B. LiteLLM (proxy self-host)                     | 100+ 프로바이더 통일 API, 비용 추적 내장        |
| C. OpenRouter                                    | managed 멀티모델 API                            |
| D. Portkey / Helicone                            | gateway + observability SaaS                    |

## 4. Benchmark

Sprint 1 중 A 구현(예상 2~3일)과 B 설치 병행 비교: 스트리밍+tool use+structured output 동시 지원 품질, fallback 동작, 계측 데이터가 traces 스키마에 맞는 정도.

## 5. Security

- A: API 키와 데이터가 우리 인프라만 통과.
- B(self-host): 동일하나 컴포넌트 +1.
- C/D: 고객 데이터가 제3자 경유 — PRIVATE profile과 양립 불가.

## 6. Cost

- A: 개발 2~3일 + 유지보수 소량. B: 인스턴스 비용. C/D: 호출당 마진 — COGS 직결.

## 7. Vendor lock-in

- A: 없음 (SDK 2개 직접). B: 낮음(오픈소스)이나 proxy 설정 포맷 종속. C/D: 높음.

## 8. Operational burden

- A: 프로바이더 API 변경 추적 (SDK 2개 수준이면 경미). B: proxy 운영/업그레이드. C/D: 최소.

## 9. Migration difficulty

`llm.call()` 단일 진입점(개발기획서 §11.1)을 유지하는 한 내부 구현 교체는 어댑터 수준. 역방향도 동일.

## 10. Recommendation

**A. 자체 thin gateway.**

- 요구사항의 본질은 "많은 프로바이더 지원"이 아니라 "우리 라우팅 로직 + 우리 trace 스키마" — 이는 어차피 자체 코드가 필요하고, 남는 부분은 HTTP 호출 계층뿐이라 thin.
- 프로바이더는 Anthropic + OpenAI 2개로 시작. 3개 이상 필요 시(PRIVATE/LOCAL profile 도입) LiteLLM을 A의 하위 호출 계층으로 삽입 검토 — 라우터는 계속 우리 것.

## 11. Rejection reasons

- C OpenRouter / D Portkey: PRIVATE profile 로드맵과 충돌, COGS 마진, lock-in.
- B 단독 채택: 라우팅·budget·trace는 결국 자체 코드 필요 — MVP에선 proxy 운영만 더해지는 순부담.

## 12. Exit strategy

프로바이더 지원이 5개를 넘거나 로컬 추론 도입 시: `llm.call()` 아래에 LiteLLM 삽입. 라우팅/계측 코드는 무변경. 특정 SaaS gateway가 압도적으로 유리해지면 어댑터 하나로 편입.

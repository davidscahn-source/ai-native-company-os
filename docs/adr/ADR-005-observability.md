# ADR-005: Observability

- **Status:** Proposed (Sprint 3 전 1차 확정, 외부 툴은 Phase 1 중 재평가)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

Agent 실행 trace(§24), 비용 추적, connector health, 시스템 로그를 어떻게 수집·저장·조회할 것인가. 자체 traces 테이블 vs LLM observability SaaS(Langfuse, Braintrust, LangSmith) vs 범용 OTel 스택.

## 2. Requirements

- trace가 **제품 기능의 일부** — Audit/Runs UI(개발기획서 §16), evidence 링크, benchmark 입력으로 쓰임. 단순 디버깅 도구가 아님
- run→step 계층, tool call 전문, 토큰/비용/지연 (§24 전 항목)
- tenant 격리 필수 (trace에 고객 데이터 포함)
- benchmark·improvement lab이 trace를 데이터셋으로 재사용 (§27~28)

## 3. Candidates

| 후보                                         | 요약                     |
| -------------------------------------------- | ------------------------ |
| A. 자체 traces 테이블 (Postgres) + 자체 뷰어 | 개발기획서 §6.3 스키마   |
| B. Langfuse (self-host 가능)                 | LLM trace 특화, 오픈소스 |
| C. Braintrust / LangSmith                    | trace + eval SaaS        |
| D. 순수 OTel + Grafana/Tempo                 | 범용 스택                |

## 4. Benchmark

Sprint 2~3에서 A를 기본 구현하며 B를 병행 연동(계측 이중 전송)해 비교: 뷰어 품질로 절약되는 시간 vs 데이터 이중화 비용, tenant 격리 지원 수준.

## 5. Security

- A: 데이터가 우리 DB 밖으로 안 나감, RLS 그대로 적용.
- B self-host: 수용 가능, 컴포넌트 +1. B/C SaaS: 고객 데이터 반출 — sensitivity 'restricted' 이벤트 포함 시 부적합.

## 6. Cost

- A: 뷰어 UI 개발 비용 (기본 테이블 뷰면 2~3일). DB 용량은 trace 보존 정책(90일)으로 관리.
- B: self-host 인프라. C: 볼륨 과금.

## 7. Vendor lock-in

- A: 없음. B: 낮음. C: 중간 — trace 스키마 종속.

## 8. Operational burden

- A: 낮음 (기존 DB). D: Grafana 스택 운영은 현 팀 규모에 과함.

## 9. Migration difficulty

**traces 테이블을 canonical 저장소로 두고, 외부 툴은 export 대상**으로 취급하면 어떤 툴이든 나중에 붙였다 뗄 수 있음. 반대로 SaaS를 canonical로 삼으면 제품 기능(Audit UI, benchmark)이 종속됨.

## 10. Recommendation

**A. 자체 traces 테이블 = canonical, OTel 계측 표준 + 필요 시 Langfuse를 read-only 미러로.**

- trace는 제품 데이터(audit·evidence·benchmark 원료)이므로 우리 DB가 원본이어야 함.
- 개발자 편의 뷰어가 부족하면 Langfuse self-host를 미러로 추가 — 원본은 불변.

## 11. Rejection reasons

- C SaaS canonical: 고객 데이터 반출 + 제품 기능 종속.
- D 범용 스택: LLM trace 시맨틱(토큰/비용/tool call) 재구축 필요, 운영 부담.

## 12. Exit strategy

trace 볼륨이 Postgres에 부담이 되면(수억 row): 온도 분리 — 최근 90일은 Postgres, 이후 object storage(Parquet) 아카이브. 스키마 불변이므로 UI/benchmark 코드 영향 최소.

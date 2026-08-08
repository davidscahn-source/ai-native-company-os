# ADR-008: Company Graph

- **Status:** Proposed (Sprint 1 확정 — 스키마가 모든 것의 기반)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

제품의 핵심 IP인 Company Graph(§6)를 어떤 저장·조회 모델로 구현할 것인가. 전용 Graph DB vs relational.

## 2. Requirements

- entity 30+ 종, relationship 10+ 종, 시간성(valid_from/to), confidence/evidence 속성 (§43 연동)
- 핵심 쿼리: neighbors(depth≤2), pathBetween(depth≤4), impactedCustomers, timeline
- 이벤트와의 조인이 빈번 (graph 조회 결과에 최근 이벤트 붙이기)
- tenant 격리, 트랜잭션 (entity 생성 + source_link + relationship 원자성)
- Master Spec §44: relational로 시작, 임계점 넘으면 재검토 — 이 ADR은 그 결정의 공식화 + 임계점 정의

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. Postgres 테이블 (entities/relationships/events/source_links) + recursive CTE | §44 기본안 |
| B. Neo4j (Aura) | 전용 property graph |
| C. Apache AGE | Postgres 확장으로 Cypher |
| D. 임베디드 graph lib (메모리 로드) | 소규모 그래프를 앱에서 순회 |

## 4. Benchmark

Sprint 2에서 A로 핵심 쿼리 4종 구현, 합성 데이터(customer 5천, entity 5만, relationship 20만)로 p95 측정. pathBetween/impactedCustomers가 500ms를 넘으면 D(자주 쓰는 서브그래프 메모리 캐시) 보강 → 그래도 부족하면 B 벤치마크.

## 5. Security

- A: RLS + 기존 격리 테스트 그대로.
- B: 별도 시스템 격리 이중 구현 + 데이터 동기화 — 격리 검증 표면 확대.

## 6. Cost

- A: 0 추가. B: Aura 인스턴스 + ETL 파이프라인 구축·운영.

## 7. Vendor lock-in

- A: 없음. B: Cypher/모델 종속 중간. C: AGE 성숙도 종속.

## 8. Operational burden

- A: 없음. B: DB 시스템 +1, dual-write 정합성 관리 (실질적 최대 부담).

## 9. Migration difficulty

relationship이 명시적 테이블(암묵적 FK가 아니라)이므로 A → 전용 graph DB는 export/import가 기계적. 조회를 `packages/graph` API 뒤에 캡슐화 — 호출자는 저장 모델을 모름.

## 10. Recommendation

**A. Postgres 테이블 + `packages/graph` 캡슐화.** (§44 확정)

- MVP 그래프는 "수만 노드 / depth ≤ 4" — relational + recursive CTE의 전형적 적정 구간.
- graph 조회는 반드시 `packages/graph` API 경유 (raw SQL 산재 금지) — 이것이 나중의 이전 가능성 그 자체.
- **재검토 임계점 (정량):** ① pathBetween p95 > 500ms가 캐시 보강 후에도 지속, ② depth 5+ 쿼리가 제품 요구로 등장, ③ tenant당 relationship 1천만 초과 — 셋 중 하나면 B 벤치마크 착수.

## 11. Rejection reasons

- B Neo4j: 지금 도입하면 dual-write 정합성 + 격리 이중화 + 운영 부담을 미리 지불. 임계점 도달 전엔 순손실.
- C AGE: 성숙도/호스팅 제약. D 단독: durability 없음 (보조 캐시로만 의미).

## 12. Exit strategy

임계점 도달 시: relationships/entities를 Neo4j로 스트리밍 복제(CDC), 조회만 단계적으로 이전 (`packages/graph` 내부 라우팅). 쓰기 경로는 Postgres 유지 — graph DB는 read replica 역할부터. 완전 이전은 그 후에도 필요할 때만.

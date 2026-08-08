# ADR-007: Knowledge Store

- **Status:** Proposed (Sprint 5 전 확정 — memory 검색 도입 시점)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

Company Knowledge(§23 — 문서, 이메일, Slack, 정책)와 memories(§22)의 저장·검색(시맨틱 + 키워드) 기반. 전용 vector DB 도입 여부.

## 2. Requirements

- 임베딩 검색 + 키워드(FTS) 하이브리드
- tenant 격리 (RLS 동일 적용)
- 규모: tenant당 문서 수천~수만 chunk (초기) — 수억 벡터 아님
- §36: "Own vector database" 구축 금지 → managed/내장 사용
- ingestion과 action connector 분리 (§23) — 이 store는 read 전용 경로

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. pgvector (기존 Postgres) | documents/document_chunks/memories에 vector 컬럼 |
| B. Qdrant (managed) | 전용 vector DB |
| C. Pinecone | 전용 vector SaaS |
| D. Turbopuffer 등 저비용 신흥 | object-storage 기반 |

## 4. Benchmark

Sprint 5에서 A로 구현, tenant당 10만 chunk 합성 데이터로 p95 검색 지연 측정. 200ms 초과 시에만 B/C 벤치마크 진행.

## 5. Security

- A: 격리 모델이 본체 DB와 동일 — cross-tenant leakage 테스트 suite가 그대로 커버.
- B/C: 별도 시스템에 tenant 격리 이중 구현 필요 — §37 "zero cross-tenant leakage" 검증 표면 2배.

## 6. Cost

- A: 추가 비용 0 (기존 DB). B/C: 인스턴스/볼륨 과금.

## 7. Vendor lock-in

- A: Postgres 표준에 준함. C: 중간.

## 8. Operational burden

- A: 없음 (기존 운영에 포함). B/C: 시스템 +1, 동기화 파이프라인 관리.

## 9. Migration difficulty

임베딩과 chunk가 우리 테이블에 있으므로 (A) → 전용 DB는 재색인 배치 하나로 이전 가능. 검색 진입점을 `knowledge.search()` 단일 함수로 캡슐화해 교체 국소화.

## 10. Recommendation

**A. pgvector.**

- MVP 규모에서 성능 충분, 격리·운영·비용 전부 우위. §44(graph도 Postgres로 시작)와 동일한 철학.
- 하이브리드 검색: pgvector cosine + tsvector rank의 가중 결합, `knowledge.search()` 뒤에 캡슐화.

## 11. Rejection reasons

- B/C/D: 현 규모에서 얻는 것이 없고 격리 검증 표면과 운영 컴포넌트만 증가. 벡터 수가 tenant 합산 수천만을 넘는 시점의 문제를 미리 사는 것.

## 12. Exit strategy

p95 검색 지연 > 200ms 또는 벡터 수천만 돌파 시: managed Qdrant/Turbopuffer로 재색인 이전. `knowledge.search()` 인터페이스 불변, 이전 기간 동안 이중 쓰기.

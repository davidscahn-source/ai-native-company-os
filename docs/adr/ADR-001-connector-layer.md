# ADR-001: Connector Layer

- **Status:** Proposed (벤치마크 전 — Sprint 1 전 확정)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

MVP 커넥터 5종(Stripe, GitHub, Gmail, Slack, Sentry)의 연결·인증·backfill·webhook·실행을 어떤 기반 위에 구축할 것인가. 직접 구현 vs 통합 플랫폼(Composio, Pipedream, Nango, Merge) 채택.

## 2. Requirements

- 커넥터별 read/write scope 분리 (§23), credential tenant별 암호화 (§40)
- webhook + polling reconcile 모두 지원, idempotent ingestion
- raw payload 접근 필수 — canonical event 변환은 우리 레이어 (§7)
- 공통 인터페이스 뒤에서 구현 교체 가능 — vendor lock-in 금지 (§11)
- MVP 5종은 모두 1st-tier API 품질 (문서/SDK 우수)

## 3. Candidates

| 후보                                  | 요약                                       |
| ------------------------------------- | ------------------------------------------ |
| A. 자체 직접 구현 (provider 공식 SDK) | Connector interface + 5개 직접 구현        |
| B. Nango                              | OAuth/sync 인프라 오픈소스, self-host 가능 |
| C. Composio                           | agent-tool 특화, tool 카탈로그 큼          |
| D. Pipedream Connect                  | 커넥터 수천 개, 실행 인프라 포함           |
| E. Merge.dev                          | unified API — 카테고리 한정, 고가          |

## 4. Benchmark

Sprint 1 중 A vs B 실측: Stripe+GitHub를 각각으로 연결해 (1) backfill 처리량, (2) webhook 지연, (3) raw payload 보존 여부, (4) 구현 시간 비교. C/D는 read-heavy backfill 시나리오 부적합 판단 시 서류 탈락 허용.

## 5. Security

- A: credential이 우리 vault에만 존재 — 공격면 최소. 서명 검증 등 보안 코드를 직접 작성하는 부담.
- B(self-host): 유사하나 운영 컴포넌트 +1.
- C/D: 제3자에 tenant credential 위탁 — §41 least privilege 관점 감점, 엔터프라이즈 세일즈 시 실사 부담.

## 6. Cost

- A: 커넥터당 개발 2~4일 × 5. 런타임 비용 0.
- B: self-host 인프라 소액. D: MAU/실행 과금 — 스케일 시 COGS 직결.

## 7. Vendor lock-in

- A: 없음. B: 낮음(오픈소스). C/D: 중간~높음 — 커넥터 로직이 플랫폼 포맷에 종속.

## 8. Operational burden

- A: provider API 변경 추적을 우리가 담당 (5종이면 감당 가능, 50종이면 불가 — 그때 재검토).
- B: Nango 인스턴스 운영. C/D: 낮음.

## 9. Migration difficulty

공통 `Connector` interface(개발기획서 §9.1)를 지키면 어느 방향으로도 어댑터 교체로 이전 가능. interface 준수가 이 ADR의 실질적 보험.

## 10. Recommendation

**A. 자체 직접 구현** — MVP 5종 한정.

- raw payload 완전 접근이 canonical event/graph 품질의 전제.
- 5종은 모두 최상급 API — 통합 플랫폼의 가치(롱테일 커버리지)가 발생하지 않음.
- 단, 모든 구현은 `packages/connectors/core`의 공통 interface 뒤에. Phase 3 connector marketplace 시점에 B/C/D를 어댑터로 재검토 (§11의 MCP/Pipedream/Composio Adapter 슬롯).

## 11. Rejection reasons

- Merge.dev: 카테고리 불일치(HR/회계 중심), 고가.
- Composio/Pipedream: MVP에선 credential 위탁 리스크 > 롱테일 이득. 롱테일이 필요해지는 Phase 3에 어댑터로 부활 가능.
- Nango: 훌륭하나 5종 직접 구현 대비 절감 시간이 운영 컴포넌트 추가를 정당화 못함.

## 12. Exit strategy

커넥터 수요가 20종을 넘거나 유지보수가 스프린트의 20%를 초과하면: 기존 5종은 유지, 신규 롱테일은 Composio/Pipedream Adapter로 수용. interface 불변이므로 상위 레이어 무변경.

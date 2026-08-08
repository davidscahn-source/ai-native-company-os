# ADR-011: Compute

- **Status:** Proposed (Sprint 1 확정)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

web(UI/API), worker(sync/agent/workflow), DB의 호스팅 구성. 그리고 §16 compute abstraction(Managed/Private/Local AI) 로드맵과의 정합성.

## 2. Requirements

- web: SSR + 스트리밍(SSE), webhook 수신 (저지연)
- worker: long-running process (backfill 수 시간, agent 실행 수 분) — serverless 타임아웃 부적합
- 배포 단순 (1~2인 팀), preview 환경
- Phase 2+ : worker 수평 확장, region 고정 (data residency 예고)

## 3. Candidates

| 후보                                               | 요약                           |
| -------------------------------------------------- | ------------------------------ |
| A. Vercel (web) + Railway (worker) + Supabase (DB) | 현 팀 경험 스택                |
| B. Vercel + Fly.io (worker)                        | Fly가 region 제어 우수         |
| C. AWS 올인 (ECS/Fargate + RDS)                    | 단일 클라우드, enterprise 대비 |
| D. 단일 VPS (Hetzner 등) + Docker Compose          | 최저 비용                      |

## 4. Benchmark

불요 — 규모가 작아 기능/운영 비교로 충분. Sprint 1에서 A로 배포 파이프라인 구성, worker 재시작 시 durable workflow 재개(ADR-002와 연동) 확인.

## 5. Security

- 공통: DB 접근은 private network/IP allowlist, 시크릿은 플랫폼 env (ADR-010).
- C가 장기적으론 최강(VPC 통제)이나 현 단계 필수 아님. A/B는 표준 SaaS 보안 수준.

## 6. Cost

- A: 월 $50~150 (MVP). B: 유사. C: 유사하나 구축 인건비 큼. D: 최저 비용, 운영 리스크 최대.

## 7. Vendor lock-in

- 앱은 표준 Node/Docker — 어느 후보든 앱 레벨 lock-in 낮음. Vercel 특화 기능(edge 등) 사용 자제로 유지.

## 8. Operational burden

- A: 최저 (모두 managed, git push 배포). C: IaC/네트워킹 구축·유지. D: 백업/보안 패치/장애 대응 전부 자체.

## 9. Migration difficulty

worker를 Dockerfile로 유지하면 Railway↔Fly↔ECS 이동은 배포 설정 수준. web도 Next.js 표준 유지 시 self-host 가능. DB는 Postgres 표준 — pg_dump/논리 복제로 이전.

## 10. Recommendation

**A. Vercel + Railway + Supabase.**

- 배포 마찰 최소가 현 단계 최우선. worker는 Docker 이미지로 빌드해 이식성 확보.
- §16 compute abstraction은 **LLM 추론 계층**의 얘기 — 앱 호스팅과 분리해서 접근. Private AI/Customer VPC는 Phase 3에서 C 계열 재검토와 함께.

## 11. Rejection reasons

- C AWS 올인: 지금 구축 인건비가 이득을 압도. Phase 3 enterprise isolation 시점의 결정.
- D VPS: 백업·장애 대응 리스크가 절감액 대비 큼. B Fly: A와 대등 — 팀 경험 있는 Railway 우선, worker가 Docker라 언제든 전환 가능.

## 12. Exit strategy

Phase 3 enterprise/data residency 요구 시: worker+DB를 AWS(고객 region)로 이전 — Docker+표준 Postgres 유지가 이전 비용 상한. Private AI는 dedicated inference endpoint를 LLM Gateway profile로 추가 (앱 이전과 독립).

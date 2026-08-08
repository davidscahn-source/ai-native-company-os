# Milestones

> 진행 추적: 각 milestone의 GitHub tracking issue가 실시간 상태다. 이 문서는 exit criteria의 원본.
> 요구사항 기준선(RFP 역할)은 `docs/02-SPEC-v0.6.md`가 담당하며, 각 milestone은 해당 조항을 링크한다.

## M0 — 개발 환경 (완료 기준: 이 커밋)

- [x] 모노레포 scaffold (pnpm + turbo + TS strict + eslint + prettier + vitest)
- [x] CI (format/lint/typecheck/test) — PR과 main push에 강제
- [x] PR 템플릿 + 리뷰 게이트 정의 (SOP §4)
- [x] CLAUDE.md + SessionStart hook (모든 미래 세션 자동 세팅)
- [x] 거버넌스 문서: NORTH-STAR / SOP / MILESTONES
- [x] GitHub tracking issues 생성 (#1 #2 #3, Owner 준비물 #4)
- [ ] Owner 준비물: Stripe 테스트 키, GitHub App, Supabase 프로젝트, Anthropic 키 + 월 지출 상한

## M1 — Sprint 1: LLM 없는 뼈대 (목표: M0 + 1주)

스펙: v0.6 §31 Sprint 1, §20(스키마), §21.1(Sync Harness)

Exit criteria:

- [ ] DB 스키마 v1 (control._/data._ 논리 분리, 전 테이블 tenant_id)
- [ ] **Cross-tenant 침투 테스트 suite green** (기능보다 먼저)
- [ ] 공용 Sync Harness v1 (서명 검증·dedup·cursor·재시도) + fixture 테스트
- [ ] Stripe connector (test 모드) + GitHub connector — normalizer fixture ≥ 10종
- [ ] **Proof 1**: 실계정 Stripe+GitHub 연결 → entities 생성
- [ ] Deterministic gate: 전 코드 LLM 호출 0

## M2 — Sprint 2: 회사를 이해하는 DB (목표: M1 + 1주)

스펙: v0.6 §11(resolution), §20(graph API), v0.7 예정(Company State)

Exit criteria:

- [ ] Entity resolution v1 (결정적만, LLM 없음) + golden set 채점 절차
- [ ] Graph API 5종 (neighbors/timeline/pathBetween/impactedCustomers)
- [ ] **Company State projector + snapshot + delta** (LLM 0회)
- [ ] **Proof 2**: customer 1명 payment→ticket(mock)→issue 연결
- [ ] **Proof 5**: agent 실행 trace 저장·조회 (스켈레톤)
- [ ] Inngest vs Trigger.dev 벤치마크 → ADR-002 확정

## M3 — Sprint 3: 첫 AI (목표: M2 + 1주)

스펙: v0.6 §22(runtime), §24(gateway), §15.1(brief), §27(benchmark)

Exit criteria:

- [ ] LLM Gateway thin (비용 이벤트 day-1) — ADR-003 확정
- [ ] Founder Agent v1 + Morning Brief (evidence 하드 가드)
- [ ] Action Engine 최소 (risk 1 + approval) + Policy Engine 최소
- [ ] **Proof 3 / 4 / 6** + benchmark 시나리오 5개
- [ ] 신규 지표 4종 측정 시작 (understanding / evidence coverage / abstention P·R / cost per useful insight)

**Phase 0 게이트: Proof 6종 전부 통과 못 하면 Phase 1 착수 금지.**

## M4+ — Phase 1 (Local Alpha, 8주): v0.6 §32 스프린트 표를 따름

첫 dogfooding tenant: Owner 회사. 종료 조건 = v0.6 §34 수용 기준 실측.

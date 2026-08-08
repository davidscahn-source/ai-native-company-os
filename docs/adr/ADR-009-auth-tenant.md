# ADR-009: Auth / Tenant

- **Status:** Proposed (Sprint 1 확정)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

사용자 인증, 세션, tenant(회사) 멤버십·역할, 그리고 DB 레벨 tenant isolation(§40)을 어떤 스택으로 구현할 것인가.

## 2. Requirements

- email/OAuth 로그인, 세션 관리
- user ↔ tenant 다대다 (한 사람이 여러 회사), role: owner/admin/member
- **모든 데이터 접근에 tenant 격리 강제 — 단일 실수로 뚫리지 않는 이중 구조** (§37 zero leakage)
- Phase 2: RBAC 세분화, 초대 플로우. Phase 3: SSO/SAML (enterprise)
- 재인증(reauthentication) — Risk 4 action 요구 (§18)

## 3. Candidates

| 후보                            | 요약                                    |
| ------------------------------- | --------------------------------------- |
| A. Supabase Auth + Postgres RLS | DB와 통합, RLS 네이티브                 |
| B. Clerk                        | DX 최상, 멀티테넌시(Organizations) 내장 |
| C. Auth0 / WorkOS               | 엔터프라이즈 기능 (SSO/SCIM) 강점       |
| D. 자체 (Lucia 등 라이브러리)   | 완전 제어                               |

## 4. Benchmark

별도 벤치마크 불요 (기능 비교로 충분). Sprint 1에서 A로 구현하며 RLS 정책 + 앱 레벨 가드 이중화가 실제로 동작하는지 cross-tenant 테스트 suite로 검증.

## 5. Security

- 격리는 어느 후보든 **2중으로**: (1) Postgres RLS (`tenant_id = auth.tenant_id()`), (2) Drizzle tenant-scoped client (tenant_id 자동 주입 + raw query lint 금지). 인증 제공자는 이 구조 위의 신원 계층일 뿐.
- A: JWT claim에 tenant/role 포함 → RLS에서 직접 참조 가능 — 이중화 구현이 가장 자연스러움.
- B/C: 훌륭하나 RLS 연동에 커스텀 claim 브리지 필요.
- 재인증: sudo-mode 패턴 (비밀번호/OTP 재확인 후 15분 유효 토큰) — 후보 무관 자체 구현.

## 6. Cost

- A: Supabase 요금에 포함. B: MAU 과금 (초기 무료 구간 충분). C: 고가 (특히 Auth0).

## 7. Vendor lock-in

- A: 중간 — 단 사용자 테이블이 우리 Postgres에 있어 데이터 이전은 용이.
- B/C: 사용자 데이터가 외부 — export 가능하나 세션/플로우 재구축 필요.

## 8. Operational burden

- A: 낮음 (DB와 단일 벤더). B/C: 낮음. D: 높음 — 보안 민감 코드 직접 소유 (§45 buy 목록: Authentication).

## 9. Migration difficulty

인증 계층을 `getSession() → { userId, tenantId, role }` 단일 함수 뒤에 캡슐화하면 제공자 교체 시 앱 코드 영향 최소. Phase 3 SSO 요구 시 WorkOS를 **추가**(엔터프라이즈 tenant만 WorkOS 경유)하는 하이브리드가 전면 교체보다 현실적.

## 10. Recommendation

**A. Supabase Auth + RLS + 앱 레벨 이중 가드.**

- DB(ADR-008에서 Postgres/Supabase)와 단일 스택 — RLS 연동이 1급.
- 격리의 본체는 RLS+앱 가드 이중 구조이며 이는 제공자와 무관하게 우리가 소유.

## 11. Rejection reasons

- D 자체 구현: §45 buy 목록 — 인증은 미분화 보안 중노동.
- B Clerk: DX는 최고나 RLS 브리지 비용 + 스택 분산. C: 현 단계 과금 과잉, SSO는 Phase 3 문제.

## 12. Exit strategy

Phase 3 enterprise 요구 시: WorkOS를 SSO 게이트웨이로 추가 (Supabase Auth는 세션 계층 유지). Supabase 자체 이탈 시: users/memberships는 우리 테이블이므로 세션 계층만 재구축 — `getSession()` 캡슐화가 범위 상한.

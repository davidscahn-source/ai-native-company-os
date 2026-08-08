# ADR-010: Secret Management

- **Status:** Proposed (Sprint 1 확정 — Stripe 키 저장 전 필수)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

tenant별 connector credential(API key, OAuth token, webhook secret)의 저장·암호화·접근 통제 (§40~41). 그리고 우리 서비스 자체의 시크릿(LLM API key 등) 관리.

## 2. Requirements

- tenant별 credential 암호화 저장, 복호화는 connector 실행 컨텍스트에서만
- key rotation 가능 구조, 로그/trace 자동 마스킹
- OAuth refresh token 갱신 주기 처리
- agent가 credential에 접근 확대 불가 (§31)
- MVP 규모: tenant 수십 × provider 5 — 시크릿 수백 개 수준

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. 앱 레벨 envelope encryption (AES-256-GCM) + cloud KMS root key | credentials_encrypted 컬럼, DEK per tenant |
| B. HashiCorp Vault (self-host / HCP) | 업계 표준 시크릿 엔진 |
| C. Infisical / Doppler | 시크릿 관리 SaaS |
| D. Supabase Vault | pgsodium 기반 DB 내 암호화 |

## 4. Benchmark

불요 (규모가 작아 기능 비교로 충분). Sprint 1에서 A 구현 후 검증 항목: 복호화 경로가 CredentialVault 단일 모듈로 제한되는지, 로그 마스킹 동작, rotation 시나리오 리허설.

## 5. Security

- A: root key는 KMS(AWS KMS/GCP KMS)에만 존재, DB 유출 시에도 credential 안전. 복호화 chokepoint를 코드로 강제 — agent tool에서 vault 모듈 import 금지 (lint + §31 policy 이중).
- B: 최고 수준이나 Vault 자체가 고가용 운영 대상 — 뚫리면 전부 뚫리는 단일점의 운영을 우리가 짊어짐.
- D: 편리하나 DB와 암호화 경계가 같은 시스템 — KMS 분리 대비 격리 약함.

## 6. Cost

- A: KMS 호출 비용 미미 + 구현 2~3일. B: HCP 비용 or 운영 인건비. C: 구독.

## 7. Vendor lock-in

- A: KMS 교체는 root key re-wrap으로 가능 — 낮음. B/C: 중간.

## 8. Operational burden

- A: 거의 없음 (KMS는 managed). B: 높음. C/D: 낮음.

## 9. Migration difficulty

envelope 구조(DEK per tenant)면 → Vault 이전 시 DEK만 Vault transit로 옮기면 됨. 데이터 재암호화 불필요 (re-wrap만).

## 10. Recommendation

**A. 앱 레벨 envelope encryption + cloud KMS.**

- 시크릿 수백 개 규모에 Vault는 과잉. envelope + chokepoint 모듈 + 마스킹으로 §41 요구 충족.
- 우리 서비스 자체 시크릿(LLM key 등)은 배포 플랫폼 시크릿 (Vercel/Railway env) — tenant credential과 경로 분리.

## 11. Rejection reasons

- B Vault: 운영 부담이 현 팀 규모에서 보안 이득을 상회. Phase 3 enterprise(BYOK, 고객 KMS) 시 재평가.
- C: tenant-level 동적 시크릿에는 부적합 (배포 시크릿용에 가까움). D: KMS 분리 격리보다 약함.

## 12. Exit strategy

Phase 3에서 BYOK/데이터 residency 요구 시: DEK 계층을 Vault transit 또는 고객 KMS로 승격 — envelope 구조 덕에 데이터 재암호화 없이 root 교체만으로 이전.

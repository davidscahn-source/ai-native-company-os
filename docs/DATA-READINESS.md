# Data Readiness Gate

> **원칙:** 이 제품은 회사의 결제·고객·코드·대화 데이터를 모은다. 따라서
> **실데이터 도입 시점 자체가 하나의 보안 마일스톤**이며, 기능 마일스톤과
> 별개로 명시적 승인을 받아야 한다.
>
> 이 문서가 데이터 등급의 단일 소스다. 스펙·마일스톤 문서와 충돌하면
> **이 문서가 이긴다** (D-012).

## 데이터 단계 (Data Phases)

| Phase                              | 허용 데이터                                                                               | 금지                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| **Phase 0** — Technical Validation | synthetic fixtures + provider **sandbox/test-mode** API + 격리된 테스트 repo + 실 LLM     | 운영 데이터 일체                   |
| **Phase 1** — Local Alpha          | 통제된 dogfood tenant (의도적으로 만든 데이터). 내부 비민감 데이터은 **건별 승인 시에만** | 승인 없는 내부 데이터, 고객 데이터 |
| **Phase 2** — Private Beta         | 실제 고객 운영 데이터                                                                     | 아래 게이트 미충족 상태에서의 도입 |
| **Phase 3** — Commercial           | 프로덕션 멀티테넌트                                                                       | —                                  |

**현재 단계: Phase 0.**

## "실계정 연결"의 정확한 의미

마일스톤·스펙에서 말하는 커넥터 e2e 검증은 다음을 뜻한다:

- ✅ **실제 provider API** against **sandbox / test mode / 격리된 테스트 repo**
- ❌ 회사의 운영 Stripe 계정, 운영 GitHub org, 실제 고객 데이터

M3의 실모델 평가도 **frozen synthetic benchmark × real LLM**이면 충분하다.
실제 고객 데이터는 필요하지 않다.

## Phase 2 진입 게이트 (전부 충족해야 함)

- [ ] DPA / 개인정보 처리방침 / 데이터 보존·삭제 정책 문서화
- [ ] Credential 정책: per-tenant DEK + KMS (ADR-010 Phase 2 단계)
- [ ] Audit log: 누가·언제·어떤 테넌트 데이터를 읽었는지 재구성 가능
- [ ] 삭제 요청 처리 경로 (graph·events·insights·LLM ledger 전부)
- [ ] Incident response 절차 + 통지 기준
- [ ] LLM provider 데이터 처리 조건 확인 (학습 미사용, 보존 기간)
- [ ] Cross-tenant 침투 테스트가 프로덕션 드라이버(Supabase)에서 green
- [ ] Owner의 명시적 서면 승인 + `COMPANYOS_DATA_PHASE=beta` 설정

## 코드로 강제되는 부분 (prose가 아니라 control)

`packages/db/src/data-policy.ts` — credential 저장 chokepoint(`encryptCredential`)에서
알려진 **production 키 형식을 거부**한다. 기본값은 가장 보수적인 `phase0`이며,
운영 자격증명은 `COMPANYOS_DATA_PHASE=beta`를 명시적으로 설정해야만 통과한다.

### 이 통제의 정직한 한계

키 형식으로 구분 가능한 provider만 실제로 막힌다.

- **Stripe**: `sk_live_` / `rk_live_` / `pk_live_` / `whsec_live_` → **막힘**
- **GitHub / Slack / Gmail**: test-mode 키 형식이 **없다.** 회사 실제 워크스페이스
  토큰과 일회용 테스트 org 토큰은 바이트 단위로 구분 불가. → **키 형식으로 못 막는다.**
  이들은 설치/스코프 **allowlist**로 통제해야 하며, 가드 통과가 "테스트 리소스를
  가리킨다"는 증거가 **아니다.**

이 한계를 숨기지 않는 이유: 부분적 통제를 완전한 통제로 오인하는 것이
통제가 없는 것보다 위험하기 때문이다 (Operating Mandate — failure is information).

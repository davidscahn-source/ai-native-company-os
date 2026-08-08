## What

<!-- 한 문단: 이 PR이 무엇을 바꾸는가 -->

## Why

<!-- 어느 milestone/issue/스펙 조항에 대응하는가. 예: M1 / #3 / v0.6 §21.1 -->

## Verification

<!-- "됐다"는 주장 금지 — 증거만. -->

- [ ] 새/변경 로직에 테스트 추가, `pnpm check` green
- [ ] Deterministic gate: Sprint 1~2 코드에 LLM 호출 없음 (해당 시)
- [ ] tenant_id 격리 규칙 준수 — 신규 테이블/쿼리에 tenant scope (해당 시)
- [ ] /code-review 실행 및 finding 처리 (기능 PR)
- [ ] 보안 민감 변경(credential/webhook/auth) 시 /security-review 실행

## Out of scope

<!-- 이 PR이 의도적으로 하지 않는 것 -->

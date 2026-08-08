# SOP — Standard Operating Procedure

개발이 어떻게 진행되고, 품질이 어떻게 보장되고, 진행 상황이 어떻게 보이는지에 대한 표준 절차.
이 문서는 사람과 Claude 세션 모두에게 적용된다.

## 1. 역할

| 역할               | 담당                                                      |
| ------------------ | --------------------------------------------------------- |
| Owner (founder)    | 방향·우선순위 결정, 지출 승인, PR merge, 주간 브리핑 수신 |
| Claude (개발 위임) | 구현·테스트·리뷰·문서·진행 보고. 아래 SOP의 실행 주체     |

Claude가 Owner에게 가져가는 결정은 3종뿐: **(a) 돈이 나가는 것 (b) 외부에 노출되는 것 (c) 제품 방향.**
나머지는 Claude가 결정하고 PR에 근거를 남긴다.

## 2. 작업 단위와 흐름

```
Milestone (docs/MILESTONES.md)
  → GitHub tracking issue (sprint 단위)
    → PR (작업 단위, 브랜치 claude/<topic>)
      → CI green + 리뷰 게이트 → merge → tracking issue 체크
```

- 모든 코드 변경은 PR. main 직접 push는 문서/환경 설정만.
- PR은 작게 (리뷰 가능한 단위 — 목표 < 500줄 diff).
- PR 본문은 `.github/pull_request_template.md` 체크리스트를 계약으로 삼는다.

## 3. Definition of Done

기능은 다음을 모두 만족해야 "done":

1. 테스트가 동작을 증명 (신규 로직 = 신규 테스트, normalizer 등은 fixture 테스트)
2. `pnpm check` green (lint + typecheck + test) — CI가 강제
3. 리뷰 게이트 통과 (§4)
4. 스펙 조항/milestone에 링크됨 (어느 요구사항의 구현인지 추적 가능)
5. 해당 시: SPEC DEVIATION 명시, 스키마 변경은 tenant 격리 테스트 갱신

"코드는 됐는데 테스트는 나중에"는 done이 아니다.

## 4. 리뷰·검증 게이트 (코드 완벽성 장치)

| 게이트             | 시점                                        | 도구                                                                     |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| 정적 검증          | 모든 push                                   | CI: prettier + eslint + tsc strict + vitest                              |
| 코드 리뷰          | 기능 PR merge 전                            | `/code-review` (별도 세션의 적대적 리뷰) — finding은 수정 또는 반박 기록 |
| 보안 리뷰          | credential/webhook/auth/tenant 격리 변경 시 | `/security-review`                                                       |
| 격리 침투 테스트   | 스키마/쿼리 변경 시                         | cross-tenant 테스트 suite (Sprint 1에서 구축)                            |
| Deterministic gate | Sprint 1~2 전체                             | LLM 호출 grep — CI에 검사 추가 예정                                      |

리뷰 finding 처리 원칙: 수정하거나, 왜 수정하지 않는지 PR에 기록하거나. 무시는 없다.

## 5. 진행 모니터링 (계획 대비 구현 추적)

- **Single source of truth**: GitHub tracking issues (sprint별) + `docs/MILESTONES.md`의 exit criteria.
- Claude는 작업 세션마다 tracking issue의 체크리스트를 갱신한다 — issue를 보면 현재 상태가 보인다.
- **주간 브리핑** (매주 금요일, Owner에게):
  1. 이번 주 완료 (merge된 PR 링크)
  2. Milestone 대비 상태 (on-track / at-risk / blocked + 이유)
  3. 다음 주 계획
  4. 결정 요청 (있으면 — 3분 내 답할 수 있는 형태로)
  5. 지출 현황 (인프라 + LLM, 상한 대비)
- Milestone exit criteria가 위험해지면 **금요일을 기다리지 않고 즉시 보고.**

## 6. 스펙 변경 절차

- 구현 중 스펙 결함 발견 → PR에 SPEC DEVIATION 기록 → 주간 브리핑에서 승인 → 스펙 문서 갱신.
- 기술 선택 변경은 해당 ADR 개정이 선행 (benchmark 근거 필요).
- `docs/03-VISION-EXPANSION.md`는 범위 확장의 근거가 될 수 없다 (non-normative).

## 7. 사고 대응

- CI red인 채로 main에 두지 않는다 — 1시간 내 수정 또는 revert.
- credential 노출 의심 시: 즉시 해당 키 rotate → audit → Owner 보고.
- 데이터 파괴적 마이그레이션은 dry-run + 백업 확인 없이 실행 금지.

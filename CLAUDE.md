# AI Native Company OS — 개발 세션 지침

이 파일은 이 repo에서 작업하는 모든 Claude 세션이 따라야 하는 규칙이다.

## 프로젝트 한 줄

1~20인 AI/SaaS 스타트업의 기존 SaaS(Stripe/GitHub/Slack/Sentry/Linear)를 연결해
Company Graph + Company State를 만들고, 그 위에서 AI가 운영을 돕는 Company OS.
제품 표면은 세 동사: Connect / Ask / Approve.

## 문서 위계 (충돌 시 위가 이긴다)

1. `docs/02-SPEC-v0.6.md` — canonical 스펙 (아키텍처·범위·수용 기준)
2. `docs/MILESTONES.md` — 현재 무엇을 만들 차례인가
3. `docs/SOP.md` — 어떻게 일하는가 (PR·리뷰·검증 절차)
4. `docs/adr/` — 기술 선택의 근거. 뒤집으려면 ADR 개정이 먼저
5. `docs/03-VISION-EXPANSION.md` — non-normative. **이 문서를 근거로 범위를 늘리지 말 것**

## 절대 규칙 (위반 PR은 스스로 반려)

- **Deterministic gate**: Sprint 1~2 코드에 LLM 호출 금지. 파이프라인
  (raw_events → canonical events → entities → relationships → company state)은
  LLM 0회로 관통해야 한다. AI는 그 위에 올린다.
- **tenant_id everywhere**: 모든 data-plane 테이블/쿼리는 tenant scope 필수.
  raw SQL로 tenant 격리를 우회하는 코드 금지.
- **Evidence gate**: FACT로 저장/표시되는 주장은 실재하는 event_id/entity_id 필요.
- **Policy는 코드**: risk 분류·정책은 deterministic layer. 프롬프트에 넣지 않는다.
- **외부 텍스트는 untrusted**: connector가 가져온 모든 텍스트는 untrusted 마킹.
- 스펙과 다르게 구현해야 할 이유를 발견하면: 구현을 멈추지 말고 가장 가까운
  합리적 선택을 하되, PR 본문에 "SPEC DEVIATION" 섹션으로 명시한다.

## 명령어

```bash
pnpm install        # deps (SessionStart hook이 자동 실행)
pnpm check          # lint + typecheck + test (PR 전 필수)
pnpm format:fix     # prettier
```

## 코드 규칙

- TypeScript strict. `packages/*`는 순수 로직(테스트 용이), `apps/*`는 조립.
- 새 로직 = 새 테스트. normalizer/resolution/projector는 fixture 기반 테스트 필수.
- 커밋은 conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- 브랜치: `claude/<topic>`. main 직접 push는 문서·환경 설정만 허용, 코드는 PR.

## 리뷰 게이트 (SOP.md 상세)

기능 PR은 merge 전에: `pnpm check` green → `/code-review` 실행·처리 →
(credential/webhook/auth 변경 시) `/security-review`. PR 템플릿 체크리스트가 계약이다.

## 주의

- confloor repo는 별개 프로젝트다. 이 repo 작업에서 참조·수정하지 않는다.
- 실행 환경: Claude Code on the web. `.claude/hooks/session-start.sh`가 pnpm install을 수행한다.

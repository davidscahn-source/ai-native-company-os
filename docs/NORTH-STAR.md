# North Star

## Promise

> **Connect your company. AI operates the rest.**

사용자가 이해해야 하는 것은 Connect / Ask / Approve 세 동사뿐이다.

## North Star Metric

**주 1회 이상 Founder Brief를 근거로 실제 행동(approve, 연락, 수정)을 한 활성 founder 수.**

- 대리 지표가 아니라 "신뢰받는 운영 도구가 되었는가"를 직접 측정한다.
- 보조 지표: time-to-first-brief (가입 → 첫 brief, 목표 < 24h), brief 항목 acknowledge율.

## Guardrail Metrics (하나라도 깨지면 성장 작업 중단)

| Guardrail                   | 기준                          | 근거                                 |
| --------------------------- | ----------------------------- | ------------------------------------ |
| Entity resolution precision | ≥ 95% (deterministic ≥ 99.5%) | 오연결은 잘못된 인과 서사를 만든다   |
| Evidence coverage           | critical insight 100%         | 신뢰의 최소 단위                     |
| Abstention 오류             | 답 못할 것을 답함 = 0 목표    | 자신 있는 오답 한 번이 신뢰를 부순다 |
| Cross-tenant leakage        | 0                             | 존재의 전제                          |
| Tenant당 LLM COGS           | 실측 후 $20/월 이하           | 사업 성립 조건                       |

## Non-goals (영구)

CRM/회계/이메일 클라이언트/observability 백엔드/foundation LLM을 만들지 않는다.
사용자에게 workflow builder를 노출하지 않는다. AI 설정을 요구하지 않는다.

## 판단 기준

기능 논쟁이 생기면 이 질문으로 정리한다:
**"이것이 founder가 brief를 신뢰하고 행동하는 데 기여하는가?"** 아니면 하지 않는다.

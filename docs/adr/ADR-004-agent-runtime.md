# ADR-004: Agent Runtime

- **Status:** Proposed (Sprint 2 전 확정)
- **Date:** 2026-08-08
- **Deciders:** Founder

## 1. Problem

AgentDefinition(§12) 기반 실행 루프 — context assembly, tool call, policy hook, budget, trace — 를 자체 구현할 것인가, 프레임워크(LangGraph, Claude Agent SDK, Mastra 등)를 채택할 것인가.

## 2. Requirements

- AgentDefinition 전 필드(allowed/prohibited tools, budgets, approval/escalation policy)가 **코드 레벨로 강제** — 프롬프트 강제 불가
- 모든 tool call 전 Policy Engine pre-check hook (§13, 개발기획서 §13.3)
- risk 2+ tool은 실행 대신 action(awaiting_approval) 생성 — 루프는 계속 진행
- step별 trace 기록 (§24), evidence 하드 가드 (개발기획서 §10.2)
- harness versioning — 같은 agent를 다른 harness로 실행해 benchmark 비교 (§29, Proof 6)

## 3. Candidates

| 후보 | 요약 |
|---|---|
| A. 자체 실행 루프 (LLM Gateway 위에 직접) | 명시적 루프 + 훅 |
| B. LangGraph (JS) | 그래프 기반 orchestration, 생태계 큼 |
| C. Claude Agent SDK | Anthropic 공식, 루프/tool 관리 내장 |
| D. Mastra 등 신흥 TS 프레임워크 | TS-native agent 프레임워크 |

## 4. Benchmark

Sprint 2에서 A로 Founder Agent 스켈레톤 구현 (예상 3~4일). 구현 중 policy hook·approval 분기·trace 주입이 자연스러운지 확인. 프레임워크는 동일 요구를 끼워 넣는 PoC 각 1일 — hook 지점이 막히면 즉시 탈락.

## 5. Security

- 핵심 보안 요구(§31 — agent의 자기 권한/policy/audit 수정 불가)는 tool 레지스트리 + policy가 담당. 어떤 후보든 **tool 실행 경로가 단일 chokepoint를 통과**해야 함. A는 이를 구조적으로 보장하기 가장 쉬움. 프레임워크는 내부 우회 경로 존재 여부를 감사해야 함.

## 6. Cost

- A: 초기 개발 ~1주 + 루프 개선 지속 비용. B/C/D: 학습 + 프레임워크 업그레이드 추종 비용.

## 7. Vendor lock-in

- A: 없음. B: 중간 — LangChain 생태계 종속. C: 중간 — 모델 비종속 원칙(§14)과 긴장. D: 성숙도 리스크 포함 중간.

## 8. Operational burden

- A: 루프 버그를 직접 소유 — 대신 디버깅 표면이 전부 우리 코드.
- B/C/D: 프레임워크 이슈/버전 추적 필요.

## 9. Migration difficulty

Agent의 실질 자산은 (1) AgentDefinition 데이터, (2) tool 레지스트리, (3) 프롬프트/컨텍스트 전략. 셋 다 런타임 중립으로 설계하면 루프 교체는 국소적. A→B/C 이전은 쉬운 편, 역방향은 프레임워크 관용구 제거 필요.

## 10. Recommendation

**A. 자체 실행 루프.**

- 이 제품에서 agent 루프는 미분화 중노동이 아니라 **harness = 핵심 IP** (§29, §53 moat의 self-improving harness). §45 build 목록과 일치.
- policy hook / approval 분기 / evidence 가드 / harness versioning은 전부 루프 내부 훅 — 자체 루프가 가장 직선적.
- 단, Claude Agent SDK 등의 설계 패턴(tool result 처리, context compaction)은 적극 차용.

## 11. Rejection reasons

- B LangGraph: 그래프 추상화가 단순 루프+훅 구조 대비 과잉, 정책 chokepoint 감사 부담.
- C Agent SDK: 품질 우수하나 모델 비종속 원칙·harness 버저닝 요구와 긴장.
- D: 성숙도.

## 12. Exit strategy

루프 유지보수가 병목이 되면: tool 레지스트리/policy hook 인터페이스를 유지한 채 실행 코어만 프레임워크로 치환. AgentDefinition·benchmark 데이터는 그대로 유효 — 치환본을 harness 버전 하나로 취급해 Proof 6 방식으로 신구 비교 후 promotion (§30).

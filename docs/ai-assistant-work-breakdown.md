# AI 어시스턴트 — 작업 배분

로드맵 8번 항목을 한 번에 처리하기엔 범위가 크므로, **요청 6~7번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`plsql-work-breakdown.md`](./plsql-work-breakdown.md) · [`explorer-work-breakdown.md`](./explorer-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- 레이아웃 **AI Chat** 패널(auxiliary bar) 표시·숨김·크기 저장 — [`layoutService`](../packages/silk-workbench/src/services/layout/layoutService.ts), Toggle AI Chat
- Settings **AI** 섹션 — `ai.enabled` / `ai.provider` / `ai.model` / `ai.customBaseUrl` / context 플래그 / `ai.allowExecute`
- Provider·모델 프리셋 — [`aiSettingsConstants`](../packages/silk-workbench/src/services/settings/aiSettingsConstants.ts) (**gemini** 기본 · openai / anthropic / custom)
- API 키 — OS 키링 provider별 슬롯 ([`AiSecretService`](../packages/silk-workbench/src/services/ai/aiSecretService.ts)); 평문 `ai.apiKey`는 1회 마이그레이션 후 제거
- Provider 클라이언트 — Gemini / OpenAI / Anthropic / Custom OpenAI-compatible ([`aiProviderService`](../packages/silk-workbench/src/services/ai/aiProviderService.ts)), Settings **Test connection**
- [`SecondarySidebar`](../packages/silk-workbench/src/components/layout/SecondarySidebar/SecondarySidebar.tsx) — ready 상태 안내 (Chat UI는 8-B)
- SQL 실행·가드 — `QueryExecutionService`, `sqlGuard`, `database.readOnly` (4·5번)
- 스키마·선택·히스토리 원천 — 연결(3) · 에디터(4) · 탐색기(6) · 쿼리 히스토리(4)
- **미구현**: 채팅 UX·스트리밍 UI(8-B), NL→SQL 검수·실행·해석(8-C~E), 감사·비용(8-F)
- **이후**: PL/SQL AI 수정 루프 — [`plsql-work-breakdown.md`](./plsql-work-breakdown.md) **7-F** (본 문서 완료 후)

### v1 범위

- **1차 provider**: **Google Gemini** (기본값 권장) — AI Studio BYOK, Free Tier로 개발 가능
- **동시 지원**: OpenAI / Anthropic / OpenAI-compatible custom
- **1차 플로우**: 자연어 → SQL 제안 → 사용자 검수 → (선택) 실행 → 결과 해석
- v1에서 **넣지 말 것**: 서버 프록시·우리 측 API 키 제공, 멀티에이전트, 자동 DB 쓰기, 7-F PL/SQL 컴파일 수정 루프
- 과금 안내: Free Tier는 프로젝트 단위 RPM/TPM/**RPD(일)** 한도 · 초과 시 429(중지). **빌링 미연결**이면 초과분 자동 과금 없음. 월 한도는 유료(Spend Cap) 쪽.

---

## 진행 순서

```
8-A  BYOK · Provider 클라이언트 · 키 안전 저장
 → 8-B  AI Chat UI · 멀티턴 · 스트리밍
 → 8-C  컨텍스트 조립 (스키마·선택·히스토리)
 → 8-D  자연어→SQL 제안 · Diff/삽입 검수
 → 8-E  실행 권한 분리 · 결과 해석
 → 8-F  감사·비용·세션 (선택/후속)
 → (이후) 7-F PL/SQL AI 수정 루프
```

- **8-A** 또는 **8-A + 8-B**까지가 한 채팅 상한에 가깝다.
- **8-C / 8-D / 8-E**는 각각 **단독 요청** 권장.
- **8-F**는 제품화에 가깝게 미뤄도 로드맵 8의 “본편”(8-E까지)은 성립한다.
- **7-F**는 8번과 같이 설계하지 않으면 범위가 다시 커진다 — **본 문서 이후**.

---



## 8-A. BYOK · Provider · 키 안전 저장

**상태:** 완료

**의존성:** Settings AI(로드맵 2). 연결 비밀번호 키링 패턴 재사용 가능

### 범위

- `AiProviderId`에 **`gemini`(또는 `google`)** 추가, Settings 기본 provider를 Gemini로
- API 키를 configuration 평문(`ai.apiKey`)에서 **OS 키링**으로 이전 (연결 시크릿과 동일 계열)
  - provider별 키 슬롯(권장) 또는 활성 provider 키 1개 + 전환 시 재입력
- Settings UI: 키 입력·마스킹·삭제, 저장 위치 안내
  - Gemini: Free Tier / 빌링 연결 시 과금 가능 안내(짧게)
- Provider 클라이언트 골격
  - **Google Gemini** (Generative Language / AI Studio API) — **v1 1차·기본**
  - OpenAI Chat Completions (또는 Responses) API
  - Anthropic Messages API
  - Custom: OpenAI-compatible base URL + 키
- Gemini 모델 프리셋 예: Flash 계열(Free Tier에 맞는 ID는 구현 시 AI Studio 기준으로 확정)
- `ai.enabled` / 키 / 모델 없으면 Chat·호출 차단 + 안내
- 429 / quota 초과 시 사용자 메시지 (Free면 “한도 초과·과금 없음” 안내 가능)
- (선택) “연결 테스트”: 키·모델 ping

### 완료 기준

- Settings에서 Gemini를 고르고 키를 저장한 뒤 호출 클라이언트가 동작함
- 재시작 후에도 Chat/호출이 키를 쓸 수 있음
- 평문 `ai.apiKey`에 의존하지 않음 (마이그레이션 1회 허용)
- OpenAI / Anthropic / Custom도 동일 인터페이스로 선택 가능
- provider·model 설정이 클라이언트에 반영됨

### 요청 문구 예

> AI BYOK를 키링에 안전하게 저장하고, Gemini를 기본 provider로 추가해줘. OpenAI/Anthropic/Custom도 함께 지원하고 Settings AI와 연동.

---

## 8-B. AI Chat UI · 대화 루프

**상태:** 미구현

**의존성:** 8-A

### 범위

- `SecondarySidebar`를 실제 채팅 UI로 교체
  - 메시지 목록 · 입력 · 전송 · **스트리밍** · 취소 · 에러 표시
- 세션(대화) 모델 — v1: 메모리 또는 localStorage (단순)
- `ai.enabled` off / 키·모델 없음 → 입력 비활성 + Settings 링크
- 커맨드: `silk.ai.focusChat` (Toggle AI Chat은 기존 유지)
- DB/SQL **실행·삽입은 아직 없음** (채팅만)



### 완료 기준

- 패널에서 질문 → 설정한 provider/model로 스트리밍 응답
- 구성 미완료 시 명확한 안내



### 요청 문구 예

> AI Chat 패널에 멀티턴 채팅 UI를 넣고, 설정한 provider/model로 스트리밍 응답을 받아줘.

---



## 8-C. 컨텍스트 조립

**상태:** 미구현

**의존성:** 8-B, 연결·SQL 에디터·탐색기·쿼리 히스토리(3·4·6)

### 범위

- `ai.context.includeSchema` → 현재 연결·스키마 요약 (테이블/컬럼 일부, **토큰 상한·truncate**)
- `ai.context.includeSelection` → 활성 에디터 선택 또는 전체
- `ai.context.includeQueryHistory` → 최근 실행 SQL 일부
- 시스템 프롬프트: dialect·역할(“Silk DB Studio SQL 어시스턴트”)
- (선택) 보낼 컨텍스트 미리보기/요약 UI



### 완료 기준

- 플래그 on/off에 따라 요청 페이로드가 달라짐
- 메타데이터 폭주로 요청이 실패하지 않게 상한 적용



### 요청 문구 예

> AI 요청에 스키마·선택 코드·쿼리 히스토리 컨텍스트를 설정 플래그대로 조립해 붙여줘.

---



## 8-D. 자연어 → SQL 제안 · 검수

**상태:** 미구현

**의존성:** 8-C

### 범위

- 응답에서 SQL 블록 추출 (펜스 / `sql` 코드)
- **검수 UX** (자동 실행 없음)
  - Diff 미리보기, 또는
  - “에디터에 삽입” / “새 SQL 탭” / “클립보드”
- `database.readOnly` · `sqlGuard`와 맞춘 위험 SQL 경고
- 후속 턴: “이 SQL 수정해줘”



### 완료 기준

- NL → SQL 제안 → **사용자 확인 후에만** 에디터 반영
- 이 단계에서는 DB에 쓰지 않음



### 요청 문구 예

> 자연어로 SQL을 제안받고, diff/삽입 확인 후에만 에디터에 넣어줘. 자동 실행은 하지 마.

---



## 8-E. 실행 권한 분리 · 결과 해석

**상태:** 미구현

**의존성:** 8-D, `QueryExecutionService`(4·5)

### 범위

- `ai.allowExecute === false`(기본): 실행 UI 없음 또는 차단 + 안내
- `true`일 때만: 제안 SQL **실행 확인 다이얼로그** → `query.execute`
- `database.readOnly`와 이중 가드 (쓰기는 추가 확인)
- 실행 후: 결과 요약·오류 해석을 채팅에 이어 붙이기



### 완료 기준

- allowExecute off → 실행 불가
- allowExecute on → **확인 없이 실행하지 않음**
- 실행 결과를 채팅에서 해석할 수 있음



### 요청 문구 예

> ai.allowExecute와 read-only를 지켜서, 확인 후에만 AI 제안 SQL을 실행하고 결과를 채팅에서 해석해줘.

---



## 8-F. 감사 · 비용 · 세션 (선택/후속)

**상태:** 미구현

**의존성:** 8-B~8-E

### 범위

- 로컬 호출 로그: 시각 · provider · model · 토큰(가능 시) · 성공/실패
- 대략 비용 표시 (v1 러프 단가 테이블)
- 대화 Clear / (선택) Export
- Settings에서 “감사 로그 보기” 수준



### 완료 기준

- 최근 AI 호출을 앱에서 확인 가능
- API 키·불필요하게 긴 프롬프트를 로그에 남기지 않음



### 요청 문구 예

> AI 호출 감사 로그와 대략 비용·토큰을 로컬에 남기고 Settings에서 볼 수 있게 해줘.

---



## 같이 넣지 말 것


| 항목                                 | 归属                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------- |
| PL/SQL 컴파일 오류 → AI 수정 → diff → 에디터 | **7-F** (`[plsql-work-breakdown.md](./plsql-work-breakdown.md)`, 8번 이후) |
| 일반 SQL 문법·포맷·실행 UX                 | **4번**                                                                  |
| 결과 그리드                             | **5번**                                                                  |
| 탐색기 DROP/Rename·Open Data          | **6번**                                                                  |
| 서버 프록시 / 벤더 대납 키                   | v1 비범위 (BYOK만)                                                          |
| 자동 업데이트·번들 JRE·CI                  | **9번**                                                                  |


탐색기·PL/SQL·AI 본편을 한 요청에 섞지 않는다.

---



## 로드맵 한 줄과의의 매핑


| 로드맵 문구  | 주로 담당                               |
| ------- | ----------------------------------- |
| 자연어→SQL | 8-C · 8-D                           |
| 검수      | 8-D                                 |
| 실행→해석   | 8-E                                 |
| 권한 분리   | 8-E (`ai.allowExecute` · read-only) |
| BYOK/모델 | 8-A (Gemini 기본 · Settings는 2번에 골격) |
| 컨텍스트    | 8-C                                 |
| 감사·비용   | 8-F                                 |


**8-E까지** 완료하면 로드맵 8번 본편으로 본다. **8-F**는 후속·제품화 병행 가능.
# 다중 DB 세션 — 작업 배분

로드맵 **3. DB 연결 관리**의 후속이자, 실행·결과 UX의 전제다.  
**MC-A~F 완료:** 여러 JDBC 세션을 동시에 열고, SQL 탭마다 접속 바인딩·결과를 가질 수 있다.

각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)와 동일)

## UX 결정 (고정)

대화에서 합의한 원칙이다. 구현·리뷰 시 이 기준을 우선한다.

| 항목 | 결정 |
|------|------|
| 진실의 원천 | **에디터(SQL) 탭마다** 접속 바인딩 + **그 탭 소유의 결과** |
| 실행 대상 표시 | **상태바(하단 바)가 공식 UI** — 포커스된 탭의 `프로필 › 스키마(또는 DB)` |
| 보조 표시 | 탭 툴팁·짧은 suffix 또는 에디터 칩 (상태바만으로 놓치는 스플릿 보완) |
| 상태바 클릭 | **현재 탭 바인딩만** 변경. “모든 SQL 탭에 적용”은 명시 액션 |
| 새 SQL 탭 | 전역 “기본/마지막 접속”으로 바인딩 초기화 |
| 끊김 | 바인딩 유지 + `Disconnected` 표시. 다른 접속으로 조용히 갈아타지 않음 |
| 쿼리 결과 | **에디터 탭끼리 공유하지 않음**. 한 탭의 다중 결과 서브탭은 그 탭 소유. 다른 탭 실행이 기존 탭 결과를 지우지 않음 |
| 탐색기 ● | “열려 있는 세션들” 표시. Run 대상의 진실은 상태바·탭 바인딩 |

한 줄 요약: **탭 = 세션 컨텍스트** (접속 + 결과).

---

## 현재 상태 (기준)

MC-A~F 완료 시점 기준:

- 다중 JDBC 세션 + 탭 바인딩 + 상태바 실행 대상 + 실행/결과 탭 스코프 + 탭 suffix·적용 전체
- 세부: 아래 MC-A…F 구현 메모

### 초기 갭 (작업 시작 전 — 참고용)

- 프로필 CRUD·저장: [`ConnectionService`](../apps/silk-db-studio/src/services/connection/connectionService.ts) — `connectedProfileId` **단수**였음
- 연결 시 기존 접속 disconnect 후 교체
- Agent / query에 connectionId 없음, 결과 전역 공유, 상태바 미표시

### v1 범위 / 비범위

| 넣음 | 넣지 않음 (이후) |
|------|------------------|
| 동시 다중 JDBC 세션 | 연결 풀·세션 수 상한 UX 고도화 |
| 에디터 탭 ↔ 프로필(+스키마) 바인딩 | 트랜잭션을 탭 간에 공유 |
| 상태바 피커 + 끊김 표시 | 원격 공유 워크스페이스 동기화 |
| 에디터 탭별 결과 소유·패널 전환 | 결과 패널을 에디터 옆에 고정 도킹(별도 레이아웃) |
| 실행/메타데이터/cancel에 connectionId | 한 쿼리에서 여러 DB 조인(FDW 등) |

---

## 진행 순서

```
MC-A  프로토콜·Agent·Tauri: connectionId 다중 세션
 → MC-B  ConnectionService: 다중 connected + 탭 바인딩 모델
 → MC-C  상태바(실행 대상) + 탐색기 다중 ●
 → MC-D  실행 경로가 탭 바인딩·connectionId 사용
 → MC-E  에디터 탭별 결과 소유 (전역 결과 공유 제거)
 → MC-F  (선택) 탭 칩/툴팁·“모든 탭에 적용”·회귀·문서
```

MC-A가 없으면 UI만으로는 가짜 다중 접속이 된다.  
MC-E는 MC-B/D와 맞물리나, UI 뼈대(MC-C) 뒤에 두어 “표시 → 실행 → 결과 격리” 순으로 검증하기 쉽게 한다.

---

## MC-A. Agent / 프로토콜 다중 세션

**상태:** 완료 (본 요청)

**의존성:** 없음 (기반)

### 범위

- jdbc-agent: `Map<connectionId, Connection>` (또는 동등). `connection.open`이 id를 반환·유지
- `connection.close` / `query.execute` / `query.cancel` / metadata·DDL·compile에 `connectionId` (또는 합의된 키)
- 기존 단일 접속 클라이언트를 **하위 호환 또는 일괄 마이그레이션** (실크는 아직 외부 API 소비자 없음 → id 필수로 단순화 가능)
- Rust `JdbcAgentClient` + Tauri commands 인자 전달
- 동일 id로 cancel이 올바른 Statement를 취소

### 완료 기준

- 에이전트 프로세스 하나에서 서로 다른 두 connectionId로 쿼리를 연속 실행 가능 ✅
- 한쪽 close가 다른쪽 Connection을 닫지 않음 ✅

### 구현 메모 (완료 시점)

- Agent: `Map<connectionId, Session>` — open/close/execute/cancel/metadata/DDL/compile에 `connectionId`
- Silk는 **프로필 id**를 `connectionId`로 사용 (프론트 브리지·ConnectionService)
- UI는 아직 단일 connected UX(다른 프로필 연결 시 이전 disconnect) — 다중 ● 는 MC-B
- `query.cancel` / `query.execute` 등 Tauri·Rust·db-protocol 타입 갱신됨

### 요청 문구 예

> 다중 DB 세션 MC-A 진행해. jdbc-agent·프로토콜·Tauri에 connectionId를 넣어 동시 다중 Connection을 지원해줘.

---

## MC-B. ConnectionService · 탭 바인딩 모델

**상태:** 완료 (본 요청)

**의존성:** MC-A

### 범위

- `connectedProfileIds: Set` (또는 map) — 프로필 여러 개 동시 connected
- `connect(profileId)`가 **다른 프로필을 자동 disconnect하지 않음**
- 에디터 탭(또는 문서 URI) ↔ `profileId` (+ 선택 스키마/카탈로그) 바인딩 저장
- 새 SQL 탭 기본 바인딩 = 마지막 사용/전역 기본
- 끊김 시 바인딩 유지, 상태만 disconnected
- 탐색기 트리 캐시는 프로필별로 이미 있는 패턴을 다중 connected에 맞게 유지

### 완료 기준

- 두 프로필을 동시에 connected로 둘 수 있음 (UI 최소·또는 서비스 API/테스트로 검증) ✅
- 탭별 바인딩 get/set API가 있음 ✅

### 구현 메모 (완료 시점)

- `ConnectionState.connectedProfileIds` + 호환용 `connectedProfileId`(최근 접속)
- `disconnect(profileId?)` — 지정 프로필만 종료, 나머지는 유지
- `ConnectionTreeService.addConnectedProfile` / `removeConnectedProfile` — 형제 캐시 유지
- [`EditorConnectionBindingService`](../apps/silk-db-studio/src/services/connection/editorConnectionBindingService.ts) — `get/set/ensureBinding`, SQL 탭 자동 기본 바인딩
- 상태바 피커·Run 라우팅은 MC-C / MC-D

### 요청 문구 예

> 다중 DB 세션 MC-B 진행해. ConnectionService 다중 connected와 에디터 탭 바인딩 모델을 넣어줘.

---

## MC-C. 상태바 실행 대상 + 탐색기 다중 ●

**상태:** 완료 (본 요청)

**의존성:** MC-B (표시용 상태). Agent 실사용은 MC-D

### 범위

- Status Bar에 포커스 탭의 실행 대상: `프로필 › 스키마` / `No connection` / `Disconnected`
- 클릭 → Quick Pick(또는 메뉴): 연결된 프로필 목록에서 **현재 탭 바인딩** 변경
- Connections Explorer: 여러 프로필에 connected 표시 가능
- i18n en/ko

### 완료 기준

- 탭을 바꾸면 상태바 문구가 그 탭 바인딩으로 바뀜 ✅
- 상태바에서 바꾼 값이 해당 탭에만 적용됨 ✅

### 구현 메모 (완료 시점)

- workbench `StatusBar`에 `leftExtra` / `rightExtra` 슬롯
- 앱: `ConnectionTargetStatusItem` + `ConnectionTargetQuickPick` (현재 탭만 `setBinding`)
- 탐색기 다중 ● 는 MC-B에서 반영됨

### 요청 문구 예

> 다중 DB 세션 MC-C 진행해. 상태바에 실행 대상 DB를 보여주고, 탐색기는 다중 connected ●를 지원해줘.

---

## MC-D. 실행·메타데이터가 탭 바인딩 사용

**상태:** 완료 (본 요청)

**의존성:** MC-A, MC-B (MC-C와 병행 가능하나 표시 검증 후 권장)

### 범위

- `QueryExecutionService` / Explain / Open Data / DDL·compile / autocomplete 메타데이터가 **포커스(또는 소유) 탭의 connectionId·profileId** 사용
- 바인딩 없음·Disconnected면 Run 차단 또는 재연결 유도 (자동으로 다른 DB로 보내지 않음)
- 히스토리에 실행에 쓴 프로필 기록(가능하면)

### 완료 기준

- 탭 A=Prod, 탭 B=Dev일 때 각각 Ctrl+Enter가 해당 DB로 감 ✅
- 탐색기 Open Data는 해당 프로필 세션으로 실행 ✅

### 구현 메모 (완료 시점)

- [`resolveExecutionConnection.ts`](../apps/silk-db-studio/src/services/query/resolveExecutionConnection.ts) — options → 활성 탭 바인딩; 해당 프로필만 silent reconnect
- `QueryExecuteOptions.connectionId` · 결과 탭에 `connectionId` 보관 (refresh/save)
- Open Data / explorer mutation / PL/SQL save·compile·source: `isConnected(ref.profileId)` + 명시 `connectionId`
- 자동완성·`resolveActiveDriverId` — 활성 탭 바인딩 우선
- 히스토리 `connectionProfileId` = 실행에 쓴 프로필

### 요청 문구 예

> 다중 DB 세션 MC-D 진행해. 쿼리 실행과 메타데이터 호출이 탭 바인딩의 connectionId를 쓰게 해줘.

---

## MC-E. 에디터 탭별 결과 소유

**상태:** 완료 (본 요청)

**의존성:** MC-B (탭 id). MC-D와 함께 검증하는 편이 좋음

### 범위

- 결과 상태를 **에디터 탭 id(또는 uri) 키**로 보관. 전역 `beginRun`이 다른 탭 결과를 지우지 않음
- 에디터 탭 포커스 변경 → 패널이 그 탭의 결과 서브탭·그리드를 표시
- 한 에디터 탭 안에서의 다중 결과 서브탭(문장 N개) 동작은 5-C와 호환 유지
- 에디터 탭 닫기 → 해당 결과 폐기(또는 상한 정책)
- dirty 셀·UPDATE 미리보기도 탭 스코프

### 완료 기준

- 탭 A에서 실행 후 탭 B에서 실행해도 A 결과가 유지되고, A로 돌아오면 A 결과가 보임 ✅
- 결과 패널이 “지금 포커스된 SQL 탭”의 소유분만을 보여 줌 ✅

### 구현 메모 (완료 시점)

- `QueryExecutionService`: `Map<ownerId, QueryExecutionState>` + per-owner `runGeneration` / cancel
- 에디터 포커스 변경 시에만 `viewOwnerId` 전환 (Open Data synthetic `open-data:…` 유지)
- 에디터 탭 닫기 → 해당 세션·dirty 폐기 (실행 중이면 cancel)
- Open Data: `buildOpenDataOwnerId` 합성 키로 SQL 탭 결과와 분리

### 요청 문구 예

> 다중 DB 세션 MC-E 진행해. 쿼리 결과를 에디터 탭마다 분리하고, 포커스 탭에 맞게 패널을 전환해줘.

---

## MC-F. 보조 UX · 회귀 · 문서 (선택)

**상태:** 완료 (본 요청)

**의존성:** MC-C~E

### 범위

- 탭 툴팁/suffix 또는 에디터 상단 칩에 접속명
- “이 접속을 모든 열린 SQL 탭에 적용”
- 단축키(선택): 실행 대상 Quick Pick
- user-guide / roadmap 문구, 단일 접속 가정 회귀(탐색기·PL/SQL·AI 컨텍스트)

### 완료 기준

- 스플릿·다탭에서도 실행 대상이 상태바 외 한 곳에서 더 보임 ✅
- 문서에 다중 세션·탭별 결과가 설명됨 ✅

### 구현 메모 (완료 시점)

- silk-editor 탭 `description` / `tooltip` + 앱 `editorTabConnectionDecorations`
- Quick Pick: `All SQL tabs → {name}` (`setBindingsForAllSqlTabs`)
- 명령 `silk.connection.selectTarget` (`Ctrl+K Ctrl+O`)
- 탐색기 Refresh = 모든 connected; 검색·AI 컨텍스트 = 활성 탭 바인딩 우선
- `user-guide.md` Connections & sessions 절

### 요청 문구 예

> 다중 DB 세션 MC-F 진행해. 탭 칩과 문서·회귀를 마무리해줘.

---

## 관련 문서

- 로드맵: [`roadmap.md`](./roadmap.md) 항목 3
- 결과 그리드(실행 배치 내 다중 서브탭): [`result-grid-work-breakdown.md`](./result-grid-work-breakdown.md)
- SQL 편집 실행: [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)
- 탐색기: [`explorer-work-breakdown.md`](./explorer-work-breakdown.md)

# 결과 그리드 — 작업 배분

로드맵 5번 항목을 한 번에 처리하기엔 범위가 크므로, **요청 5번**으로 나눈다.  
각 요청은 한 채팅에서 end-to-end로 끝낼 수 있는 단위다.  
(형식은 [`sql-editing-work-breakdown.md`](./sql-editing-work-breakdown.md)와 동일)

## 현재 상태 (기준)

- AG Grid Community 기반 `QueryResultGrid` — 정렬·필터·복사·CSV(5-A), 컬럼 레이아웃 저장(5-B), **다중 결과 탭(5-C)**, **maxRows truncate·대용량 UX v1(5-D)**까지 반영
- 설정: `queryResult.maxRows` / `rowHeight` / `fontSize` / `nullDisplay` / `filterEnabled`
- 실행 결과는 `QueryExecutionService`의 **탭 목록** (`tabs` / `activeTabId`) — **실행마다 이전 탭을 교체**, 이번 배치만 표시 (상한 10)
  - Ctrl+Enter: 커서 문장 1개 → 탭 1개(탭 스트립 숨김) / 선택 영역 N문장 → 탭 N개
  - Ctrl+Shift+Enter: 버퍼 전체 문장을 각각 실행 → 탭 N개
- 미구현: 안전 UPDATE(커밋); 서버 페이징은 5-D v2
- 그리드 라이브러리: 당분간 AG Grid Community 유지 (DevExtreme/Enterprise 전환은 별도)

---

## 5-A. 정렬·필터 UX + 복사·CSV

**상태:** 구현 완료 (검증은 앱에서 확인)

**의존성:** 없음 (가장 먼저). 기존 AG Grid 위에 툴바/커맨드만 얹으면 됨

### 범위

- 정렬·필터 UX 정리
  - 헤더 정렬(`unSortIcon`), 플로팅 필터(설정 `filterEnabled`와 연동)
  - 필터/정렬 배지·표시 행 수 (`N of M rows`)
  - 필터·정렬 초기화 액션
- 복사 (필터·정렬 **적용 후** 뷰 기준, UI에 표기)
  - 선택 셀 / 선택 행 / 전체 → 클립보드 TSV
  - 툴바 + Terminal 메뉴 + `Ctrl+Shift+C`(전체)
- CSV 내보내기
  - 필터 적용분 → `.csv` (UTF-8 BOM)
  - Tauri `save` + `writeTextFile`, 실패 시 브라우저 download
  - `Ctrl+Shift+S`

### 완료 기준

- 필터·정렬 후 행 수를 확인할 수 있음
- 선택/전체 복사가 클립보드에 들어감
- CSV 파일로 내보낼 수 있음

### 요청 문구 예

> 결과 그리드에 정렬·필터 UX를 다듬고, 선택/행/전체 복사와 CSV 내보내기를 end-to-end로 구현해줘.

---

## 5-B. 컬럼 상태 저장

**상태:** 구현 완료 (검증은 앱에서 확인)

**의존성:** 5-A와 독립 가능하지만, A 다음이 자연스러움 (툴바·그리드 API가 안정된 뒤)

### 범위

- AG Grid column state 저장/복원
  - 너비, 순서, 표시/숨김, pin
- 저장 키 전략
  - `localStorage` 키: `silk-db-studio.queryResult.columnLayout.v1:{profileId}:{columnSignature}`
  - `columnSignature` = 결과 컬럼명 순서의 해시 (같은 연결 + 같은 컬럼 집합/순서 → 복원)
- “컬럼 레이아웃 초기화” 액션 (툴바 + Terminal 메뉴 `silk.queryResult.resetColumnLayout`)

### 완료 기준

- 컬럼 너비/순서를 바꾼 뒤 같은 형태의 결과를 다시 열면 복원됨
- 초기화하면 기본 레이아웃으로 돌아감

### 요청 문구 예

> 결과 그리드 컬럼 너비·순서·숨김 상태를 저장하고 복원해줘. 초기화 액션도 넣어줘.

---

## 5-C. 다중 결과 탭

**상태:** 구현 완료 (검증은 앱에서 확인)

**의존성:** 5-A 권장 (탭마다 그리드·복사/CSV가 동일해야 함). 5-B와는 병렬 가능

### 범위

- 실행(및 Explain)마다 **이번 배치** 결과만 탭으로 표시 (새 실행 시 이전 탭 교체, 상한 10)
- `QueryExecutionService`: `tabs` / `activeTabId` + `setActiveTab` / `closeTab` / `closeAllTabs`
- 패널 UI: 탭 전환·개별 닫기·전체 닫기
- updateCount / 메시지 전용 성공도 탭으로 유지
- 오류·취소는 탭을 추가하지 않고 메시지 영역에 표시 (기존 탭 유지)
- 실행 중: 기존 탭 유지 + running 배너, Cancel 유지

### 완료 기준

- 쿼리를 두 번 실행하면 두 탭이 남고 전환 가능
- 탭을 닫아도 다른 탭 결과는 유지

### 요청 문구 예

> 쿼리 실행 결과를 패널에 다중 탭으로 쌓아줘. 탭 전환·닫기를 지원하고, 실행 서비스 모델을 단일 result에서 탭 목록으로 확장해줘.

---

## 5-D. 대용량 / 페이지

**상태:** 구현 완료 — v1 (검증은 앱에서 확인)

**의존성:** 5-A (행 수·상태 표시). 서버 페이징은 agent 변경 가능

### 범위 (v1 — 클라이언트 우선) ✅

- `queryResult.maxRows`와 “더 있음” 표시
  - agent: `setMaxRows(max+1)`로 truncate 감지 → payload `truncated` + 메시지
  - 그리드: **Truncated at N** 경고 배지
- AG Grid 행/컬럼 가상화 유지, `animateRows=false`, `rowBuffer=8`
- 서버 OFFSET 페이지 UI는 **넣지 않음**

### 범위 (v2 — 필요할 때만, 별도 요청 권장)

- 서버 사이드 페이지 / FETCH NEXT / ROWNUM 래핑
- 드라이버별 SQL 생성과 agent API

### 완료 기준 (v1)

- maxRows에 걸리면 사용자에게 명확히 보임
- 수천 행(설정 상한 내)에서도 그리드가 버벅이지 않음

### 요청 문구 예

> 결과 그리드 대용량 UX를 구현해줘. maxRows truncate 표시와 그리드 성능을 우선하고, 서버 페이징은 넣지 말고 v1만 해줘.

---

## 5-E. 안전 UPDATE

**상태:** ✅ 완료

**의존성:** 5-A 이상. PK 메타는 `connection.primaryKeys` agent API 추가

### 범위

- 셀 편집 → dirty 행 추적 (`QueryResultDirtyService`)
- WHERE: PK 컬럼 메타 조회 (`connection.primaryKeys`) — **PK 없으면 저장 차단**
- 단일 테이블 `SELECT … FROM …`만 지원 (JOIN/UNION/서브쿼리 차단)
- **스키마 생략 시** JDBC 세션 컨텍스트(`CURRENT_SCHEMA`, `search_path`, `getCatalog()` 등)로 PK·UPDATE 대상 해석
- 미리보기: 생성될 `UPDATE … WHERE …` 목록 (`QueryResultUpdateDialog`)
- 확인 후 실행 → 성공 시 원 SELECT 재실행으로 그리드 갱신
- read-only 모드·autoCommit은 기존 `query_execute` 경로 그대로 사용

### 완료 기준

- 셀 수정 후 미리보기에서 SQL을 보고 확인해야만 DB에 반영 ✅
- PK 없는 테이블은 저장 버튼·편집 차단 + "Save blocked" 배지 ✅

### 요청 문구 예

> 결과 그리드 안전 UPDATE를 구현해줘. 셀 편집을 dirty로 추적하고, UPDATE SQL 미리보기·확인 후에만 실행해줘. PK가 없으면 위험 경로를 명확히 막아줘.

---

## 진행 순서

```
5-A 정렬·필터 UX + 복사·CSV  ✅
 → 5-B 컬럼 상태 저장  ✅
 → 5-C 다중 결과 탭  ✅
 → 5-D 대용량/페이지 (v1)  ✅
 → 5-E 안전 UPDATE  ✅
```

- `5-B`와 `5-C`는 서로 의존이 약해서, A 이후 순서를 바꿔도 된다.
- `5-D` v2(서버 페이지)와 `5-E`는 agent/메타 의존이 커서 뒤로 둔다.
- 한 채팅에 `5-A+5-B`까지는 가능하나, `5-C`부터는 단독 요청을 권장한다.

---

## 같이 넣지 말 것 (로드맵 6+)

- DB 탐색기 트리·DDL·테이블 데이터 뷰어 고도화 → **6. DB 탐색기**
- PL/SQL 편집/컴파일 → **7**
- AI 어시스턴트 → **8**

결과 그리드 요청에 탐색기·AI를 섞으면 범위가 다시 커진다.

---

## 다음 단계

결과 그리드(로드맵 5) 5-A~5-E가 완료되었다.  
그리드 라이브러리 전환(DevExtreme/Enterprise)은 별도 결정 후 진행.

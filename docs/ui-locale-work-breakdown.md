# UI 언어(i18n) — 작업 배분

Settings에서 **English / 한국어**를 고르고, 워크벤치 UI 문자열을 로케일에 맞게 보여 주기 위한 배분이다.  
로드맵 **2. 환경 설정**의 하위 작업이다.

## 현재 상태 (기준)

- **L-A~L-D 완료** — locale 인프라, Settings/셸, 앱 화면, 잔여 점검·문서
- 구성 저장 — [`ConfigurationService`](../packages/silk-workbench/src/platform/configuration/configurationService.ts)
- 메시지 — [`packages/silk-workbench/src/platform/i18n/`](../packages/silk-workbench/src/platform/i18n/)

### v1 범위 / 비범위

| 넣음 | 넣지 않음 (이후) |
|------|------------------|
| `en` / `ko` 로케일 | 일본어 등 추가 언어 |
| 설정 키 + Appearance 선택 | OS 시스템 메뉴 로케일(macOS) 강제 동기화 |
| `t()` / 메시지 사전 | ICU 복수형·날짜 포맷 전면 |
| 핵심 UI 문자열 번역 | SQL 방언·DB 메타데이터 번역 |

---

## 진행 순서

```
L-A  workbench.locale + Appearance 선택 + 메시지 인프라
 → L-B  Settings 전체 · 셸(메뉴/사이드바/상태바) 핵심 문자열
 → L-C  연결·쿼리·PL/SQL·AI 등 앱 화면
 → L-D  (선택) 미번역 키 점검 · 문서
```

---

## L-A. locale 설정 · Appearance · 메시지 인프라

**상태:** 완료 (본 요청)

### 범위

- `workbench.locale`: `"en" | "ko"` (미저장 시 OS/`navigator`가 `ko*`면 `ko`, 아니면 `en`)
- Appearance에 Language 셀렉트
- `I18nService` + `t(key)` + `useI18n()` (설정 변경 시 즉시 리렌더)
- en/ko 메시지 사전 (Settings 셸 + Appearance 최소 키)
- 단위 테스트: 로케일 정규화 · 키 폴백

### 완료 기준

- Settings → Appearance에서 en/ko 전환 시 Appearance/사이드바 카테고리 라벨이 바뀜
- 값이 `localStorage` 구성에 저장되어 재실행 후에도 유지

### 요청 문구 예

> A 진행해. (`workbench.locale` + Appearance 선택 + 메시지 인프라)

---

## L-B. Settings · 셸 핵심 문자열

**상태:** 완료

**의존성:** L-A

### 범위

- Settings 전 카테고리 제목·설명·옵션 라벨 (AI 감사 로그 포함)
- Menubar / Activity Bar / Sidebar / Status Bar / Panel / Command Palette / Secondary Sidebar 크롬
- 메뉴·명령 팔레트 라벨은 영문 registry → `localizeUiLabel` 매핑

### 완료 기준

- Appearance에서 en/ko 전환 시 Settings 전 카테고리·셸 핵심 UI가 함께 바뀜
- Settings / Keyboard Shortcuts 탭 제목도 로케일 변경 시 갱신

### 요청 문구 예

> Settings와 워크벤치 셸 문자열을 en/ko로 번역해줘.

---

## L-C. 앱 화면(연결·쿼리·PL/SQL·AI)

**상태:** 완료

**의존성:** L-A

### 범위

- Connections Explorer, 연결 편집기, 쿼리 결과, PL/SQL 다이얼로그, AI 채팅 등 `apps/silk-db-studio` UI
- AI Chat 본문·제안 버튼 (`SecondarySidebar`), ready 메시지
- 앱 명령 제목 → `labelMap` / `localizeUiLabel`
- 메타데이터 그룹·탐색기 컨텍스트 메뉴

### 완료 기준

- Appearance에서 en/ko 전환 시 연결·쿼리·PL/SQL·AI 화면 핵심 UI가 함께 바뀜

### 요청 문구 예

> 연결·쿼리·PL/SQL·AI 화면 문자열을 로케일 사전에 옮겨줘.

---

## L-D. 점검 · 문서 (선택)

**상태:** 완료

- en/ko 키 패리티 점검 (동일 개수)
- 고우선 잔여 문자열 반영: 쿼리 결과 배지·실행/저장 blocked 메시지, Explorer 빈 상태, DDL 미리보기, Keyboard Shortcuts, About
- [`user-guide.md`](./user-guide.md)에 **Language** 설정 안내

### 의도적으로 남긴 것 (이후)

- Outline/Timeline More 메뉴, Open Editors Quick Pick, DocumentationViewer 본문(영문 유지)
- PL/SQL 다이얼로그 일부 힌트, AI warning/blocked 세부 문구, 드라이버 catalog/schema 힌트

---

## 같이 넣지 말 것

| 항목 | 귀속 |
|------|------|
| SQL IntelliSense 방언 함수 | [`sql-intellisense-work-breakdown.md`](./sql-intellisense-work-breakdown.md) |
| 테마·글꼴 등 기존 Appearance | 이미 Configuration에 있음 — locale만 추가 |

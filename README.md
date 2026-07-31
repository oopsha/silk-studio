# Silk Studio

데이터베이스, ERD, 웹 개발 도구를 위한 모노레포입니다.

## 워크스페이스

- `apps/silk-db-studio` — Tauri 데스크톱 DB 스튜디오 및 DB 전용 UI
- `packages/silk-editor` — Monaco 에디터, 에디터 상태, 탭 바
- `packages/silk-workbench` — 커맨드, 메뉴, 레이아웃 서비스, 워크벤치 뷰
- `packages/silk-ui` — 디자인 토큰, 폰트, 아이콘, 공용 UI 훅
- `packages/db-protocol` — Java/Rust/TypeScript 에이전트 프로토콜 계약
- `packages/jdbc-agent` — 공용 Java JDBC 사이드카
- `crates/silk-db-agent-client` — 공용 Rust 프로세스 및 프로토콜 클라이언트

의존성 방향:

```text
silk-ui <- silk-editor <- silk-workbench <- silk-db-studio
                    db-protocol <- silk-db-studio
jdbc-agent <- silk-db-agent-client <- silk-db-studio (Tauri)
```

## 개발

요구 사항: **Node.js 22+**, **pnpm 11** (`package.json#packageManager` — Corepack 권장).

```powershell
corepack enable
pnpm install
cd packages/jdbc-agent
.\gradlew.bat build
cd ../..
pnpm --filter @silk-studio/db-studio tauri dev
```

첫 실행 후 `Ctrl+,` → **Database**에서 연결 프로필을 만들고 **Connect**하세요.

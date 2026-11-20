import SettingsEditor from "@silk-studio/workbench/components/settings/index.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { setSettingsViewOpen, updateZipSettings, useZipSettings, type ExtractDefaultTarget } from "../zipSettings";

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__meta">
        <div className="settings-row__title">{title}</div>
        <div className="settings-row__description">{description}</div>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function ExtractSettings() {
  const settings = useZipSettings();
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">압축 풀기</h2>
      <Row title="기본 풀기 위치" description="압축 풀기 버튼과 Ctrl+E를 눌렀을 때 파일을 풀 위치입니다.">
        <select className="settings-control" value={settings.extractTarget} onChange={(event) => updateZipSettings({ extractTarget: event.target.value as ExtractDefaultTarget })}>
          <option value="ask">매번 폴더 선택</option>
          <option value="named">압축 파일 이름 폴더</option>
          <option value="here">압축 파일과 같은 폴더</option>
        </select>
      </Row>
      <Row title="이미 있는 파일" description="풀 위치에 같은 이름의 파일이 있을 때 처리 방법입니다.">
        <select className="settings-control" value={settings.overwrite ? "overwrite" : "skip"} onChange={(event) => updateZipSettings({ overwrite: event.target.value === "overwrite" })}>
          <option value="skip">건너뛰기</option>
          <option value="overwrite">덮어쓰기</option>
        </select>
      </Row>
      <Row title="풀기 완료 후" description="압축 풀기가 끝나면 푼 폴더를 탐색기에서 엽니다.">
        <label className="settings-checkbox">
          <input type="checkbox" checked={settings.openFolderAfter} onChange={(event) => updateZipSettings({ openFolderAfter: event.target.checked })} />
          <span>풀기 완료 후 폴더 열기</span>
        </label>
      </Row>
    </section>
  );
}

/** Shared settings editor with Silk Zip's own page; replaces the workbench area while open. */
export default function ZipSettingsPage() {
  return (
    <div className="zip-settings-view">
      <button type="button" className="zip-settings-view__close" title="설정 닫기 (Esc)" aria-label="설정 닫기" onClick={() => setSettingsViewOpen(false)}>
        <Codicon name="close" />
      </button>
      <SettingsEditor
        categories={["appearance", "zip"]}
        extensions={[{ id: "zip", label: "압축 풀기", content: <ExtractSettings /> }]}
        showDatabaseAiOptions={false}
      />
    </div>
  );
}

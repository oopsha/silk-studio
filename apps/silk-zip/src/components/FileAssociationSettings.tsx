import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import { tr } from "../i18n";
import { trError } from "../errorMessages";

type Association = { extension: string; registered: boolean; isDefault: boolean };

/** Extensions picked by "필수 선택": the archive types people open most. */
const ESSENTIAL = ["zip", "7z", "rar", "tar", "tgz", "gz", "bz2", "xz"];

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/** 설정 > 파일 연결: which archive types open in Silk Zip (Windows only). */
export default function FileAssociationSettings() {
  const windows = detectWorkbenchPlatform() === "windows";
  const [items, setItems] = useState<Association[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const show = (list: Association[]) => {
    setItems(list);
    setChecked(new Set(list.filter((item) => item.registered).map((item) => item.extension)));
  };

  useEffect(() => {
    if (!windows) return;
    void invoke<Association[]>("file_associations").then(show);
    // The default app is changed outside the app: refresh the badges on return, keeping unsaved checks.
    const refresh = () => void invoke<Association[]>("file_associations").then(setItems);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [windows]);

  const saved = useMemo(() => new Set(items.filter((item) => item.registered).map((item) => item.extension)), [items]);
  const changed = !sameSet(saved, checked);

  if (!windows) {
    return (
      <section className="settings-section">
        <h2 className="settings-section__title">{tr("파일 연결")}</h2>
        <p className="zip-assoc__note">{tr("이 운영체제에서는 시스템 설정에서 기본 앱을 지정하세요.")}</p>
      </section>
    );
  }

  const toggle = (extension: string, on: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(extension);
      else next.delete(extension);
      return next;
    });
  };

  const apply = async () => {
    setBusy(true);
    setMessage("");
    try {
      show(await invoke<Association[]>("set_file_associations", { extensions: [...checked] }));
      setMessage(tr("파일 연결을 저장했습니다."));
    } catch (error) {
      setMessage(trError(String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{tr("파일 연결")}</h2>
      <p className="zip-assoc__note">
        {tr("선택한 형식을 Silk Zip으로 열도록 등록합니다. 다른 앱이 이미 기본 앱인 형식은 Windows 정책상 직접 바꿀 수 없으니, 등록 후")}{" "}<b>{tr("Windows 기본 앱 설정")}</b>{tr("에서 Silk Zip을 선택하세요.")}
      </p>
      <div className="zip-assoc__actions">
        <button type="button" className="settings-button" onClick={() => setChecked(new Set(ESSENTIAL.filter((ext) => items.some((item) => item.extension === ext))))}>
          {tr("필수 선택")}
        </button>
        <button type="button" className="settings-button" onClick={() => setChecked(new Set(items.map((item) => item.extension)))}>
          {tr("모두 선택")}
        </button>
        <button type="button" className="settings-button" onClick={() => setChecked(new Set())}>
          {tr("모두 해제")}
        </button>
      </div>
      <div className="zip-assoc__grid">
        {items.map((item) => (
          <label key={item.extension} className="settings-checkbox zip-assoc__item" title={item.isDefault ? tr("Silk Zip이 기본 앱입니다.") : undefined}>
            <input type="checkbox" checked={checked.has(item.extension)} onChange={(event) => toggle(item.extension, event.target.checked)} />
            <span>.{item.extension}</span>
            {item.isDefault && <span className="zip-assoc__badge">{tr("기본")}</span>}
          </label>
        ))}
      </div>
      <div className="zip-assoc__actions">
        <button type="button" className="settings-button" disabled={busy || !changed} onClick={() => void apply()}>
          {tr("적용")}
        </button>
        <button type="button" className="settings-button" onClick={() => void invoke("open_default_apps_settings")}>
          {tr("Windows 기본 앱 설정 열기")}
        </button>
        {message && <span className="zip-assoc__message">{message}</span>}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { tr } from "../i18n";

/** The licences of the software the app ships (scripts/generate-third-party-notices.mjs). */
export default function LicensesDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/third-party-notices.txt")
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(response.statusText))))
      .then((content) => { if (active) setText(content); })
      .catch(() => { if (active) setText(tr("라이선스 문서를 읽지 못했습니다.")); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="zip-operation-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="zip-operation-dialog zip-licenses-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-licenses-title">
        <h2 id="zip-licenses-title">{tr("오픈 소스 라이선스")}</h2>
        <pre tabIndex={0}>{text ?? tr("불러오는 중…")}</pre>
        <footer><button className="zip-button primary" autoFocus onClick={onClose}>{tr("닫기")}</button></footer>
      </section>
    </div>
  );
}

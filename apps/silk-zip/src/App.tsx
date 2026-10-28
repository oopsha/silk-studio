import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

function App() {
  const [files, setFiles] = useState<string[]>([]);
  const addFiles = async () => {
    const selected = await open({ multiple: true, directory: false });
    if (selected) setFiles((current) => [...current, ...(Array.isArray(selected) ? selected : [selected])]);
  };

  return (
    <main className="zip-app">
      <header className="zip-header"><div className="zip-brand"><span className="zip-mark">Z</span><strong>Silk Zip</strong><span className="zip-subtitle">파일 압축 유틸리티</span></div><button className="zip-button" onClick={addFiles}>파일 추가</button></header>
      <section className="zip-content">
        <div className="zip-toolbar"><div><h1>새 압축 파일</h1><p>파일을 선택하고 ZIP 또는 7z 파일로 압축하세요.</p></div><select aria-label="압축 형식"><option>7z</option><option>zip</option></select></div>
        <div className="zip-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles((current) => [...current, ...Array.from(event.dataTransfer.files, (file) => file.name)]); }}>
          {files.length === 0 ? <><div className="zip-empty-icon">＋</div><strong>파일을 여기로 끌어오세요</strong><span>또는 파일 추가를 눌러 선택</span></> : <div className="zip-file-list">{files.map((file, index) => <div className="zip-file" key={`${file}-${index}`}><span className="codicon codicon-file" />{file}</div>)}</div>}
        </div>
        <footer className="zip-footer"><span>{files.length}개 항목</span><button className="zip-button primary" disabled>압축 시작</button></footer>
      </section>
      <div className="zip-status"><span>7-Zip 엔진 연결 전</span><span>Silk Studio</span></div>
    </main>
  );
}

export default App;

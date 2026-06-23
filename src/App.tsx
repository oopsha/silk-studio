import Editor from "@monaco-editor/react";

function App() {
  return (
    <Editor
      height="100vh"
      defaultLanguage="sql"
      theme="vs-dark"
    />
  );
}

export default App;
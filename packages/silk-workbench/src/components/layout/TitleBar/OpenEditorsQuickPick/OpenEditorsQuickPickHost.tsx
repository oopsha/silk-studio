import { OpenEditorsQuickPickProvider } from "./openEditorsQuickPickContext";
import OpenEditorsQuickPick from "./OpenEditorsQuickPick";

function OpenEditorsQuickPickHost() {
  return (
    <OpenEditorsQuickPickProvider>
      <OpenEditorsQuickPick />
    </OpenEditorsQuickPickProvider>
  );
}

export default OpenEditorsQuickPickHost;

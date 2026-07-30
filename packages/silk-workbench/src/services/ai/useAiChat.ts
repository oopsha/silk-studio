import { useEffect, useState } from "react";
import { AiChatService } from "./aiChatService";
import type { AiChatSessionState } from "./aiChatTypes";

export function useAiChat(): AiChatSessionState {
  const [state, setState] = useState(() => AiChatService.getState());

  useEffect(() => {
    return AiChatService.onDidChange(() => {
      setState(AiChatService.getState());
    });
  }, []);

  return state;
}

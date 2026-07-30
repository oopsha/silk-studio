export type AppRuntimeInfo = {
  appName: string;
  appVersion: string;
  tauriVersion: string;
  os: string;
  arch: string;
  agentJarPresent: boolean;
  agentJarPath: string;
  agentBundled: boolean;
  javaBinPath: string;
  javaBundled: boolean;
  logDir: string;
  logFile: string;
};

export const APP_DISPLAY_NAME = "Silk DB Studio";
/** Keep in sync with apps/silk-db-studio package + tauri.conf.json version. */
export const APP_VERSION = "0.1.0";

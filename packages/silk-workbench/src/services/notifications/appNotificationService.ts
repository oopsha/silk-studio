export type AppNotificationSeverity = "info" | "success" | "error";

export type AppNotification = {
  id: string;
  message: string;
  severity: AppNotificationSeverity;
  createdAt: number;
};

type AppNotificationListener = () => void;

const DEFAULT_TTL_MS = 4_000;

class AppNotificationServiceImpl {
  private current: AppNotification | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<AppNotificationListener>();

  getCurrent(): AppNotification | null {
    return this.current;
  }

  show(
    message: string,
    severity: AppNotificationSeverity = "info",
    ttlMs = DEFAULT_TTL_MS,
  ): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.current = {
      id: crypto.randomUUID(),
      message: message.trim() || "Notification",
      severity,
      createdAt: Date.now(),
    };
    this.fireDidChange();

    this.hideTimer = setTimeout(() => {
      this.current = null;
      this.hideTimer = null;
      this.fireDidChange();
    }, ttlMs);
  }

  dismiss(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (!this.current) return;
    this.current = null;
    this.fireDidChange();
  }

  onDidChange(listener: AppNotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AppNotificationService = new AppNotificationServiceImpl();

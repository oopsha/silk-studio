import { useEffect, useState } from "react";
import {
  AppNotificationService,
  type AppNotification,
} from "../../services/notifications/appNotificationService";
import "./AppToast.css";

function AppToast() {
  const [notification, setNotification] = useState<AppNotification | null>(() =>
    AppNotificationService.getCurrent(),
  );

  useEffect(() => {
    return AppNotificationService.onDidChange(() => {
      setNotification(AppNotificationService.getCurrent());
    });
  }, []);

  if (!notification) {
    return null;
  }

  return (
    <div
      className={`app-toast app-toast--${notification.severity}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="app-toast__content">
        <span className="app-toast__message">{notification.message}</span>
        {notification.progress !== undefined ? (
          <div className="app-toast__progress" role="progressbar" aria-label={notification.message}
            aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={notification.progress ?? undefined}>
            <div className={`app-toast__progress-value${notification.progress === null ? " app-toast__progress-value--indeterminate" : ""}`}
              style={notification.progress === null ? undefined : { width: `${notification.progress}%` }} />
          </div>
        ) : null}
      </div>
      {notification.progress === undefined ? (
      <button
        type="button"
        className="app-toast__dismiss"
        aria-label="Dismiss"
        onClick={() => AppNotificationService.dismiss()}
      >
        ×
      </button>
      ) : null}
    </div>
  );
}

export default AppToast;

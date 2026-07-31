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
      <span className="app-toast__message">{notification.message}</span>
      <button
        type="button"
        className="app-toast__dismiss"
        aria-label="Dismiss"
        onClick={() => AppNotificationService.dismiss()}
      >
        ×
      </button>
    </div>
  );
}

export default AppToast;

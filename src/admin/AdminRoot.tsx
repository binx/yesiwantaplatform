import { Outlet } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import { adminTheme } from "./adminTheme";

/**
 * The admin's own chrome.
 *
 * The theme itself lives in `adminTheme.ts`, because the setup wizard is a
 * sibling top-level route rather than a child of this one and needs the same
 * palette for the same reason.
 */
export function AdminRoot() {
  return (
    <ConfigProvider theme={adminTheme}>
      <AntApp>
        <Outlet />
      </AntApp>
    </ConfigProvider>
  );
}

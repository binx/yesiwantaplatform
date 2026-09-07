import { Outlet } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import { defaultTheme } from "@shared/schema";
import { toAntdTheme } from "@/lib/theme";

/**
 * The admin's own chrome.
 *
 * Deliberately themed with Beluga's defaults rather than the store's own
 * palette. A shop is free to configure white-on-white or a 24px radius; that
 * is its business, and it should not be able to make its own control panel
 * unreadable. The store's theme is previewed where it is edited, and nowhere
 * else in here.
 */
const base = toAntdTheme(defaultTheme);

/**
 * `colorInfo` is put back to a real blue.
 *
 * The storefront maps it onto the primary colour so a single accent carries
 * the whole shop, which is right there — but the admin uses `Alert type="info"`
 * for ordinary "here is how this works" notices, and Beluga's near-black
 * primary turned every one of them into a black slab that reads as a failure.
 * Severity has to be legible in a control panel.
 */
const adminTheme = {
  ...base,
  token: { ...base.token, colorInfo: "#2563eb", colorLink: "#2563eb" },
};

export function AdminRoot() {
  return (
    <ConfigProvider theme={adminTheme}>
      <AntApp>
        <Outlet />
      </AntApp>
    </ConfigProvider>
  );
}

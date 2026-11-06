import type { Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export type SettingsTab = "Profile" | "Organization" | "Integrations" | "Notifications";

export async function openDashboardSettings(page: Page): Promise<{ urlPath: string; profileTabVisible: boolean }> {
  await goToAppPath(page, "/settings");
  const profileTab = page.getByRole("tab", { name: "Profile", exact: true });
  await profileTab.waitFor({ state: "visible" });
  return { urlPath: new URL(page.url()).pathname, profileTabVisible: await profileTab.isVisible() };
}

export async function selectSettingsTab(page: Page, tab: SettingsTab): Promise<{ tab: SettingsTab; selected: boolean }> {
  const target = page.getByRole("tab", { name: tab, exact: true });
  await target.click();
  await target.waitFor({ state: "visible" });
  return { tab, selected: (await target.getAttribute("data-state")) === "active" };
}

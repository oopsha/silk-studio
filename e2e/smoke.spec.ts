import { expect, test } from "@playwright/test";

test.describe("workbench smoke", () => {
  test("main shell loads and Settings opens", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("activity-bar")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Explorer" })).toBeVisible();

    await page.getByRole("button", { name: "Manage" }).click();
    // Accessible name includes keybinding suffix (e.g. "Settings Ctrl+,").
    await page.getByRole("menuitem", { name: /^Settings\b/ }).click();

    await expect(page.getByTestId("settings-editor")).toBeVisible();
    await expect(
      page.locator(".settings-editor__sidebar-title"),
    ).toHaveText("Settings");
    await expect(
      page.getByRole("heading", { name: "Appearance" }),
    ).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function loginAs(
  page: import("@playwright/test").Page,
  profile = "test-director",
) {
  await page.goto("/");
  await page.getByLabel("Development profile").selectOption(profile);
  await page.getByRole("button", { name: "Log in" }).click();
}
test("development login selects separate synthetic profiles without live auth", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText(
      "Development-only profile switcher. It uses synthetic local data and does not authenticate with Supabase or access real records.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Microsoft" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await page.getByLabel("Development profile").selectOption("test-staff");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".rail-bottom strong")).toHaveText("Sample Staff");
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Development profile").selectOption("test-director");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".rail-bottom strong")).toHaveText(
    "Sample Director",
  );
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeVisible();
});
test("dashboard presents the supplied building image subtly and shortcuts open existing workflows", async ({
  page,
}) => {
  await loginAs(page);
  const commandButton = page.getByRole("button", {
    name: /Find or do something/,
  });
  const restingStyle = await commandButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
    };
  });
  expect(restingStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(restingStyle.borderStyle).toBe("solid");
  expect(restingStyle.borderWidth).not.toBe("0px");
  await commandButton.hover();
  await page.waitForTimeout(150);
  const hoverStyle = await commandButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, transform: style.transform };
  });
  expect(hoverStyle.background).not.toBe(restingStyle.background);
  expect(hoverStyle.transform).not.toBe("none");
  await page.getByRole("button", { name: "Use dark theme" }).focus();
  await page.keyboard.press("Tab");
  const keyboardFocusIsVisible = await page.evaluate(() => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active.matches(":focus-visible") &&
      getComputedStyle(active).outlineWidth !== "0px"
    );
  });
  expect(keyboardFocusIsVisible).toBe(true);
  const heroImage = page.locator(".dashboard-hero-image");
  await expect(heroImage).toHaveAttribute("alt", "");
  const imagePresentation = await heroImage.evaluate((image) => {
    const element = image as HTMLImageElement;
    return {
      loaded: element.complete && element.naturalWidth > 0,
      opacity: Number(getComputedStyle(element).opacity),
    };
  });
  expect(imagePresentation.loaded).toBe(true);
  expect(imagePresentation.opacity).toBeGreaterThan(0);
  expect(imagePresentation.opacity).toBeLessThan(0.4);
  await page.getByRole("button", { name: /New field report/ }).click();
  await expect(
    page.getByRole("heading", { name: "New site note" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Inbox/ }).click();
  await page.getByRole("button", { name: /Request leave/ }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
});
test("branded walkthrough: requests, drafts, division lens and offline persistence", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs(page);
  await expect(
    page.getByRole("heading", { name: "Your working day" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Decision recorded.")).toBeVisible();
  await page
    .getByRole("button", { name: /Request leave/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("December leave");
  await page.getByLabel("First day").fill("2026-12-14");
  await page.getByLabel("Last day").fill("2026-12-16");
  await page
    .getByLabel("Details", { exact: true })
    .fill("Cover arranged with the project lead.");
  await page.getByRole("button", { name: "Close draft" }).click();
  await page
    .getByRole("button", { name: /Request leave/ })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "December leave",
  );
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("December leave", { exact: true })).toBeVisible();
  await page
    .getByRole("radio", { name: "Asset Management", exact: true })
    .click();
  await expect(page.getByText("December leave", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("radio", { name: "Both", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Find a page or action").fill("Projects");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Projects Go to" })
    .click();
  await expect(page.getByText("Kampala infrastructure survey")).toBeVisible();
  await page
    .getByRole("button", { name: "Field reports", exact: true })
    .click();
  await context.setOffline(true);
  await page
    .getByLabel("What happened on site?")
    .fill("Site note while disconnected");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByRole("button", { name: /1 on this phone/ }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "✓ Saved", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inbox", exact: true })
    .first()
    .click();
  await page.screenshot({
    path: ".validation/workspace-desktop.png",
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
test("mobile and dark themes fit narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(
    page.getByRole("heading", { name: "Your working day" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: ".validation/workspace-mobile-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("requester can inspect, cancel a withdrawal, withdraw and restore saved history filters", async ({
  page,
}) => {
  await loginAs(page, "test-staff");
  await page
    .getByRole("button", { name: /Request leave/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Site cover leave");
  await page.getByLabel("First day").fill("2026-12-14");
  await page.getByLabel("Last day").fill("2026-12-16");
  await page.getByLabel("Details", { exact: true }).fill("Cover is arranged.");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("button", { name: "View stuck requests" }).click();
  await expect(page.getByLabel("Show requests")).toHaveValue("stuck");
  await page.getByRole("button", { name: "Open Site cover leave" }).click();
  const detail = page.getByRole("complementary", {
    name: "Selected request details",
  });
  await expect(
    detail.getByRole("heading", { name: "Activity timeline" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Submitted request", { exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await detail.getByRole("button", { name: "Keep request unchanged" }).click();
  await expect(
    detail.getByRole("button", { name: "Withdraw request", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click();
  await detail
    .getByLabel("Withdrawal reason (optional)")
    .fill("The site programme changed.");
  await detail.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(
    page.getByText("Request withdrawn. Completed steps remain in its history."),
  ).toBeVisible();
  await expect(
    detail.getByText("The site programme changed.", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Withdraw request", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Show requests").selectOption("mine");
  await page.getByLabel("Request status").selectOption("cancelled");
  await expect(
    page.getByRole("button", { name: "Open Site cover leave" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Helpdesk", exact: true }).click();
  await page
    .getByRole("button", { name: "Inbox", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Show requests")).toHaveValue("mine");
  await expect(page.getByLabel("Request status")).toHaveValue("cancelled");
  await page.getByRole("button", { name: "Open Site cover leave" }).focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(
    detail.getByRole("heading", { name: "Site cover leave" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: ".validation/approval-withdrawal-mobile.png",
    fullPage: true,
  });
});

test("document centre creates, submits, releases and revises a draft", async ({
  page,
}) => {
  await loginAs(page);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Field inspection report");
  await page.getByLabel("Project", { exact: true }).fill("P014");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("Field inspection report", { exact: true })).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "Field inspection report" });
  let prompt = 0;
  const dialogs = (dialog: import("@playwright/test").Dialog) => {
    void dialog.accept(prompt++ === 0 ? "documents/P014/report.pdf" : "a".repeat(64));
  };
  page.on("dialog", dialogs);
  await row.getByRole("button", { name: "Attach file", exact: true }).click();
  page.off("dialog", dialogs);
  await row.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(row).toContainText("In review");
  await row.getByRole("button", { name: "Release", exact: true }).click();
  await expect(row).toContainText("Released");
  await row.getByRole("button", { name: "Create revision", exact: true }).click();
  await expect(page.getByText("Field inspection report", { exact: true })).toHaveCount(2);
});

test("request detail retains rejection reason and keyboard shortcuts do not fire while typing", async ({
  page,
}) => {
  await loginAs(page);
  await page.getByRole("button", { name: /^Open Roofing materials/ }).click();
  const detail = page.getByRole("complementary", {
    name: "Selected request details",
  });
  await expect(
    detail.getByText("Supplier quote reviewed.", { exact: true }),
  ).toHaveCount(2);
  await detail.focus();
  await page.keyboard.press("s");
  const reason = detail.getByLabel("Reason for sending back");
  await expect(reason).toBeFocused();
  await reason.fill("Attach the updated quote.");
  await reason.press("a");
  await expect(reason).toHaveValue("Attach the updated quote.a");
  await reason.fill("Attach the updated quote.");
  await detail.getByRole("button", { name: "Confirm send back" }).click();
  await expect(
    detail.getByText("Attach the updated quote.", { exact: true }),
  ).toHaveCount(2);
  await expect(
    detail.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: ".validation/approval-timeline-desktop.png",
    fullPage: true,
  });
});

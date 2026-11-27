import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function loginAs(
  page: import("@playwright/test").Page,
  profile = "test-director",
) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Authorised access only." })
    .click({ clickCount: 3 });
  await page.getByLabel("Development profile").selectOption(profile);
  await page.getByRole("button", { name: "Log in" }).click();
}
test("development login selects separate synthetic profiles without live auth", async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".supabase.co"))
      supabaseRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Microsoft" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const secretButton = page.getByRole("button", {
    name: "Authorised access only.",
  });
  await secretButton.click();
  await expect(page.getByLabel("Development profile")).toHaveCount(0);
  await page.reload();
  await secretButton.click({ clickCount: 2 });
  await expect(page.getByLabel("Development profile")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Authorised access only." }).click({
    clickCount: 3,
  });
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
  expect(supabaseRequests).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Return to sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Return to sign in" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Microsoft" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Authorised access only." })
    .click({ clickCount: 3 });
  await page.getByLabel("Development profile").selectOption("test-director");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".rail-bottom strong")).toHaveText(
    "Sample Director",
  );
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeVisible();
});
test("button labels stay legible in disabled, dark, and enlarged-text states", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Authorised access only." })
    .click({ clickCount: 3 });
  const login = page.getByRole("button", { name: "Log in" });
  await login.evaluate((button) => button.setAttribute("disabled", ""));
  await expect(login).toBeDisabled();

  const disabledLabelContrast = async () =>
    login.evaluate((button) => {
      const style = getComputedStyle(button);
      const channels = (color: string) =>
        color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (color: string) =>
        channels(color)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (total, value, index) =>
              total + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });

  await expect(login).toHaveCSS("opacity", "1");
  expect(await disabledLabelContrast()).toBeGreaterThanOrEqual(4.5);
  await page.locator("body").evaluate((element) =>
    element.setAttribute("data-theme", "dark"),
  );
  await expect.poll(disabledLabelContrast).toBeGreaterThanOrEqual(4.5);

  await page.getByLabel("Development profile").selectOption("test-director");
  await login.evaluate((button) => button.removeAttribute("disabled"));
  await login.click();
  await expect(
    page.getByRole("heading", { name: "Your working day" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const expectButtonLabelsToFit = async () => {
    const overflowingLabels = await page
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => !button.closest(".rail, .mobile-nav"))
          .filter((button) => {
            const text = document.createRange();
            text.selectNodeContents(button);
            const bounds = button.getBoundingClientRect();
            return [...text.getClientRects()].some(
              (line) =>
                line.left < bounds.left - 1 ||
                line.right > bounds.right + 1 ||
                line.top < bounds.top - 1 ||
                line.bottom > bounds.bottom + 1,
            );
          })
          .map(
            (button) =>
              button.textContent?.trim() || button.getAttribute("aria-label"),
          ),
      );
    expect(overflowingLabels).toEqual([]);
  };
  await expectButtonLabelsToFit();
  for (const destination of [
    "Projects",
    "People",
    "Documents",
    "Finance",
    "Settings",
    "Field reports",
    "Helpdesk",
    "Inbox",
  ]) {
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByLabel("Find a page or action").fill(destination);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: `${destination} Go to`, exact: true })
      .click();
    await expectButtonLabelsToFit();
  }
});
test("blueprint sidebar keeps its revision outline quiet until hover", async ({
  page,
}) => {
  await loginAs(page);
  await expect(page.locator(".rail-drafting")).toBeVisible();
  const projects = page
    .locator(".rail nav button")
    .filter({ hasText: "Projects" });
  const revisionOutline = projects.locator(".revision-outline");
  await expect(revisionOutline).toHaveCSS("opacity", "0");
  await projects.hover();
  await expect(revisionOutline).toHaveCSS("opacity", "0.68");
  await expect(page.locator(".rail-profile .profile-icon")).toBeVisible();
  await expect(page.locator(".rail-profile small")).toHaveText("Staff");
  const account = page.locator(".rail-account-actions");
  const dividerWidth = await account
    .locator(".rail-account-divider")
    .evaluate((element) => element.getBoundingClientRect().width);
  const accountWidth = await account.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(dividerWidth).toBeLessThan(accountWidth);
  const profileFontSizes = await page
    .locator(".rail-profile strong, .rail-profile small")
    .evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    );
  const signOutFontSize = Number.parseFloat(
    await page.locator(".rail-account-actions button").evaluate((element) =>
      getComputedStyle(element).fontSize,
    ),
  );
  expect(profileFontSizes[1]).toBeLessThan(profileFontSizes[0]);
  expect(profileFontSizes[1]).toBeGreaterThanOrEqual(12);
  expect(signOutFontSize).toBeGreaterThanOrEqual(12);
  const rail = page.locator(".rail");
  const expandedWidth = await rail.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const toggle = page.getByRole("button", { name: "Collapse sidebar" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect.poll(() =>
    rail.evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(76);
  await expect(
    page.locator(".rail nav").getByRole("button", { name: "Projects" }),
  ).toHaveAttribute("title", "Projects");
  await expect(page.locator(".rail-account-actions button")).toHaveAccessibleName(
    "Sign out",
  );
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(() =>
    rail.evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(expandedWidth);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(rail).toBeHidden();
  await expect(page.locator(".workspace")).toHaveCSS("margin-left", "0px");
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
test("dashboard presents the supplied building image subtly and shortcuts open existing workflows", async ({
  page,
}) => {
  await loginAs(page);
  const commandButton = page.getByRole("button", {
    name: /Find or do something/,
  });
  const commandMaterial = await commandButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      radius: style.borderRadius,
      backdropFilter: style.backdropFilter,
      highlight: style.backgroundImage,
    };
  });
  expect(commandMaterial.radius).toBe("999px");
  expect(commandMaterial.backdropFilter).toContain("blur(10px)");
  expect(commandMaterial.highlight).toContain("linear-gradient");
  const quickActionMaterial = await page
    .locator(".quick-action")
    .first()
    .evaluate((button) => {
      const style = getComputedStyle(button);
      return { radius: style.borderRadius, backdropFilter: style.backdropFilter };
    });
  expect(quickActionMaterial.radius).toBe("4px");
  expect(quickActionMaterial.backdropFilter).toContain("blur(10px)");
  expect(
    await page
      .locator(".rail nav button")
      .first()
      .evaluate((button) => getComputedStyle(button).backdropFilter),
  ).toBe("none");
  expect(
    await page
      .locator(".request-title")
      .first()
      .evaluate((button) => getComputedStyle(button).backdropFilter),
  ).toBe("none");
  const segmentedMaterial = await page
    .getByRole("radio", { name: "Engineering" })
    .evaluate((button) => {
      const style = getComputedStyle(button);
      return { radius: style.borderRadius, background: style.backgroundImage };
    });
  expect(segmentedMaterial).toEqual({ radius: "3px", background: "none" });
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
  const dashboardBackground = page.locator(".dashboard-background");
  const heroImage = page.locator(".dashboard-background-image");
  await expect(dashboardBackground).toHaveAttribute("aria-hidden", "true");
  await expect(heroImage).toHaveAttribute("alt", "");
  const imagePresentation = await heroImage.evaluate((image) => {
    const element = image as HTMLImageElement;
    const imageRect = element.getBoundingClientRect();
    const backgroundRect = element.parentElement!.getBoundingClientRect();
    return {
      loaded: element.complete && element.naturalWidth > 0,
      opacity: Number(getComputedStyle(element).opacity),
      scaledUp: imageRect.width > backgroundRect.width,
    };
  });
  expect(imagePresentation.loaded).toBe(true);
  expect(imagePresentation.opacity).toBeGreaterThan(0);
  expect(imagePresentation.opacity).toBeLessThan(0.4);
  expect(imagePresentation.scaledUp).toBe(true);
  const backgroundBounds = await dashboardBackground.boundingBox();
  const mainBounds = await page.locator("main.dashboard-page").boundingBox();
  expect(backgroundBounds).not.toBeNull();
  expect(mainBounds).not.toBeNull();
  expect(Math.abs(backgroundBounds!.width - mainBounds!.width)).toBeLessThan(1);
  expect(Math.abs(backgroundBounds!.height - mainBounds!.height)).toBeLessThan(1);
  const fade = await page.locator("main.dashboard-page").evaluate((element) =>
    getComputedStyle(element, "::before").backgroundImage,
  );
  expect(fade).toContain("linear-gradient");
  await page.getByRole("button", { name: /New field report/ }).click();
  await expect(
    page.getByRole("heading", { name: "New site note" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Inbox/ }).click();
  await page.getByRole("button", { name: /Request leave/ }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  const primaryMaterial = await page
    .getByRole("button", { name: "Submit", exact: true })
    .evaluate((button) => {
      const style = getComputedStyle(button);
      return { radius: style.borderRadius, highlight: style.backgroundImage };
    });
  expect(primaryMaterial.radius).toBe("999px");
  expect(primaryMaterial.highlight).toContain("linear-gradient");
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
  await expect(page.getByRole("heading", { name: "Kampala infrastructure survey", exact: true })).toBeVisible();
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
  await row.locator('input[type="file"]').setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic test file") });
  await expect(row.getByRole("button", { name: "Download local file" })).toBeVisible();
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

test("settings preferences customize the finance dashboard and stay profile-scoped", async ({
  page,
}) => {
  await loginAs(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByLabel("Upload profile photo")).toBeDisabled();
  await expect(page.getByText(/disabled in the synthetic preview/)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".settings-mobile-header")).toBeVisible();
  await expect(page.locator(".settings-mobile-header h2")).toHaveText("Settings");
  await expect(page.locator(".settings-mobile-profile")).toBeVisible();
  await expect(page.locator(".mobile-nav").getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".topbar")).toBeHidden();
  await page.getByRole("navigation", { name: "Settings shortcuts" }).getByRole("link", { name: /Finance visuals/ }).click();

  const styles = page.locator(".settings-choice-group").nth(1);
  const lineChoice = styles.getByRole("button", { name: /Line/ });
  await lineChoice.click();
  await expect(lineChoice).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toContainText("saved for this profile");

  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("img", { name: /displayed as a line chart/ })).toBeVisible();
  await page.getByRole("button", { name: "Records", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Dashboard expense");
  await page.getByLabel(/Lines — CSV/).fill("Travel,1,125000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Dashboard expense" })).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByText("1 records in this view", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /displayed as a line chart/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter(v => ["critical", "serious"].includes(v.impact || ""))).toEqual([]);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Development profile").selectOption("test-staff");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const secondProfileStyles = page.locator(".settings-choice-group").nth(1);
  await expect(secondProfileStyles.getByRole("button", { name: /Columns/ })).toHaveAttribute("aria-pressed", "true");
});

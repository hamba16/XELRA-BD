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
    .getByRole("button", { name: "Request leave", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("December leave");
  await page.getByLabel("First day").fill("2026-12-14");
  await page.getByLabel("Last day").fill("2026-12-16");
  await page
    .getByLabel("Details", { exact: true })
    .fill("Cover arranged with the project lead.");
  await page.getByRole("button", { name: "Close draft" }).click();
  await page
    .getByRole("button", { name: "Request leave", exact: true })
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

test('requester can inspect, cancel a withdrawal, withdraw and restore saved history filters',async({page})=>{
 await loginAs(page,'test-staff');
 await page.getByRole('button',{name:'Request leave',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Site cover leave');
 await page.getByLabel('First day').fill('2026-12-14');await page.getByLabel('Last day').fill('2026-12-16');
 await page.getByLabel('Details',{exact:true}).fill('Cover is arranged.');
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await page.getByRole('button',{name:'View stuck requests'}).click();
 await expect(page.getByLabel('Show requests')).toHaveValue('stuck');
 await page.getByRole('button',{name:'Open Site cover leave'}).click();
 const detail=page.getByRole('complementary',{name:'Selected request details'});
 await expect(detail.getByRole('heading',{name:'Activity timeline'})).toBeVisible();
 await expect(detail.getByText('Submitted request',{exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'Withdraw request',exact:true}).click();
 await detail.getByRole('button',{name:'Keep request unchanged'}).click();
 await expect(detail.getByRole('button',{name:'Withdraw request',exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'Withdraw request',exact:true}).click();
 await detail.getByLabel('Withdrawal reason (optional)').fill('The site programme changed.');
 await detail.getByRole('button',{name:'Confirm withdrawal'}).click();
 await expect(page.getByText('Request withdrawn. Completed steps remain in its history.')).toBeVisible();
 await expect(detail.getByText('The site programme changed.',{exact:true})).toBeVisible();
 await expect(detail.getByRole('button',{name:'Withdraw request',exact:true})).toHaveCount(0);
 await page.getByLabel('Show requests').selectOption('mine');
 await page.getByLabel('Request status').selectOption('cancelled');
 await expect(page.getByRole('button',{name:'Open Site cover leave'})).toBeVisible();
 await page.getByRole('button',{name:'Helpdesk',exact:true}).click();
 await page.getByRole('button',{name:'Inbox',exact:true}).first().click();
 await expect(page.getByLabel('Show requests')).toHaveValue('mine');await expect(page.getByLabel('Request status')).toHaveValue('cancelled');
 await page.getByRole('button',{name:'Open Site cover leave'}).focus();await page.keyboard.press('j');await page.keyboard.press('Enter');
 await expect(detail.getByRole('heading',{name:'Site cover leave'})).toBeVisible();
 await page.setViewportSize({width:375,height:812});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['critical','serious'].includes(v.impact||''))).toEqual([]);
 await page.screenshot({path:'.validation/approval-withdrawal-mobile.png',fullPage:true});
});

test('request detail retains rejection reason and keyboard shortcuts do not fire while typing',async({page})=>{
 await loginAs(page);
 await page.getByRole('button',{name:/^Open Roofing materials/}).click();
 const detail=page.getByRole('complementary',{name:'Selected request details'});
 await expect(detail.getByText('Supplier quote reviewed.',{exact:true})).toHaveCount(2);
 await detail.focus();await page.keyboard.press('s');
 const reason=detail.getByLabel('Reason for sending back');await expect(reason).toBeFocused();
 await reason.fill('Attach the updated quote.');await reason.press('a');
 await expect(reason).toHaveValue('Attach the updated quote.a');
 await reason.fill('Attach the updated quote.');
 await detail.getByRole('button',{name:'Confirm send back'}).click();
 await expect(detail.getByText('Attach the updated quote.',{exact:true})).toHaveCount(2);
 await expect(detail.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
 const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['critical','serious'].includes(v.impact||''))).toEqual([]);
 await page.screenshot({path:'.validation/approval-timeline-desktop.png',fullPage:true});
});

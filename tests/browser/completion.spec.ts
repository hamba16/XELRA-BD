import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: import("@playwright/test").Page, profile = "test-director") {
  await page.goto("/"); await page.getByLabel("Development profile").selectOption(profile); await page.getByRole("button", { name: "Log in", exact: true }).click();
}
test("helpdesk discussion and lifecycle preserve drafts and work at a narrow viewport", async ({ page }) => {
  await login(page); await page.getByRole("button", { name: "Helpdesk", exact: true }).click();
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Ask IT for help" }) });
  await form.getByLabel("Title", { exact: true }).fill("Link unavailable"); await form.getByLabel("Description", { exact: true }).fill("The project document link fails."); await form.getByLabel("Category", { exact: true }).fill("Access");
  await page.getByRole("button", { name: /^Inbox(?: \d+)?$/ }).first().click();
  await page.getByRole("button", { name: "Helpdesk", exact: true }).click();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Link unavailable");
  await form.getByRole("button", { name: "Send ticket" }).click();
  await page.getByRole("button", { name: "Link unavailable", exact: true }).click();
  await page.getByLabel("Reply", { exact: true }).fill("This started this morning."); await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByText("This started this morning.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark acknowledged", exact: true }).click();
  await page.getByRole("button", { name: "Mark in progress", exact: true }).click();
  await page.getByRole("button", { name: "Mark resolved", exact: true }).click();
  await expect(page.getByText("Status: resolved", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations.filter(v => ["serious", "critical"].includes(v.impact || ""))).toEqual([]);
});
test("checklist templates produce completable runs and registers keep lifecycle edits", async ({ page }) => {
  await login(page); await page.getByRole("button", { name: "Helpdesk", exact: true }).click(); await page.getByRole("button", { name: "Checklists", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Induction tasks"); await page.getByLabel("Tasks — one per line").fill("Confirm contact\nRecord equipment");
  await page.locator("form").filter({ has: page.getByRole("heading", { name: "Create checklist template" }) }).getByRole("button", { name: "Save", exact: true }).click();
  const start = page.locator("form").filter({ has: page.getByRole("heading", { name: "Start checklist run" }) });
  await start.getByLabel("Person, project or asset reference").fill("Synthetic staff"); await start.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Complete task", exact: true }).first().click(); await page.getByRole("button", { name: "Complete task", exact: true }).click();
  await page.getByRole("button", { name: "Complete checklist", exact: true }).click(); await expect(page.getByText(/completed · Due/)).toBeVisible();
  await page.getByRole("button", { name: "Registers", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Survey kit"); await page.getByLabel("Description", { exact: true }).fill("Synthetic instrument"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Survey kit", exact: true }).click();
  const edit = page.locator("form").filter({ has: page.getByRole("heading", { name: "Update record" }) }); await edit.getByLabel("Record status").selectOption("inactive"); await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Survey kit" })).toContainText("inactive");
});
test("reconciliation reviews a many-to-one group and exports its history", async ({ page }) => {
  await login(page); await page.getByRole("button", { name: "Finance", exact: true }).click(); await page.getByRole("button", { name: "Reconciliation", exact: true }).click();
  const header = "reference,date,amount,description\n";
  await page.getByLabel("Bank CSV").setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from(header + "B,2026-11-01,300,Settlement") });
  await page.getByLabel("Ledger CSV").setInputFiles({ name: "ledger.csv", mimeType: "text/csv", buffer: Buffer.from(header + "L1,2026-11-01,100,First bill\nL2,2026-11-02,200,Second bill") });
  await page.getByRole("checkbox").nth(0).check(); await page.getByRole("checkbox").nth(1).check(); await page.getByRole("checkbox").nth(2).check();
  await page.getByRole("button", { name: "Confirm selected match" }).click(); await expect(page.getByText(/1 reviewed matches/)).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export review history" }).click(); expect((await download).suggestedFilename()).toBe("xelra-shadow-reconciliation.csv");
});
test("local files are profile-isolated and reject corrupted bytes", async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async () => {
    const { LocalFileStore } = await import("/src/local-files.ts");
    const first = new LocalFileStore("test-file-owner"), other = new LocalFileStore("test-file-other");
    const file = await first.put("file", new File(["%PDF-1.4\nSynthetic"], "sample.pdf", { type: "application/pdf" }));
    const hidden = await other.get("file"); const saved = await first.get("file");
    const second = new LocalFileStore("test-file-owner");
    const concurrent = await Promise.allSettled([
      first.put("race", new File(["%PDF-1.4\nOne"], "one.pdf", { type: "application/pdf" })),
      second.put("race", new File(["%PDF-1.4\nTwo"], "two.pdf", { type: "application/pdf" })),
    ]);
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("xelra-files-test-file-owner", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => { const tx = database.transaction("files", "readwrite"); tx.objectStore("files").put({ ...saved, blob: new Blob(["corrupted"]) }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    let corruptRejected = false;
    try { await first.get("file"); } catch { corruptRejected = true; }
    await first.remove("file");
    await first.remove("race");
    return { hidden, digest: file.sha256, readBack: saved?.sha256, corruptRejected, rejectedWrites: concurrent.filter(r => r.status === "rejected").length };
  });
  expect(result.hidden).toBeNull(); expect(result.digest).toMatch(/^[0-9a-f]{64}$/); expect(result.readBack).toBe(result.digest);
  expect(result.corruptRejected).toBe(true); expect(result.rejectedWrites).toBe(1);
});

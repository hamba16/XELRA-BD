import { defineConfig } from "@playwright/test";
const testProfiles = [
  {
    id: "test-director",
    name: "Sample Director",
    principal: "staff",
    permissions: [
      "view.combined",
      "projects.read",
      "documents.read",
      "documents.create",
      "documents.manage",
      "documents.release",
      "people.read",
      "records.read",
      "records.create",
      "approvals.read",
      "payroll.read",
      "expense.depthead",
      "projects.manage", "hr.manage", "people.manage", "checklists.manage",
      "registers.manage", "suppliers.manage", "helpdesk.manage", "audit.read",
      "finance.read", "finance.manage",
    ],
    divisions: ["ENG", "AMG"],
  },
  {
    id: "test-staff",
    name: "Sample Staff",
    principal: "staff",
    permissions: ["leave.read"],
    divisions: ["ENG"],
  },
];
export default defineConfig({
  testDir: "tests/browser",
  use: { baseURL: "http://127.0.0.1:3001", headless: true },
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
    env: {
      VERCEL_ENV: "preview",
      VITE_DEV_LOGIN: "true",
      VITE_DEV_PROFILES: JSON.stringify(testProfiles),
      VITE_SUPABASE_URL: "https://production-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-production-publishable-key",
      VITE_PREVIEW_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_PREVIEW_SUPABASE_PUBLISHABLE_KEY: "test-preview-publishable-key",
    },
  },
  reporter: "list",
});

import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  envDir: "../..",
  define: {
    __XELRA_VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ""),
  },
  build: { outDir: "../../out", emptyOutDir: true, sourcemap: false },
});

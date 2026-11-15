import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 每次构建一个编号：打进页面，同时写到 version.json。页面定时取 version.json，编号不同就说明已经部署了新版本，
// 右上角出现「更新」按钮（src/ui/UpdateBadge.tsx）
const BUILD_ID = new Date().toISOString();
const versionFile = (): Plugin => ({
  name: 'vcita-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) + '\n' });
  },
});

// base: './' 让同一份构建产物可以部署在根路径或任意子路径（CF Pages / Vercel / GitHub Pages）
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), versionFile()],
});

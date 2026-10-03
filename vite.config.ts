import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 让同一份构建产物可以部署在根路径或任意子路径（CF Pages / Vercel / GitHub Pages）
export default defineConfig({
  base: './',
  plugins: [react()],
});

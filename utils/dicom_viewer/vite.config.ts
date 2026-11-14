import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// 使用相對路徑 base，確保發佈至 GitHub Pages 任何子路徑皆可正常載入資源
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
});

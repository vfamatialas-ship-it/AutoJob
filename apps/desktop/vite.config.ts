import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Tauri 期望固定端口，且失败时不要静默换端口
  server: { port: 5183, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  clearScreen: false,
});

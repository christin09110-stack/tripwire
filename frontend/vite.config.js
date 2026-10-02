import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000, target: 'es2022', sourcemap: false,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('node_modules/ag-studio')) return 'ag-studio';
      if (id.includes('node_modules/ag-charts')) return 'ag-charts';
      if (id.includes('node_modules/ag-grid') || id.includes('node_modules/ag-stack')) return 'ag-grid';
      if (id.includes('node_modules/react')) return 'react';
    } } },
  },
  server: { port: 5190, fs: { allow: ['..'] } },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development') },
});

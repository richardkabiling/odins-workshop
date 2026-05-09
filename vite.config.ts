import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/odins-workshop/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['glpk.js'],
  },
  test: {
    environment: 'node',
  },
});

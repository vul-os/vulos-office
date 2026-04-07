import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-tiptap': [
            '@tiptap/react', '@tiptap/starter-kit',
            '@tiptap/extension-image', '@tiptap/extension-link',
            '@tiptap/extension-table', '@tiptap/extension-table-row',
            '@tiptap/extension-table-cell', '@tiptap/extension-table-header',
            '@tiptap/extension-text-align', '@tiptap/extension-text-style',
            '@tiptap/extension-color', '@tiptap/extension-highlight',
            '@tiptap/extension-underline', '@tiptap/extension-task-list',
            '@tiptap/extension-task-item', '@tiptap/extension-character-count',
            '@tiptap/extension-placeholder', '@tiptap/extension-typography',
          ],
          'vendor-sheets': ['@fortune-sheet/react'],
          'vendor-slides': ['reveal.js', 'pptxgenjs'],
          'vendor-export': ['docx', 'xlsx', 'file-saver', 'turndown', 'mammoth'],
          'vendor-pdf': ['pdfjs-dist', 'pdf-lib', 'signature_pad'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})

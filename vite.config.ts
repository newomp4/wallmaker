import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * After Effects panel build (`vite build --mode cep`): the page is loaded from file:// inside
 * Adobe CEP (Chromium 99), where ES-module <script type="module"> tags are blocked by CORS.
 * So we emit one classic IIFE bundle and strip module attributes from the HTML.
 */
function cepHtmlPlugin(): Plugin {
  return {
    name: 'wallmaker-cep-html',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
          .replace(/<script type="module" crossorigin src="/g, '<script defer src="')
          .replace(/<script type="module" src="/g, '<script defer src="')
          .replace(/ crossorigin(="[^"]*")?/g, '')
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const CEP = mode === 'cep' || !!process.env.WALLMAKER_CEP
  return {
    plugins: [react(), ...(CEP ? [cepHtmlPlugin()] : [])],
    base: CEP ? './' : '/',
    build: CEP
      ? {
          target: 'chrome99',
          outDir: 'cep/client',
          emptyOutDir: true,
          assetsInlineLimit: 8 * 1024 * 1024,
          modulePreload: false,
          cssCodeSplit: false,
          rollupOptions: {
            output: {
              format: 'iife',
              inlineDynamicImports: true,
              entryFileNames: 'assets/wallmaker.js',
              assetFileNames: 'assets/[name][extname]',
            },
          },
        }
      : { target: 'es2022' },
  }
})

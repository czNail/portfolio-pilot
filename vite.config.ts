import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { headerMarkup, footerMarkup } from './vendor/site-ui/shell.mjs';
export default defineConfig({
  plugins: [react(), { name: 'shared-site-shell', transformIndexHtml: html => html.replace('<!-- site-ui:runtime -->', '<script src="/portfolio-pilot/site-ui/runtime.js"></script>').replace('<!-- site-ui:header -->', headerMarkup({ active: 'portfolio-pilot' })).replace('<!-- site-ui:footer -->', footerMarkup()) }],
  base: '/portfolio-pilot/',
  server: { allowedHosts: ['terminal.local'] },
});

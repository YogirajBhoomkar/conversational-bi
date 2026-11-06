// TEMPORARY: builds the demo page (ui/demo) into ui/dist-demo, with the main UI's settings. Remove with ui/demo.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({ root: 'demo', build: { outDir: '../dist-demo', emptyOutDir: true } }));

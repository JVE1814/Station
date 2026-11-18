import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /three\/build\/three\.core/ },
            { name: 'three-renderer', test: /three\/build\/three\.module/ },
          ],
        },
      },
    },
  },
});

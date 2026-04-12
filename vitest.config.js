import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    // Isola o registry de módulos entre arquivos de teste —
    // garante que mocks de um arquivo não vazam para outro
    isolate: true,
  },
});

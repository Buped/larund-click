import { defineConfig } from 'vitest/config';

// Unit tests for the Vision Mouse V2 pure logic (coordinates, geometry, text
// matching, plan schema). Node environment — no DOM/Tauri needed for these.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

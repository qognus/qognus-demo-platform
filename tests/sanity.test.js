import { describe, it, expect } from 'vitest';

describe('System Sanity Check', () => {
  it('should pass this basic math test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should verify the web folder exists', () => {
    const fs = require('fs');
    expect(fs.existsSync('./web')).toBe(true);
  });
});
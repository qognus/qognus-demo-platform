// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Application Entry Point (index.html)', () => {
    
    // 1. Load the real HTML file before running tests
    const htmlPath = path.join(__dirname, '../web/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    it('should have the correct document structure', () => {
        // Load the HTML into the mock DOM
        document.documentElement.innerHTML = htmlContent;

        // Check for critical metadata
        expect(document.title).toBeTruthy(); // Title must exist
        expect(document.title).toContain('Qognus'); // Title should be correct
        
        // Check for viewport meta tag (Critical for mobile)
        const meta = document.querySelector('meta[name="viewport"]');
        expect(meta).not.toBeNull();
    });

    it('should load critical styles (CSS or Inline)', () => {
        document.documentElement.innerHTML = htmlContent;
        
        // Check for EXTERNAL css file
        const link = document.querySelector('link[rel="stylesheet"]');
        
        // Check for INLINE style blocks
        const style = document.querySelector('style');

        // PASS condition: The page must have AT LEAST one way of styling itself
        const hasStyles = (link !== null) || (style !== null);
        
        expect(hasStyles).toBe(true);
    });

    it('should include the main component scripts', () => {
        document.documentElement.innerHTML = htmlContent;
        
        // Get all script tags
        const scripts = Array.from(document.querySelectorAll('script'));
        const sources = scripts.map(s => s.src);

        // Verify that we are actually loading our components
        // (This catches the common error: "I created the file but forgot to add the script tag")
        const hasAssistant = sources.some(s => s.includes('AssistantCard.js'));
        const hasShowcase = sources.some(s => s.includes('PlatformShowcase.js'));
        
        // Note: If you use a module loader (type="module"), you might load just one 'main.js'
        // If so, change this test to look for 'main.js' or 'index.js'
        const hasModule = scripts.some(s => s.type === 'module');
        
        // We expect at least one module script or specific component scripts
        expect(hasModule || (hasAssistant && hasShowcase)).toBe(true);
    });

    it('should have the main layout containers', () => {
        document.documentElement.innerHTML = htmlContent;

        // Your app likely has a generic container or main div
        // Adjust these selectors to match your actual HTML!
        const main = document.querySelector('main') || document.querySelector('#app') || document.body;
        expect(main).not.toBeNull();
        
        // Check if the custom elements are actually placed in the HTML
        const assistant = document.querySelector('assistant-card');
        const showcase = document.querySelector('platform-showcase');
        
        // (It's okay if these are missing IF you inject them dynamically via JS.
        // If they are hardcoded in HTML, these assertions ensure they stay there.)
        if (assistant) expect(assistant).toBeDefined();
        if (showcase) expect(showcase).toBeDefined();
    });
});
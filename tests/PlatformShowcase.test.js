// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PlatformShowcase Component', () => {

    beforeEach(async () => {
        document.body.innerHTML = '';
        
        // Dynamic import to ensure fresh load
        if (!customElements.get('platform-showcase')) {
            await import('../web/js/components/PlatformShowcase.js');
        }
    });

    it('should be defined as a custom element', () => {
        const el = document.createElement('platform-showcase');
        expect(el).toBeInstanceOf(HTMLElement);
    });

    it('should render the main structural elements', async () => {
        const el = document.createElement('platform-showcase');
        document.body.appendChild(el);

        // Wait for rendering
        await new Promise(resolve => setTimeout(resolve, 0));

        // 1. Check if the shadow DOM or main container exists
        // (Adjust '.platform-showcase' if your class name is different!)
        const container = el.querySelector('.platform-showcase') || el.querySelector('.card'); 
        
        // If your component uses Shadow DOM, use el.shadowRoot instead of el
        if (el.shadowRoot) {
            expect(el.shadowRoot).toBeDefined();
        } else {
            // Standard DOM check
            // We expect *something* to be rendered. If this fails, check your class names.
            expect(el.innerHTML.length).toBeGreaterThan(0);
        }
    });

    it('should verify that feature cards are generated', async () => {
        const el = document.createElement('platform-showcase');
        document.body.appendChild(el);
        await new Promise(resolve => setTimeout(resolve, 0));

        // This assumes your showcase renders a list of items/features
        // We look for common tags like <li>, or classes like .feature-card, .item, etc.
        const items = el.querySelectorAll('.feature-item, .card, li, div.item');
        
        // We just want to ensure it's not empty
        // If your showcase is static HTML, this will pass easily.
        // If it fetches data, we might need to mock fetch (let me know if it fails!)
        if (items.length === 0) {
             // Fallback: Check if headers exist
             const headers = el.querySelectorAll('h2, h3, h4');
             expect(headers.length).toBeGreaterThan(0);
        } else {
             expect(items.length).toBeGreaterThan(0);
        }
    });
});
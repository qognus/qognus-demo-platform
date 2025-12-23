// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Re-use our robust mock to ensure the component loads
global.fetch = vi.fn(() => 
    Promise.resolve({
        ok: true,
        text: async () => `
            <div class="card-body">
                <div id="chat-window"></div>
                <form id="chat-form">
                    <input type="text" id="user-input" placeholder="Ask AI..." />
                    <button type="submit">Send</button>
                </form>
            </div>
        `,
        json: async () => ({ response: "Safe response." }),
        body: {
            getReader: () => ({
                read: () => Promise.resolve({ done: true, value: new Uint8Array() })
            })
        }
    })
);

describe('Security & Input Safety', () => {

    beforeEach(async () => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        if (!customElements.get('assistant-card')) {
            await import('../web/js/components/AssistantCard.js');
        }
    });

    it('should sanitize user input (Prevent XSS)', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);
        await new Promise(resolve => setTimeout(resolve, 0));

        const input = card.querySelector('input');
        const form = card.querySelector('form');
        
        // 1. THE ATTACK
        // We try to inject an HTML tag that would execute code or break the layout
        const maliciousPayload = "<img src=x onerror=alert('HACKED')>";
        
        input.value = maliciousPayload;
        form.dispatchEvent(new Event('submit', { bubbles: true }));

        await new Promise(resolve => setTimeout(resolve, 0));

        const window = card.querySelector('#chat-window');
        const html = window.innerHTML;

        // 2. THE DEFENSE CHECK
        // The HTML should NOT contain the raw image tag executable code.
        // It SHOULD contain the "escaped" version (rendering it as harmless text).
        
        // This fails if the browser executes the image tag
        const isVulnerable = html.includes('<img src="x" onerror="alert(\'HACKED\')">') || 
                             (html.includes('<img') && html.includes('onerror'));
        
        if (isVulnerable) {
            console.error("⚠️ SECURITY VULNERABILITY DETECTED: Input was rendered as raw HTML!");
        }

        expect(isVulnerable).toBe(false);
        
        // Ideally, we expect the text to be safely inside the div, but NOT as a tag
        // e.g., "&lt;img..."
        expect(window.textContent).toContain("onerror=alert"); 
    });

    it('should not crash on extremely long input', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);
        await new Promise(resolve => setTimeout(resolve, 0));

        const input = card.querySelector('input');
        const form = card.querySelector('form');

        // Generate a 10,000 character string
        const longString = "A".repeat(10000);
        
        input.value = longString;
        
        // Should not throw an error
        expect(() => {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
        }).not.toThrow();
        
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Should still be responsive
        const window = card.querySelector('#chat-window');
        expect(window).not.toBeNull();
    });
});
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ------------------------------------------------------------------
// 1. ROBUST MOCK (Fixed IDs + Added Stream Support)
// ------------------------------------------------------------------
global.fetch = vi.fn(() => 
    Promise.resolve({
        ok: true,
        // Mock the HTML template (We aligned this ID with your actual code)
        text: async () => `
            <div class="card-body">
                <div id="kb-status"></div>
                <div id="chat-window"></div> 
                <form id="chat-form">
                    <input type="text" id="user-input" placeholder="Ask AI..." />
                    <button type="submit">Send</button>
                </form>
            </div>
        `,
        // Mock the API response (Handling JSON vs Streams)
        json: async () => ({ response: "System Status: Nominal." }),
        
        // FIX FOR THE "getReader" ERROR:
        // We provide a fake "body" that mimics a readable stream
        body: {
            getReader: () => ({
                read: () => Promise.resolve({ done: true, value: new Uint8Array() })
            })
        }
    })
);

describe('Assistant Chat Flow', () => {

    beforeEach(async () => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        if (!customElements.get('assistant-card')) {
            await import('../web/js/components/AssistantCard.js');
        }
    });

    it('should display the user message after sending', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);
        
        // 1. Wait for render
        await new Promise(resolve => setTimeout(resolve, 0));

        // 2. Find elements
        const input = card.querySelector('input');
        const form = card.querySelector('form');
        
        if (!input || !form) throw new Error("Chat interface failed to render");

        // 3. Simulate Typing
        input.value = "Run Diagnostics";
        
        // 4. Send
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        // 5. Wait for UI update
        await new Promise(resolve => setTimeout(resolve, 0));

        // 6. Find the Window (Fixed ID here!)
        const window = card.querySelector('#chat-window');

        // Debug again if it fails (just in case)
        if (!window) {
            console.log("Still missing! Dumping HTML:", card.innerHTML);
        }

        // 7. Assert
        expect(window).not.toBeNull();
        expect(window.innerHTML).toContain("Run Diagnostics");
    });

    it('should clear the input field after sending', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);
        await new Promise(resolve => setTimeout(resolve, 0));

        const input = card.querySelector('input');
        const form = card.querySelector('form');

        if (!input) return;

        input.value = "Hello AI";
        form.dispatchEvent(new Event('submit'));
        
        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(input.value).toBe(''); 
    });

    it('should trigger an API call when message is sent', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);
        await new Promise(resolve => setTimeout(resolve, 0));

        const form = card.querySelector('form');
        const input = card.querySelector('input');
        
        if (!form) return;

        vi.clearAllMocks(); // Clear initial load fetch

        input.value = "Status Report";
        form.dispatchEvent(new Event('submit'));

        expect(global.fetch).toHaveBeenCalled();
    });
});
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ------------------------------------------------------------------
// 1. Setup the Network Mock
// ------------------------------------------------------------------
// We mock 'fetch' to handle two different types of requests:
// A. Requests for HTML templates (returns a string with a form)
// B. Requests for API data (returns a JSON object)
global.fetch = vi.fn(() => 
    Promise.resolve({
        ok: true,
        // If the code asks for JSON (e.g., API response)
        json: async () => ({ 
            response: "System operational", 
            data: [] 
        }),
        // If the code asks for Text (e.g., the HTML template)
        text: async () => `
            <div class="card-body">
                <div id="kb-status"></div>
                <div id="chat-history"></div>
                <form id="chat-form">
                    <input type="text" id="chat-input" placeholder="Ask AI..." />
                    <button type="submit">Send</button>
                </form>
            </div>
        `
    })
);

// ------------------------------------------------------------------
// 2. The Test Suite
// ------------------------------------------------------------------
describe('AssistantCard Component', () => {
    
    beforeEach(async () => {
        // Clear history of calls to fetch
        vi.clearAllMocks();
        
        // Clean up the fake browser body
        document.body.innerHTML = '';

        // Dynamically import the component if it's not already defined
        // This ensures the custom element is registered in the DOM
        if (!customElements.get('assistant-card')) {
            await import('../web/js/components/AssistantCard.js');
        }
    });

    it('should render the chat interface correctly', async () => {
        // Create and attach the element
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);

        // Wait for the "micro-tasks" (like fetch) to finish running
        await new Promise(resolve => setTimeout(resolve, 0));

        // CHECK 1: Did it create the form?
        const form = card.querySelector('form');
        expect(form).not.toBeNull(); // The form should exist now!

        // CHECK 2: Is the input field there?
        const input = card.querySelector('input');
        expect(input).not.toBeNull();
        expect(input.placeholder).toBe('Ask about anomalies...');
    });

    it('should attempt to fetch data on load', async () => {
        const card = document.createElement('assistant-card');
        document.body.appendChild(card);

        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        // CHECK: Did the component try to call the internet?
        expect(global.fetch).toHaveBeenCalled();
    });
});
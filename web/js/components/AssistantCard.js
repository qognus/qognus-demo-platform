import { BaseCard } from './BaseCard.js';

export class AssistantCard extends BaseCard {
  constructor() {
    super();
    this.messages = [];
    this.kb = []; 
    this.isBusy = false;
    this.config = {
        model: "qwen3", 
        host: "http://localhost:11434"
    };
  }

  async connectedCallback() {
    this.innerHTML = this.getTemplate();
    this.afterRender();
  }

  getTemplate() {
    return `
      <section class="max-w-6xl mx-auto mt-8 bg-slate-900/90 border border-indigo-500/30 rounded-3xl p-1 shadow-[0_0_40px_-10px_rgba(99,102,241,0.2)] backdrop-blur-md fade-in">
        <div class="flex flex-col md:flex-row h-[600px]">
            
            <div class="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-800 p-6 flex flex-col bg-slate-950/50 rounded-l-3xl">
                <div class="mb-6">
                    <h3 class="text-xl font-bold text-white flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                        ApexGrid Copilot
                    </h3>
                    <p class="text-sm text-slate-400 mt-2">
                        AI Incident Commander capable of analyzing telemetry across all 4 product lines.
                    </p>
                </div>
                <div class="flex-1 overflow-y-auto pr-2 space-y-3">
                    <div class="p-3 rounded-xl border border-slate-800 bg-slate-900/50 text-xs text-slate-300">
                        📚 <strong>Local RAG:</strong> Access to runbooks and specs for HelioCloud, GridSense, LineaOps, and VaultShield.
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-800">
                    <div class="flex items-center justify-between text-xs text-slate-500">
                        <span>Model:</span>
                        <span class="font-mono text-indigo-400">${this.config.model}</span>
                    </div>
                    <div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                        <span>KB Status:</span>
                        <span class="font-mono text-emerald-400" id="kb-status">Loading...</span>
                    </div>
                </div>
            </div>

            <div class="flex-1 flex flex-col relative bg-slate-900/30 rounded-r-3xl">
                <div id="chat-window" class="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                    <div class="flex gap-4">
                        <div class="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 flex-shrink-0 text-indigo-300 font-bold text-xs">AG</div>
                        <div class="space-y-1">
                            <div class="text-xs text-slate-500 font-bold">Copilot</div>
                            <div class="text-sm text-slate-300 leading-relaxed bg-slate-800/50 p-3 rounded-2xl rounded-tl-none border border-slate-700/50">
                                Systems operational. Ready to assist.
                            </div>
                        </div>
                    </div>
                </div>

                <div class="p-4 border-t border-slate-800 bg-slate-950/30 rounded-br-3xl">
                    <form id="chat-form" class="relative">
                        <input type="text" id="user-input" class="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:border-indigo-500 placeholder-slate-600 transition-all" placeholder="Ask about anomalies..." autocomplete="off">
                        <button type="submit" id="send-btn" class="absolute right-2 top-2 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7"></path></svg>
                        </button>
                    </form>
                </div>
            </div>
        </div>
      </section>
    `;
  }

  async afterRender() {
    this.chatWindow = this.querySelector('#chat-window');
    this.input = this.querySelector('#user-input');
    this.form = this.querySelector('#chat-form');
    this.sendBtn = this.querySelector('#send-btn');
    this.kbStatus = this.querySelector('#kb-status');

    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.handleSend(); });
    await this.loadKnowledgeBase();
  }

  async loadKnowledgeBase() {
    try {
        const manifestRes = await fetch('./assets/manifest.json');
        if(!manifestRes.ok) { if(this.kbStatus) this.kbStatus.innerText = "No Manifest"; return; }
        const manifest = await manifestRes.json();
        
        const promises = (manifest.products || []).map(async (slug) => {
            try {
                const res = await fetch(`./assets/${slug}_facts.json`);
                if(res.ok) {
                    const data = await res.json();
                    this.addFact(slug, "Overview", data.tagline);
                    (data.capabilities || []).forEach(c => this.addFact(slug, "Capability", c));
                    (data.runbooks || []).forEach(rb => {
                        const steps = (rb.steps || []).join(" -> ");
                        this.addFact(slug, `Runbook: ${rb.title}`, steps);
                    });
                }
            } catch(e) {}
        });
        await Promise.all(promises);
        if(this.kbStatus) this.kbStatus.innerText = `Active (${this.kb.length} fragments)`;
    } catch (e) { if(this.kbStatus) this.kbStatus.innerText = "Offline"; }
  }

  addFact(product, type, content) {
    this.kb.push({ text: `[${product.toUpperCase()} ${type}] ${content}`, raw: content.toLowerCase() });
  }

  retrieveContext(query) {
    const q = query.toLowerCase();
    const words = q.split(' ').filter(w => w.length > 3);
    const hits = this.kb.filter(item => words.some(w => item.raw.includes(w)));
    return [...new Set(hits.map(h => h.text))].slice(0, 3).join("\n");
  }

  // --- RAW STREAMING FETCH ---
  async streamResponse(messages, onChunk) {
    const response = await fetch(`${this.config.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: this.config.model,
            messages: messages,
            stream: true,
            options: { temperature: 0.3 }
        })
    });

    if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        // Handle NDJSON (multiple JSON objects in one chunk)
        const lines = chunk.split("\n").filter(line => line.trim() !== "");
        
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.message && json.message.content) {
                    onChunk(json.message.content);
                }
                if (json.done) return;
            } catch (e) {
                // Ignore partial JSON lines
            }
        }
    }
  }

  formatText(text) {
    if (!text) return "";
    // 1. Remove <think> blocks for clean display
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    
    // 2. If we are inside a think block but it hasn't closed yet, hide everything
    if (text.includes("<think>") && !text.includes("</think>")) {
        return '<span class="animate-pulse text-indigo-400 font-mono text-xs">Thinking...</span>';
    }

    // 3. Markdown formatting
    return cleanText
        .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
        .replace(/`(.*?)`/g, '<code class="bg-black/30 rounded px-1 py-0.5 text-indigo-300 font-mono text-xs">$1</code>')
        .replace(/\n/g, '<br>');
  }

  async handleSend() {
    const text = this.input.value.trim();
    if (!text || this.isBusy) return;

    this.appendMessage('user', text);
    this.input.value = '';
    this.isBusy = true;
    this.sendBtn.disabled = true;
    this.input.disabled = true;

    // Initial Placeholder
    const container = this.appendMessage('assistant', '<span class="animate-pulse text-indigo-400 font-mono text-xs">Thinking...</span>');
    const msgContent = container.querySelector('.msg-content');

    const context = this.retrieveContext(text);
    const systemPrompt = `You are the ApexGrid Incident Commander. Use this context:\n${context}\nAnswer concisely.`;

    const apiMessages = [
        { role: "system", content: systemPrompt },
        ...this.messages.slice(-3),
        { role: "user", content: text }
    ];

    let fullText = "";

    try {
        await this.streamResponse(apiMessages, (chunk) => {
            fullText += chunk;
            // Update UI on every chunk
            msgContent.innerHTML = this.formatText(fullText);
            this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
        });

        this.messages.push({ role: "user", content: text });
        this.messages.push({ role: "assistant", content: fullText });

    } catch (err) {
        msgContent.innerHTML = `<span class="text-red-400">Error: ${err.message}</span>`;
    } finally {
        this.isBusy = false;
        this.sendBtn.disabled = false;
        this.input.disabled = false;
        this.input.focus();
    }
  }

  appendMessage(role, text) {
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = `flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`;
    
    const avatar = isUser 
        ? `<div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600 flex-shrink-0 text-slate-300 text-xs">You</div>`
        : `<div class="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 flex-shrink-0 text-indigo-300 font-bold text-xs">AG</div>`;

    const bubbleColor = isUser ? 'bg-indigo-600 text-white' : 'bg-slate-800/50 border border-slate-700/50 text-slate-300 min-w-[60px]';

    div.innerHTML = `
        ${avatar}
        <div class="space-y-1 max-w-[80%]">
            <div class="text-xs text-slate-500 font-bold ${isUser ? 'text-right' : ''}">${isUser ? 'Operator' : 'Copilot'}</div>
            <div class="text-sm leading-relaxed ${bubbleColor} p-3 rounded-2xl ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'} msg-content">
                ${text}
            </div>
        </div>
    `;
    
    this.chatWindow.appendChild(div);
    this.chatWindow.scrollTop = this.chatWindow.scrollHeight;
    return div;
  }
}

customElements.define('assistant-card', AssistantCard);
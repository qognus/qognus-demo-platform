import { BaseCard } from './BaseCard.js';

// --- TOOL DEFINITIONS ---
const TOOL_REGISTRY = {
    'check_lineaops': async () => {
        try {
            const res = await fetch('./data/lineaops_data.json');
            if (!res.ok) return "Error: LineaOps data unavailable.";
            const data = await res.json();
            const metrics = data.metrics || {};
            const critical = Object.entries(metrics).filter(([_, m]) => m.status === 'CRITICAL').map(([k]) => k);
            return `[LineaOps Live] Shift: ${data.shift_duration_hours}h. Critical: ${critical.join(', ') || 'None'}. OEE: ${Object.entries(metrics).map(([k, m]) => `${k}=${m.oee}%`).join(', ')}`;
        } catch (e) { return "Error reading LineaOps."; }
    },
    'check_gridsense': async () => {
        try {
            const res = await fetch('./data/gridsense_timeseries.json');
            if (!res.ok) return "Error: GridSense data unavailable.";
            const data = await res.json();
            const anomalies = (data.series || []).filter(d => d.predicted_anomaly === 1);
            return `[GridSense Live] Health: ${(100 - (data.summary?.contamination || 0)*100).toFixed(1)}%. Active Anomalies: ${anomalies.length}.`;
        } catch (e) { return "Error reading GridSense."; }
    },
    'check_vaultshield': async () => {
        try {
            const res = await fetch('./data/vaultshield_artifacts.json');
            if (!res.ok) return "Error: VaultShield data unavailable.";
            const data = await res.json();
            return `[VaultShield Live] Blocked Threats: ${Object.values(data.attack_counts || {}).reduce((a,b)=>a+b,0)}. Top Attack: ${data.top_anomaly?.attack_type || 'None'}.`;
        } catch (e) { return "Error reading VaultShield."; }
    },
    'check_heliocloud': async () => {
        try {
            const res = await fetch('./data/model_health.json');
            if (!res.ok) return "Error: HelioCloud data unavailable.";
            const data = await res.json();
            return `[HelioCloud Live] Drift: ${data.drift_detected}. Noise Ratio: ${(data.noise_ratio * 100).toFixed(1)}%.`;
        } catch (e) { return "Error reading HelioCloud."; }
    }
};

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
                    <p class="text-sm text-slate-400 mt-2">AI Incident Commander.</p>
                </div>
                <div class="flex-1 overflow-y-auto pr-2 space-y-3">
                    <div class="p-3 rounded-xl border border-slate-800 bg-slate-900/50 text-xs text-slate-300">
                        📚 <strong>Local RAG Active</strong>
                    </div>
                    <div class="p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-xs text-indigo-200">
                        🛠️ <strong>Live Tools Ready</strong>
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-800">
                    <div class="flex items-center justify-between text-xs text-slate-500">
                        <span>Model:</span><span class="font-mono text-indigo-400">${this.config.model}</span>
                    </div>
                    <div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                        <span>KB:</span><span class="font-mono text-emerald-400" id="kb-status">Loading...</span>
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
                                Systems operational. I have access to live tools. How can I assist?
                            </div>
                        </div>
                    </div>
                </div>
                <div class="p-4 border-t border-slate-800 bg-slate-950/30 rounded-br-3xl">
                    <form id="chat-form" class="relative">
                        <input type="text" id="user-input" class="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:border-indigo-500 placeholder-slate-600" placeholder="Ask about anomalies..." autocomplete="off">
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
            } catch(e) { }
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

  // --- SAFE & ROBUST RENDERER ---
  renderOutput(rawText) {
    // 1. Remove closed <think> blocks entirely
    let clean = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
    
    // 2. Check if we are currently inside an unclosed <think> block
    //    Strategy: If last <think> is after last </think>, we are thinking.
    const lastOpen = rawText.lastIndexOf("<think>");
    const lastClose = rawText.lastIndexOf("</think>");
    
    if (lastOpen > lastClose) {
        // We are currently thinking. Show spinner.
        return '<span class="animate-pulse text-indigo-400 font-mono text-xs">Thinking...</span>';
    }

    // 3. Highlight Tool Calls
    clean = clean.replace(/\[\[call:(.*?)\]\]/g, '<span class="text-indigo-400 font-mono text-xs bg-indigo-500/10 px-1 rounded">🛠️ Calling Tool: $1...</span>');

    // 4. Basic Markdown
    clean = clean
        .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
        .replace(/`(.*?)`/g, '<code class="bg-black/30 rounded px-1 py-0.5 text-indigo-300 font-mono text-xs">$1</code>')
        .replace(/\n/g, '<br>');

    return clean;
  }

  async streamResponse(messages, onChunk) {
    const response = await fetch(`${this.config.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: this.config.model,
            messages: messages,
            stream: true,
            options: { temperature: 0.1 } // Low temp for reliability
        })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const json = JSON.parse(line);
                if (json.message?.content) onChunk(json.message.content);
            } catch (e) {}
        }
    }
  }

  async handleSend() {
    const text = this.input.value.trim();
    if (!text || this.isBusy) return;

    this.appendMessage('user', text);
    this.input.value = '';
    this.isBusy = true;
    this.sendBtn.disabled = true;
    this.input.disabled = true;

    // Create Assistant Bubble
    const container = this.appendMessage('assistant', '<span class="animate-pulse text-indigo-400 font-mono text-xs">Thinking...</span>');
    const msgContent = container.querySelector('.msg-content');

    const context = this.retrieveContext(text);
    
    // Optimized System Prompt for Tool Use
    const systemPrompt = `
You are the ApexGrid Incident Commander.
CONTEXT:
${context}

TOOLS AVAILABLE:
- check_lineaops
- check_gridsense
- check_vaultshield
- check_heliocloud

INSTRUCTIONS:
1. If you need live data, output ONLY: [[call:tool_name]]
2. Stop generating after the tool call.
3. Once you receive the tool output, answer concisely.
`;

    // Ensure we start with system prompt
    if (this.messages.length === 0 || this.messages[0].role !== 'system') {
        this.messages = [{ role: "system", content: systemPrompt }];
    } else {
        this.messages[0].content = systemPrompt; // Update context
    }

    this.messages.push({ role: "user", content: text });

    await this.runAgentLoop(msgContent);
  }

  async runAgentLoop(msgContent) {
    let turnCount = 0;
    const MAX_TURNS = 3;

    while (turnCount < MAX_TURNS) {
        turnCount++;
        let fullText = "";
        let toolCallFound = null;

        try {
            await this.streamResponse(this.messages, (token) => {
                fullText += token;
                
                // Real-time rendering using the Robust Renderer
                msgContent.innerHTML = this.renderOutput(fullText);
                this.chatWindow.scrollTop = this.chatWindow.scrollHeight;

                // Check for tool call
                const match = fullText.match(/\[\[call:(.*?)\]\]/);
                if (match) toolCallFound = match[1];
            });

            this.messages.push({ role: "assistant", content: fullText });

            if (toolCallFound) {
                const toolFn = TOOL_REGISTRY[toolCallFound];
                if (toolFn) {
                    msgContent.innerHTML += `<div class="mt-2 text-xs text-emerald-400">⚡ Executing ${toolCallFound}...</div>`;
                    const result = await toolFn();
                    this.messages.push({ role: "system", content: `TOOL_OUTPUT:\n${result}` });
                    continue; // Loop again to let model explain results
                }
            }
            break; // No tool call, finished

        } catch (err) {
            msgContent.innerHTML += `<br><span class="text-red-400">Error: ${err.message}</span>`;
            break;
        }
    }

    this.isBusy = false;
    this.sendBtn.disabled = false;
    this.input.disabled = false;
    this.input.focus();
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
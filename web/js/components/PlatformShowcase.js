export class PlatformShowcase extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="relative max-w-5xl mx-auto mt-10 mb-20 fade-in">
        
        <div class="text-center mb-16">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono mb-6">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                SYSTEM READY
            </div>
            <h1 class="text-6xl md:text-7xl font-bold tracking-tight text-white mb-6">
                ApexGrid <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Platform</span>
            </h1>
            <p class="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
                A local-first <strong>Vertical AI</strong> demonstration suite. Experience autonomous agents, physics-informed digital twins, and real-time anomaly detection—running entirely on your hardware.
            </p>
            
            <div class="mt-10">
                <button id="launch-btn" class="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-200 bg-indigo-600 font-lg rounded-full hover:bg-indigo-500 hover:scale-105 focus:outline-none ring-offset-2 focus:ring-2 ring-indigo-400">
                    <span class="mr-2">Initialize Systems</span>
                    <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <div class="absolute -inset-3 rounded-full bg-indigo-400/20 blur-lg group-hover:opacity-100 opacity-0 transition-opacity duration-200"></div>
                </button>
                <p class="mt-4 text-xs text-slate-500 font-mono">⚠️ Caution: Loads 3D Environments & Live Telemetry</p>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 px-4">
            
            <div class="col-span-1 md:col-span-2 p-1 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 cursor-pointer hover:scale-[1.01] transition-transform launch-trigger" data-target="assistant-card">
                <div class="h-full bg-slate-950/80 backdrop-blur-xl rounded-[1.4rem] p-8 relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-4 opacity-20"><svg class="w-32 h-32 text-indigo-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 18a8 8 0 118-8 8 8 0 01-8 8z"/><path d="M12 6a1 1 0 00-1 1v4.59l-3.29-3.3a1 1 0 00-1.42 1.42l5 5a1 1 0 001.42 0l5-5a1 1 0 00-1.42-1.42L13 11.59V7a1 1 0 00-1-1z"/></svg></div>
                    <div class="flex items-center gap-3 mb-4">
                        <span class="text-3xl">🧠</span>
                        <h2 class="text-2xl font-bold text-white">ApexGrid Copilot</h2>
                        <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[0.65rem] font-bold uppercase tracking-wider border border-indigo-500/20">Agentic Core</span>
                    </div>
                    <p class="text-slate-300 mb-6 text-sm leading-relaxed max-w-2xl">
                        The central brain. Unlike standard chatbots, this agent possesses <strong>Tool Use</strong> capabilities, allowing it to autonomously query live telemetry to answer questions with real-time facts.
                    </p>
                    <div class="flex flex-wrap gap-2 mb-4">
                        <span class="badge-tech">Ollama (Qwen 3)</span>
                        <span class="badge-tech">RAG</span>
                        <span class="badge-tech">Function Calling</span>
                    </div>
                </div>
            </div>

            <div class="showcase-card group launch-trigger" data-target="heliocloud-card">
                <div class="flex items-center gap-3 mb-3">
                    <span class="text-2xl">☁️</span>
                    <h3 class="text-xl font-bold text-white group-hover:text-sky-300 transition-colors">HelioCloud</h3>
                </div>
                <p class="text-slate-400 text-sm mb-4">
                    3D visualization engine mapping customer sentiment. Moves beyond keyword matching to understand the <em>meaning</em> of complaints via vector space.
                </p>
                <div class="mt-auto border-t border-slate-800 pt-4">
                    <div class="text-xs text-slate-500 font-mono mb-2">Capabilities</div>
                    <ul class="space-y-1 text-xs text-slate-300">
                        <li>• <strong>Vector Space:</strong> 3D interactive clustering.</li>
                        <li>• <strong>Drift Detection:</strong> Flags vocabulary shifts.</li>
                    </ul>
                </div>
            </div>

            <div class="showcase-card group launch-trigger" data-target="gridsense-card">
                <div class="flex items-center gap-3 mb-3">
                    <span class="text-2xl">⚡</span>
                    <h3 class="text-xl font-bold text-white group-hover:text-amber-300 transition-colors">GridSense</h3>
                </div>
                <p class="text-slate-400 text-sm mb-4">
                    Real-time monitor for power grid infrastructure. Tracks high-frequency sensor data to predict instability before blackouts occur.
                </p>
                <div class="mt-auto border-t border-slate-800 pt-4">
                    <div class="text-xs text-slate-500 font-mono mb-2">Capabilities</div>
                    <ul class="space-y-1 text-xs text-slate-300">
                        <li>• <strong>Pre-Cog Alerts:</strong> Identifies micro-sags.</li>
                        <li>• <strong>Physics Noise:</strong> Realistic sensor jitter.</li>
                    </ul>
                </div>
            </div>

            <div class="showcase-card group launch-trigger" data-target="lineaops-card">
                <div class="flex items-center gap-3 mb-3">
                    <span class="text-2xl">🏭</span>
                    <h3 class="text-xl font-bold text-white group-hover:text-emerald-300 transition-colors">LineaOps</h3>
                </div>
                <p class="text-slate-400 text-sm mb-4">
                    Digital twin of a robotic assembly line. Correlates mechanical vibration with cycle time to optimize factory throughput.
                </p>
                <div class="mt-auto border-t border-slate-800 pt-4">
                    <div class="text-xs text-slate-500 font-mono mb-2">Capabilities</div>
                    <ul class="space-y-1 text-xs text-slate-300">
                        <li>• <strong>OEE Tracking:</strong> Availability x Performance.</li>
                        <li>• <strong>Wear Sim:</strong> Degrades joints over time.</li>
                    </ul>
                </div>
            </div>

            <div class="showcase-card group launch-trigger" data-target="vaultshield-card">
                <div class="flex items-center gap-3 mb-3">
                    <span class="text-2xl">🛡️</span>
                    <h3 class="text-xl font-bold text-white group-hover:text-red-300 transition-colors">VaultShield</h3>
                </div>
                <p class="text-slate-400 text-sm mb-4">
                    Cybersecurity watchdog modeling user behavior. Checks <em>patterns of movement</em> through the app to spot intruders.
                </p>
                <div class="mt-auto border-t border-slate-800 pt-4">
                    <div class="text-xs text-slate-500 font-mono mb-2">Capabilities</div>
                    <ul class="space-y-1 text-xs text-slate-300">
                        <li>• <strong>Markov Chains:</strong> Sequence probability.</li>
                        <li>• <strong>Impossible Travel:</strong> Geo-velocity checks.</li>
                    </ul>
                </div>
            </div>

        </div>
      </div>

      <style>
        .showcase-card {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(51, 65, 85, 0.5);
            border-radius: 1.5rem;
            padding: 1.5rem;
            transition: all 0.3s ease;
            display: flex;
            flex-direction: column;
            cursor: pointer;
        }
        .showcase-card:hover {
            background: rgba(30, 41, 59, 0.8);
            border-color: rgba(99, 102, 241, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
        }
        .badge-tech {
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid rgba(71, 85, 105, 0.5);
            color: #94a3b8;
            font-size: 0.7rem;
            padding: 0.25rem 0.5rem;
            border-radius: 0.375rem;
            font-family: monospace;
        }
      </style>
    `;

    // 1. Main Button Listener
    this.querySelector('#launch-btn').addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('launch', { bubbles: true, detail: { target: null } }));
    });

    // 2. Card Click Listeners
    this.querySelectorAll('.launch-trigger').forEach(card => {
        card.addEventListener('click', (e) => {
            const target = card.getAttribute('data-target');
            this.dispatchEvent(new CustomEvent('launch', { 
                bubbles: true, 
                detail: { target: target } 
            }));
        });
    });
  }
}

customElements.define('platform-showcase', PlatformShowcase);
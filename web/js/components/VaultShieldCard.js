import { BaseCard } from './BaseCard.js';

export class VaultShieldCard extends BaseCard {
  constructor() {
    super();
    this.charts = {};
  }

  disconnectedCallback() {
    Object.values(this.charts).forEach(c => c.destroy());
  }

  getTemplate(data) {
    return `
      <section class="max-w-6xl mx-auto bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm fade-in">
        <div class="flex items-start justify-between gap-6 mb-8">
          <div>
            <h3 class="text-2xl font-semibold text-slate-50">
              VaultShield — Threat Narratives
            </h3>
            <p class="mt-1 text-sm text-slate-300 max-w-xl">
              Sequence-based anomaly detection for identity attacks (Password Spray, Impossible Travel).
            </p>
          </div>
          <div class="inline-flex items-center rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-300 whitespace-nowrap">
            <span class="mr-2 h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
            Markov Chain Active
          </div>
        </div>

        <div class="flex flex-col min-h-[460px]">
          
          <div class="flex-none flex flex-wrap gap-6 border-b border-slate-800 text-sm font-medium text-slate-400 mb-6">
            <button type="button" data-tab="monitor" class="pb-3 border-b-2 border-rose-500 text-slate-50 transition-colors">
              Threat Monitor
            </button>
            <button type="button" data-tab="forensics" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Session Forensics
            </button>
            <button type="button" data-tab="metrics" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Detection Metrics
            </button>
          </div>

          <div id="content-monitor" class="flex-1 flex flex-col min-h-0 animate-fade-in">
             <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                 <p class="text-slate-400 text-[0.65rem] uppercase font-bold tracking-wider mb-2">Current Threat Level</p>
                 <div class="flex items-baseline gap-2">
                   <span id="vs-threat-level" class="text-3xl font-mono font-bold text-rose-500">ANALYZING</span>
                 </div>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                 <p class="text-slate-400 text-[0.65rem] uppercase font-bold tracking-wider mb-2">Sessions Analyzed</p>
                 <span class="text-3xl font-mono font-bold text-slate-200">${data.total_sessions?.toLocaleString() || '--'}</span>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                 <p class="text-slate-400 text-[0.65rem] uppercase font-bold tracking-wider mb-2">Attacks Blocked (7d)</p>
                 <span id="vs-blocked" class="text-3xl font-mono font-bold text-emerald-400">--</span>
               </div>
             </div>

             <div class="flex-1 relative rounded-2xl border border-slate-800 bg-slate-950/50 p-4 min-h-[300px]">
               <h4 class="text-xs font-bold text-slate-500 mb-4 uppercase tracking-wider">Top Detected Attack Vectors</h4>
               <div class="absolute inset-0 top-10 p-4">
                 <canvas id="vs-attack-chart"></canvas>
               </div>
             </div>
          </div>

          <div id="content-forensics" class="hidden flex-1 flex flex-col animate-fade-in">
             <div class="flex items-center justify-between mb-4">
               <h4 class="text-sm text-slate-300">Analysis of Top Anomalous Session</h4>
               <div id="vs-session-header" class="text-xs font-mono text-slate-500">ID: --</div>
             </div>

             <div class="w-full overflow-x-auto pb-4 mb-6 scrollbar-thin scrollbar-thumb-slate-700 bg-slate-950/30 rounded-xl border border-slate-800/50">
                <div id="vs-timeline" class="flex items-center min-w-max px-6 py-8 space-x-2"></div>
             </div>

             <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
                   <p class="text-rose-400 text-xs font-bold uppercase mb-2">Anomaly Detected</p>
                   <p id="vs-explanation" class="text-slate-200 text-sm leading-relaxed">Loading...</p>
                </div>
                <div class="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
                   <div class="flex justify-between items-center mb-2">
                      <p class="text-slate-400 text-xs font-bold uppercase">Sequence Score</p>
                      <span id="vs-score-val" class="text-xl font-mono font-bold text-rose-500">--</span>
                   </div>
                   <div class="w-full bg-slate-800 rounded-full h-1.5 mt-2">
                      <div id="vs-score-bar" class="bg-gradient-to-r from-emerald-500 to-rose-500 h-1.5 rounded-full" style="width: 0%"></div>
                   </div>
                   <p class="text-[0.65rem] text-slate-500 mt-2">
                      Higher scores indicate rare or impossible event transitions based on the Markov model.
                   </p>
                </div>
             </div>
          </div>

          <div id="content-metrics" class="hidden flex-1 animate-fade-in">
             <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 h-[300px] relative">
                   <h4 class="text-xs font-bold text-slate-500 mb-4 uppercase">Score Distribution (Normal vs Attack)</h4>
                   <div class="absolute inset-0 top-10 p-4">
                      <canvas id="vs-dist-chart"></canvas>
                   </div>
                </div>
                
                <div class="space-y-4">
                   <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                      <div class="flex justify-between mb-1">
                         <span class="text-sm text-slate-300">Detection Rate (Recall)</span>
                         <span class="text-sm font-mono text-sky-400 font-bold" id="vs-metric-recall">--</span>
                      </div>
                      <div class="w-full bg-slate-800 h-1 rounded-full"><div class="w-full bg-sky-400 h-1 rounded-full opacity-80"></div></div>
                   </div>

                   <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                      <div class="flex justify-between mb-1">
                         <span class="text-sm text-slate-300">Model Precision</span>
                         <span class="text-sm font-mono text-amber-400 font-bold" id="vs-metric-precision">--</span>
                      </div>
                      <div class="w-full bg-slate-800 h-1 rounded-full"><div class="w-full bg-amber-400 h-1 rounded-full opacity-80"></div></div>
                   </div>
                </div>
             </div>
          </div>

        </div>
      </section>
    `;
  }

  afterRender() {
    this.setupTabs();
    this.renderMonitor();
    this.renderForensics();
    this.renderMetrics();
  }

  setupTabs() {
    const buttons = this.querySelectorAll('button[data-tab]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => {
            b.classList.remove('border-rose-500', 'text-slate-50');
            b.classList.add('border-transparent', 'hover:text-slate-200');
        });
        ['monitor', 'forensics', 'metrics'].forEach(id => this.querySelector(`#content-${id}`).classList.add('hidden'));

        btn.classList.remove('border-transparent', 'hover:text-slate-200');
        btn.classList.add('border-rose-500', 'text-slate-50');

        const target = btn.dataset.tab;
        this.querySelector(`#content-${target}`).classList.remove('hidden');
        
        // Resize charts if needed
        Object.values(this.charts).forEach(c => c.resize());
      });
    });
  }

  renderMonitor() {
    const counts = this.data.attack_counts || {};
    const blockedCount = Object.values(counts).reduce((a,b)=>a+b, 0);
    this.querySelector('#vs-blocked').innerText = blockedCount.toLocaleString();

    // Threat Level Logic
    const elThreat = this.querySelector('#vs-threat-level');
    if(blockedCount > 1000) {
        elThreat.innerText = "CRITICAL";
        elThreat.className = "text-3xl font-mono font-bold text-rose-600 animate-pulse";
    } else if (blockedCount > 100) {
        elThreat.innerText = "HIGH";
        elThreat.className = "text-3xl font-mono font-bold text-rose-500";
    } else {
        elThreat.innerText = "ELEVATED";
        elThreat.className = "text-3xl font-mono font-bold text-amber-500";
    }

    // Bar Chart
    if(!window.Chart) return;
    const canvas = this.querySelector('#vs-attack-chart');
    if(!canvas) return;

    const labels = Object.keys(counts).map(k => k.replace(/_/g, ' '));
    const values = Object.values(counts);

    this.charts['attack'] = new window.Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Detected Sessions',
                data: values,
                backgroundColor: ['#f43f5e', '#f97316', '#eab308', '#8b5cf6'],
                borderRadius: 4,
                barThickness: 40
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { weight: 'bold' } } }
            }
        }
    });
  }

  renderForensics() {
    const session = this.data.top_anomaly;
    if (!session) return;

    this.querySelector('#vs-session-header').innerText = `ID: ${session.session_id.substring(0,8)}... | User: ${session.user_id}`;
    
    const scoreVal = session.anomaly_score.toFixed(2);
    this.querySelector('#vs-score-val').innerText = scoreVal;
    
    // Cap bar at score 20 for visual scaling
    const pct = Math.min(100, (session.anomaly_score / 20) * 100);
    this.querySelector('#vs-score-bar').style.width = `${pct}%`;

    // Explanation
    const badTransition = session.explanation || "";
    const [badStart, badEnd] = badTransition.split(' → ');

    this.querySelector('#vs-explanation').innerHTML = `
        <strong class="text-white">Attack Pattern:</strong> ${session.attack_type?.replace(/_/g, ' ') || 'Unknown'}<br>
        <span class="opacity-80">
        System flagged improbable transition: 
        <span class="text-rose-400 font-mono bg-rose-500/10 px-1 rounded">${badTransition}</span>. 
        Probability: <strong>${session.worst_prob.toExponential(2)}</strong>.
        </span>
    `;

    // Timeline Rendering
    const container = this.querySelector('#vs-timeline');
    container.innerHTML = '';
    const events = session.events || [];

    events.forEach((evt, idx) => {
        const isLast = idx === events.length - 1;
        let nodeColor = "bg-slate-800 border-slate-600 text-slate-400";
        let lineColor = "bg-slate-700";
        
        if (evt.toLowerCase().includes("fail") || evt.toLowerCase().includes("denied")) {
            nodeColor = "bg-amber-900/50 border-amber-500 text-amber-200";
        }
        if (evt === "login_success" || evt.includes("approved")) {
            nodeColor = "bg-emerald-900/50 border-emerald-500 text-emerald-200";
        }

        // Highlight the bad link
        let isBadLink = false;
        if (!isLast) {
            const nextEvt = events[idx + 1];
            if (evt === badStart && nextEvt === badEnd) {
                isBadLink = true;
                nodeColor = "bg-rose-900/80 border-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]";
                lineColor = "bg-gradient-to-r from-rose-500 to-rose-500 h-[2px]";
            }
        }

        const nodeHtml = `
            <div class="flex flex-col items-center relative group min-w-[100px]">
                <div class="w-10 h-10 rounded-full border-2 ${nodeColor} flex items-center justify-center z-10 transition-transform group-hover:scale-110">
                    <span class="text-[0.6rem] font-bold">${idx+1}</span>
                </div>
                <div class="mt-3 text-[0.65rem] font-mono text-slate-400 uppercase tracking-tight text-center px-1">
                    ${evt.replace(/_/g, ' ')}
                </div>
            </div>
        `;

        let connectorHtml = '';
        if (!isLast) {
            const lineClass = isBadLink ? "h-[3px] bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]" : "h-[2px] bg-slate-700";
            connectorHtml = `<div class="flex-1 w-8 ${lineClass} mx-[-5px] z-0"></div>`;
        }

        container.insertAdjacentHTML('beforeend', nodeHtml + connectorHtml);
    });
  }

  renderMetrics() {
    const metrics = this.data.metrics || {};
    this.querySelector('#vs-metric-precision').innerText = (metrics.pr_auc * 100).toFixed(1) + '%';
    this.querySelector('#vs-metric-recall').innerText = (metrics.recall * 100).toFixed(1) + '%';

    if(!window.Chart) return;
    const canvas = this.querySelector('#vs-dist-chart');
    if(!canvas) return;

    this.charts['dist'] = new window.Chart(canvas, {
        type: 'line',
        data: {
            labels: this.data.dist_labels || [],
            datasets: [
                {
                    label: 'Normal Traffic',
                    data: this.data.dist_normal || [],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Attack Traffic',
                    data: this.data.dist_attack || [],
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8' } } },
            scales: { y: { display: false }, x: { ticks: { color: '#64748b' }, grid: { display: false } } }
        }
    });
  }
}

customElements.define('vaultshield-card', VaultShieldCard);
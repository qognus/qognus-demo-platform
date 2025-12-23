import { BaseCard } from './BaseCard.js';

export class LineaOpsCard extends BaseCard {
  constructor() {
    super();
    this.charts = {};
  }

  disconnectedCallback() {
    Object.values(this.charts).forEach(c => c.destroy());
  }

  getTemplate(data) {
    const metrics = data.metrics || {};
    const robots = Object.keys(metrics).sort();
    
    // Calculate Fleet Aggregates for the Health Tab
    const oeeValues = Object.values(metrics).map(m => m.oee);
    const meanOee = oeeValues.length ? (oeeValues.reduce((a,b)=>a+b,0) / oeeValues.length).toFixed(1) : 0;
    const criticalCount = Object.values(metrics).filter(m => m.status === 'CRITICAL').length;
    const warningCount = Object.values(metrics).filter(m => m.status === 'WARNING').length;

    // Helper for Status Pills
    const getStatusPill = (status) => {
        if(status === 'CRITICAL') return `<span class="px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 text-[0.6rem] font-bold">CRIT</span>`;
        if(status === 'WARNING') return `<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[0.6rem] font-bold">WARN</span>`;
        return `<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[0.6rem] font-bold">OK</span>`;
    };

    return `
      <section class="max-w-6xl mx-auto bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm fade-in">
        <div class="flex items-start justify-between gap-6 mb-8">
          <div>
            <h3 class="text-2xl font-semibold text-slate-50">
              LineaOps — Smart Factory
            </h3>
            <p class="mt-1 text-sm text-slate-300 max-w-xl">
              Real-time OEE monitoring and predictive maintenance for robotics cells.
            </p>
          </div>
          <div class="inline-flex items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300 whitespace-nowrap">
            <span class="mr-2 h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
            PLC Stream Active
          </div>
        </div>

        <div class="flex flex-col min-h-[500px]">
          
          <div class="flex-none flex flex-wrap gap-6 border-b border-slate-800 text-sm font-medium text-slate-400 mb-6">
            <button type="button" data-tab="telemetry" class="pb-3 border-b-2 border-amber-500 text-slate-50 transition-colors">
              Live Telemetry
            </button>
            <button type="button" data-tab="oee" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              OEE Analysis
            </button>
            <button type="button" data-tab="health" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Fleet Health
            </button>
          </div>

          <div id="content-telemetry" class="flex-1 min-h-0 animate-fade-in">
            <div class="grid lg:grid-cols-3 gap-8 h-full">
                <div class="lg:col-span-1 space-y-3">
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Production Line A</h4>
                    ${robots.map(id => {
                        const m = metrics[id];
                        return `
                        <div class="group flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/50 hover:border-slate-600 transition-colors cursor-pointer" data-rob-id="${id}">
                            <div class="flex items-center gap-3">
                                <div class="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center text-[0.65rem] font-mono text-slate-400 font-bold group-hover:bg-slate-700 group-hover:text-white transition-colors">
                                    ${id.split('-')[1]}
                                </div>
                                <div>
                                    <div class="text-xs font-bold text-slate-200">${id}</div>
                                    <div class="text-[0.65rem] text-slate-500">OEE: ${m.oee}%</div>
                                </div>
                            </div>
                            ${getStatusPill(m.status)}
                        </div>`;
                    }).join('')}
                </div>

                <div class="lg:col-span-2 flex flex-col">
                    <div class="flex items-center justify-between mb-4">
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Shift Telemetry (12h)</h4>
                        <div class="flex gap-2">
                            <span class="flex items-center text-[0.6rem] text-slate-400"><span class="w-2 h-2 rounded-full bg-sky-400 mr-1"></span> Cycle Time</span>
                            <span class="flex items-center text-[0.6rem] text-slate-400"><span class="w-2 h-2 rounded-full bg-rose-400 mr-1"></span> Vibration</span>
                        </div>
                    </div>
                    
                    <div class="flex-1 relative rounded-2xl border border-slate-800 bg-slate-950/50 p-4 min-h-[350px]">
                        <canvas id="linea-chart"></canvas>
                    </div>
                    <p class="mt-3 text-xs text-slate-500" id="chart-caption">
                        Showing aggregated telemetry. Click a robot on the left to filter.
                    </p>
                </div>
            </div>
          </div>

          <div id="content-oee" class="hidden flex-1 min-h-0 animate-fade-in">
             <div class="relative h-[400px] w-full rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
               <canvas id="oee-chart"></canvas>
             </div>
             <p class="mt-4 text-xs text-slate-500">
               <strong>OEE Breakdown:</strong> Comparing Availability, Performance, and Quality scores across the fleet. Low Quality often indicates sensor drift or mechanical wear.
             </p>
          </div>

          <div id="content-health" class="hidden flex-1 pt-2 animate-fade-in">
             <div class="grid gap-6 md:grid-cols-3">
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Mean Fleet OEE</p>
                 <p class="text-4xl font-mono text-white font-bold">${meanOee}%</p>
                 <p class="text-xs text-slate-500 mt-2">Target: >85%</p>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Critical Assets</p>
                 <p class="text-4xl font-mono text-red-400 font-bold">${criticalCount}</p>
                 <p class="text-xs text-slate-500 mt-2">Requires immediate maintenance</p>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">At Risk (Warning)</p>
                 <p class="text-4xl font-mono text-amber-400 font-bold">${warningCount}</p>
                 <p class="text-xs text-slate-500 mt-2">Predictive maintenance flagged</p>
               </div>
             </div>
          </div>

        </div>
      </section>
    `;
  }

  afterRender() {
    this.setupTabs();
    this.renderTelemetryChart();
    
    // Wire up robot list clicks
    const rows = this.querySelectorAll('[data-rob-id]');
    rows.forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.robId;
            this.renderTelemetryChart(id);
            rows.forEach(r => r.classList.remove('border-amber-500'));
            row.classList.add('border-amber-500');
        });
    });
  }

  setupTabs() {
    const buttons = this.querySelectorAll('button[data-tab]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Reset
        buttons.forEach(b => {
            b.classList.remove('border-amber-500', 'text-slate-50');
            b.classList.add('border-transparent', 'hover:text-slate-200');
        });
        ['telemetry', 'oee', 'health'].forEach(id => this.querySelector(`#content-${id}`).classList.add('hidden'));

        // Activate
        btn.classList.remove('border-transparent', 'hover:text-slate-200');
        btn.classList.add('border-amber-500', 'text-slate-50');

        const target = btn.dataset.tab;
        this.querySelector(`#content-${target}`).classList.remove('hidden');

        // Lazy Render
        if (target === 'oee') this.renderOEEChart();
        if (target === 'telemetry') {
             if(this.charts['telemetry']) this.charts['telemetry'].resize();
        }
      });
    });
  }

  renderTelemetryChart(robotId = null) {
    if (!window.Chart) return;
    const canvas = this.querySelector('#linea-chart');
    if (!canvas) return;

    if (this.charts['telemetry']) this.charts['telemetry'].destroy();

    const targetId = robotId || "ROB-03"; 
    const seriesData = this.data.series.find(s => s.id === targetId);
    if (!seriesData) return;

    const timestamps = seriesData.timestamps; 
    const cycleTimes = seriesData.data.map(d => d.cycle_time_ms);
    const vibrations = seriesData.data.map(d => d.vibration_mm_s);

    this.querySelector('#chart-caption').innerHTML = `Telemetry for <span class="text-amber-400 font-bold">${targetId}</span>.`;

    this.charts['telemetry'] = new window.Chart(canvas, {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [
                {
                    label: 'Cycle Time (ms)',
                    data: cycleTimes,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    yAxisID: 'y',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                },
                {
                    label: 'Vibration (mm/s)',
                    data: vibrations,
                    borderColor: '#fb7185',
                    backgroundColor: 'rgba(251, 113, 133, 0.1)',
                    yAxisID: 'y1',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                x: { 
                    grid: { display: false }, 
                    ticks: { color: '#64748b', maxTicksLimit: 8 } 
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: '#1e293b' },
                    ticks: { color: '#38bdf8' },
                    title: { display: true, text: 'Cycle Time (ms)', color: '#334155' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#fb7185' },
                    title: { display: true, text: 'Vibration', color: '#334155' }
                },
            }
        }
    });
  }

  renderOEEChart() {
    if (this.charts['oee']) return;
    if (!window.Chart) return;

    const canvas = this.querySelector('#oee-chart');
    if (!canvas) return;

    const metrics = this.data.metrics || {};
    const robots = Object.keys(metrics).sort();

    const perfData = robots.map(id => metrics[id].performance);
    const qualData = robots.map(id => metrics[id].quality);
    const availData = robots.map(id => metrics[id].availability);

    this.charts['oee'] = new window.Chart(canvas, {
        type: 'bar',
        data: {
            labels: robots,
            datasets: [
                {
                    label: 'Availability',
                    data: availData,
                    backgroundColor: '#10b981', // Emerald
                    borderRadius: 4
                },
                {
                    label: 'Performance',
                    data: perfData,
                    backgroundColor: '#3b82f6', // Blue
                    borderRadius: 4
                },
                {
                    label: 'Quality',
                    data: qualData,
                    backgroundColor: '#f59e0b', // Amber
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true, 
                    max: 100,
                    grid: { color: '#1e293b' },
                    ticks: { color: '#64748b' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { 
                    position: 'top',
                    labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle' }
                }
            }
        }
    });
  }
}

customElements.define('lineaops-card', LineaOpsCard);
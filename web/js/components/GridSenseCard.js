import { BaseCard } from './BaseCard.js';

// Chart.js Plugin for vertical lines (e.g. "ANOMALY DETECTED")
const verticalLinePlugin = {
  id: 'verticalLine',
  afterDatasetsDraw(chart, args, options) {
    if (!chart.chartArea || !chart.scales.x) return;
    const { ctx, chartArea: { top, bottom, right, left }, scales: { x } } = chart;
    
    // In Chart.js v4, options are passed directly if configured in plugins section
    const lines = options.lines || [];
    if (lines.length === 0) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.font = 'bold 10px monospace';

    lines.forEach(lineItem => {
       const { index, color, text } = lineItem;
       const meta = chart.getDatasetMeta(0);
       
       // Safety check: ensure index is within current view
       if (index < 0 || index >= meta.data.length) return;

       const xPos = x.getPixelForValue(index);
       
       // Only draw if within chart area
       if (xPos < left || xPos > right) return;

       // Draw Line
       ctx.beginPath();
       ctx.strokeStyle = color;
       ctx.moveTo(xPos, top);
       ctx.lineTo(xPos, bottom);
       ctx.stroke();
       
       // Draw Label
       ctx.fillStyle = color;
       const textWidth = ctx.measureText(text).width;
       const padding = 6;

       // Prevent label clipping on right edge
       if (xPos + textWidth + padding > right) {
           ctx.textAlign = 'right';
           ctx.fillText(text, xPos - padding, top + 12);
       } else {
           ctx.textAlign = 'left';
           ctx.fillText(text, xPos + padding, top + 12);
       }
    });
    ctx.restore();
  }
};

export class GridSenseCard extends BaseCard {
  constructor() {
    super();
    this.charts = {};
    this.subMap = {};
    this.subList = [];
    this.activeSubId = null;
    this.globalMaxTs = 0;
    this.cutoffTime = 0;
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
              GridSense — Fleet Anomaly Detection
            </h3>
            <p class="mt-1 text-sm text-slate-300 max-w-xl">
              Real-time multivariate anomaly detection across the substation fleet.
            </p>
          </div>
          <div class="inline-flex items-center rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-medium text-slate-100 whitespace-nowrap">
            <span class="mr-2 h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Live Inference
          </div>
        </div>

        <div class="flex flex-col min-h-[460px]">
          
          <div class="flex-none flex flex-wrap gap-6 border-b border-slate-800 text-sm font-medium text-slate-400 mb-6">
            <button type="button" data-tab="timeseries" class="pb-3 border-b-2 border-sky-500 text-slate-50 transition-colors">
              Timeseries
            </button>
            <button type="button" data-tab="embedding" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Temporal Radar
            </button>
            <button type="button" data-tab="health" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Model Health
            </button>
          </div>

          <div id="content-timeseries" class="flex-1 flex flex-col md:flex-row gap-6 min-h-0 animate-fade-in">
             <div class="flex-1 flex flex-col min-w-0">
               <div class="flex-1 relative rounded-2xl border border-slate-800 bg-slate-950/50 overflow-hidden w-full min-h-[300px] p-2">
                  <canvas id="gs-timeseries"></canvas>
               </div>
               <p id="gs-footer" class="mt-3 text-xs text-slate-500 flex-none h-5">
                 Select a substation to view telemetry.
               </p>
             </div>

             <div class="w-full md:w-40 flex flex-col flex-none border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-4">
               <div class="flex items-center justify-between mb-3">
                 <h4 class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-wider">Active Fleet</h4>
                 <span id="gs-count" class="text-[0.6rem] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">--</span>
               </div>
               <div id="gs-substation-list" class="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-2 gap-1.5 overflow-y-auto pr-1 max-h-[350px]">
                 </div>
             </div>
          </div>

          <div id="content-embedding" class="hidden flex-1 flex flex-col min-h-0 animate-fade-in">
             <div class="flex-1 relative rounded-2xl border border-slate-800 bg-slate-950/50 overflow-hidden w-full min-h-[300px] p-2">
                <canvas id="gs-embedding"></canvas>
                <div class="absolute top-2 left-1/2 -translate-x-1/2 text-[0.6rem] font-mono text-slate-600">12:00</div>
                <div class="absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.6rem] font-mono text-slate-600">06:00</div>
                <div class="absolute left-2 top-1/2 -translate-y-1/2 text-[0.6rem] font-mono text-slate-600">09:00</div>
                <div class="absolute right-2 top-1/2 -translate-y-1/2 text-[0.6rem] font-mono text-slate-600">03:00</div>
             </div>
             <p class="mt-3 text-xs text-slate-500">
               <strong>Cyclical Projection:</strong> Anomalies are plotted on a 12-hour clock face to reveal temporal patterns. (Angle = Time, Radius = Severity).
             </p>
          </div>

          <div id="content-health" class="hidden pt-2 animate-fade-in">
             <div class="grid gap-4 md:grid-cols-3 text-xs text-slate-200">
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Precision</p>
                 <p class="text-3xl font-bold text-slate-600 font-mono mb-1" id="val-precision">--</p>
                 <p class="text-[0.7rem] text-slate-500 font-medium">True Positives / All Alerts</p>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Recall</p>
                 <p class="text-3xl font-bold text-slate-600 font-mono mb-1" id="val-recall">--</p>
                 <p class="text-[0.7rem] text-slate-500 font-medium">Captured / Total Incidents</p>
               </div>
               <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Anomaly Rate</p>
                 <p class="text-3xl font-bold text-slate-600 font-mono mb-1" id="val-rate">--</p>
                 <p class="text-[0.7rem] text-slate-500 font-medium">Global Fleet Contamination</p>
               </div>
             </div>
          </div>

        </div>
      </section>
    `;
  }

  async afterRender() {
    this.setupTabs();
    this.processData();
    
    // Initial Render
    if(this.subList.length > 0) {
        this.renderSubstationList();
        this.renderTimeseries(this.subList[0].id);
        this.updateHealthUI();
    }
  }

  setupTabs() {
    const buttons = this.querySelectorAll('button[data-tab]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => {
            b.classList.remove('border-sky-500', 'text-slate-50');
            b.classList.add('border-transparent', 'hover:text-slate-200');
        });
        ['timeseries', 'embedding', 'health'].forEach(id => this.querySelector(`#content-${id}`).classList.add('hidden'));

        btn.classList.remove('border-transparent', 'hover:text-slate-200');
        btn.classList.add('border-sky-500', 'text-slate-50');

        const target = btn.dataset.tab;
        this.querySelector(`#content-${target}`).classList.remove('hidden');

        if (target === 'embedding') this.renderEmbedding();
      });
    });
  }

  processData() {
    // Robust data check
    const series = this.data?.series || [];
    const metrics = this.data?.summary || {};
    
    const RECENT_WINDOW = 48 * 60 * 60 * 1000; 
    let maxTs = 0;
    
    series.forEach(d => {
        const ts = new Date(d.timestamp).getTime();
        if (ts > maxTs) maxTs = ts;
    });
    
    this.globalMaxTs = maxTs;
    this.cutoffTime = maxTs - RECENT_WINDOW;

    this.subMap = {};
    series.forEach(d => {
        if (!this.subMap[d.substation_id]) {
            this.subMap[d.substation_id] = { 
                id: d.substation_id, 
                status: 'clean', 
                data: [] 
            };
        }
        this.subMap[d.substation_id].data.push(d);
    });

    // Determine status
    Object.values(this.subMap).forEach(sub => {
        const anyAnomaly = sub.data.some(d => d.predicted_anomaly === 1);
        if (anyAnomaly) {
            const active = sub.data.some(d => d.predicted_anomaly === 1 && new Date(d.timestamp).getTime() > this.cutoffTime);
            sub.status = active ? 'active' : 'historic';
        }
    });

    this.subList = Object.values(this.subMap).sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
    this.querySelector('#gs-count').innerText = this.subList.length;
  }

  renderSubstationList() {
    const list = this.querySelector('#gs-substation-list');
    list.innerHTML = '';

    this.subList.forEach(sub => {
        const shortId = sub.id.split('-')[1];
        const isActive = sub.id === this.activeSubId;
        
        let classes = "h-8 w-full rounded flex items-center justify-center cursor-pointer border relative text-[0.6rem] font-mono font-bold transition-colors ";
        
        if (isActive) classes += "bg-sky-500/20 border-sky-500 text-sky-100";
        else if (sub.status === 'active') classes += "bg-red-900/30 border-red-800 text-red-200 hover:bg-red-900/50";
        else if (sub.status === 'historic') classes += "bg-slate-800/80 border-slate-600 text-slate-400 hover:bg-slate-700";
        else classes += "bg-slate-800/40 border-slate-800 text-slate-500 hover:bg-slate-800";

        const div = document.createElement('div');
        div.className = classes;
        div.innerText = shortId;
        
        if (sub.status === 'active') {
            div.innerHTML += `<span class="absolute -top-1 -right-1 flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>`;
        }

        div.onclick = () => {
            this.activeSubId = sub.id;
            this.renderSubstationList(); 
            this.renderTimeseries(sub.id);
        };
        list.appendChild(div);
    });
  }

  renderTimeseries(subId) {
    if (!window.Chart) return;
    this.activeSubId = subId;
    
    const canvas = this.querySelector('#gs-timeseries');
    const subData = this.subMap[subId].data;
    const windowSize = 150;
    let viewModeText = "Live telemetry";
    
    // Auto-center on anomaly
    let startIndex = Math.max(0, subData.length - windowSize);
    
    // Logic to find incidents for markers
    const GAP_TOLERANCE = 12; 
    const incidents = [];
    let currentIncident = null;

    subData.forEach((pt, idx) => {
      if (pt.predicted_anomaly === 1) {
          if (!currentIncident) {
              currentIncident = { start: idx, end: idx, maxScore: pt.anomaly_score, maxScoreIdx: idx };
          } else {
              if (idx - currentIncident.end <= GAP_TOLERANCE) {
                  currentIncident.end = idx;
                  if (pt.anomaly_score > currentIncident.maxScore) {
                      currentIncident.maxScore = pt.anomaly_score;
                      currentIncident.maxScoreIdx = idx;
                  }
              } else {
                  incidents.push(currentIncident);
                  currentIncident = { start: idx, end: idx, maxScore: pt.anomaly_score, maxScoreIdx: idx };
              }
          }
      }
    });
    if (currentIncident) incidents.push(currentIncident);

    // If we have an incident, focus on the last one
    if (incidents.length > 0) {
        const targetIncident = incidents[incidents.length - 1];
        startIndex = Math.max(0, targetIncident.maxScoreIdx - Math.floor(windowSize/2));
        if (startIndex + windowSize > subData.length) startIndex = Math.max(0, subData.length - windowSize);
        
        const eventTime = new Date(subData[targetIncident.maxScoreIdx].timestamp);
        const isRecent = eventTime.getTime() > this.cutoffTime;
        const label = isRecent ? "Active Incident" : "Historic Incident";
        const dateStr = eventTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const timeStr = eventTime.toLocaleTimeString(undefined, { hour: '2-digit', minute:'2-digit' });
        viewModeText = `${label} review: <span class="text-white">${dateStr} ${timeStr}</span>`;
    }

    const slice = subData.slice(startIndex, startIndex + windowSize);
    
    const labels = slice.map(d => {
        const dt = new Date(d.timestamp);
        return `${dt.getMonth()+1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2,'0')}`;
    });
    
    const scores = slice.map(d => d.anomaly_score);
    const anomalyDots = slice.map(d => d.predicted_anomaly === 1 ? d.anomaly_score : null);

    // Prepare line markers for plugin
    const lineMarkers = [];
    incidents.forEach(inc => {
        const relativeIdx = inc.maxScoreIdx - startIndex;
        if (relativeIdx >= 0 && relativeIdx < windowSize) {
            const point = subData[inc.maxScoreIdx];
            const pointTs = new Date(point.timestamp).getTime();
            const isRecent = pointTs > this.cutoffTime;
            
            lineMarkers.push({
                index: relativeIdx, 
                color: isRecent ? '#ef4444' : '#64748b',
                text: isRecent ? 'ANOMALY DETECTED' : 'HISTORIC INCIDENT'
            });
        }
    });

    const getPointColor = (ctx) => {
        const d = slice[ctx.dataIndex];
        if(!d) return '#64748b';
        return new Date(d.timestamp).getTime() > this.cutoffTime ? '#ef4444' : '#64748b';
    };

    // --- SEGMENT COLOR LOGIC (Red line connecting anomalies) ---
    const getSegmentColor = (ctx) => {
        const idx = ctx.p1DataIndex; 
        const d = slice[idx];
        if (!d || d.predicted_anomaly !== 1) return '#38bdf8'; // Blue for normal
        const ts = new Date(d.timestamp).getTime();
        return ts > this.cutoffTime ? '#ef4444' : '#64748b'; // Red for active anomaly
    };

    if (this.charts['ts']) this.charts['ts'].destroy();

    this.charts['ts'] = new window.Chart(canvas, {
        type: 'line',
        plugins: [verticalLinePlugin],
        data: {
            labels,
            datasets: [
                {
                    data: scores,
                    borderColor: '#38bdf8',
                    borderWidth: 2,
                    segment: { borderColor: getSegmentColor }, // <--- Activates Red Line
                    backgroundColor: (ctx) => {
                        const bg = ctx.chart.ctx.createLinearGradient(0,0,0,300);
                        bg.addColorStop(0, 'rgba(56, 189, 248, 0.2)');
                        bg.addColorStop(1, 'rgba(56, 189, 248, 0)');
                        return bg;
                    },
                    fill: true,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    data: anomalyDots,
                    borderColor: getPointColor,
                    backgroundColor: getPointColor,
                    pointRadius: 4,
                    showLine: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: { 
                legend: { display: false },
                verticalLine: { lines: lineMarkers }
            },
            scales: {
                x: { display: true, ticks: { color: '#64748b', maxTicksLimit: 6 }, grid: { display: false } },
                y: { display: true, min: 0, grid: { color: 'rgba(30, 64, 175, 0.2)' }, ticks: { color: '#64748b' } }
            }
        }
    });

    this.querySelector('#gs-footer').innerHTML = `${viewModeText} for <span class="font-mono text-sky-400 font-bold">${subId}</span>`;
  }

  renderEmbedding() {
    if (this.charts['embed']) return; 
    
    const canvas = this.querySelector('#gs-embedding');
    const allPoints = this.data?.series || [];
    
    const anomalies = allPoints.filter(d => d.predicted_anomaly === 1);
    const nominals = allPoints.filter(d => d.predicted_anomaly === 0).filter((_, i) => i % 20 === 0);
    
    const mapToRadial = (pt) => {
        const dt = new Date(pt.timestamp);
        const mins = (dt.getHours() % 12) * 60 + dt.getMinutes();
        const angle = (mins / 720) * (Math.PI * 2);
        const r = pt.predicted_anomaly ? (1.0 + pt.anomaly_score * 3) : Math.random() * 0.8;
        return {
            x: Math.sin(angle) * r,
            y: Math.cos(angle) * r
        };
    };

    const activeSet = anomalies.filter(d => new Date(d.timestamp).getTime() > this.cutoffTime).map(mapToRadial);
    const histSet = anomalies.filter(d => new Date(d.timestamp).getTime() <= this.cutoffTime).map(mapToRadial);
    const normSet = nominals.map(mapToRadial);

    this.charts['embed'] = new window.Chart(canvas, {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Nominal', data: normSet, backgroundColor: '#38bdf8', pointRadius: 1.5 },
                { label: 'Active Anomaly', data: activeSet, backgroundColor: '#ef4444', pointRadius: 5 },
                { label: 'Historic', data: histSet, backgroundColor: '#64748b', pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { display: false, min: -5, max: 5 }, y: { display: false, min: -5, max: 5 } },
            plugins: { legend: { labels: { color: '#94a3b8' } } }
        }
    });
  }

  updateHealthUI() {
    const m = this.data.summary || {};
    const setMetric = (id, val, goodHigh) => {
        const el = this.querySelector(`#val-${id}`);
        if(!el) return;
        el.innerText = (val * 100).toFixed(1) + '%';
        const isGood = goodHigh ? val > 0.8 : val < 0.1;
        el.className = `text-3xl font-bold font-mono mb-1 ${isGood ? 'text-emerald-400' : 'text-amber-400'}`;
    };
    setMetric('precision', m.precision, true);
    setMetric('recall', m.recall, true);
    setMetric('rate', m.contamination, false);
  }
}

customElements.define('gridsense-card', GridSenseCard);
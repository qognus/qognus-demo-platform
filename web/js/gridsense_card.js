// web/js/gridsense_card.js

let gsChartInstance = null;
let gsEmbedInstance = null;

const verticalLinePlugin = {
  id: 'verticalLine',
  afterDatasetsDraw(chart, args, options) {
    if (!chart.chartArea || !chart.scales.x) return;
    const { ctx, chartArea: { top, bottom, right }, scales: { x } } = chart;
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
        if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) return;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();
        
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

window.initGridSense = function () {
  console.log('[GridSense] Initializing...');

  if (!window.GRIDSENSE_TIMESERIES) {
    console.warn('[GridSense] Artifact not found.');
    return;
  }

  const dataObj = window.GRIDSENSE_TIMESERIES;
  const series = dataObj.series;
  const metrics = dataObj.summary;

  // --- CONFIGURATION: 48-HOUR WINDOW ---
  const RECENT_WINDOW = 48 * 60 * 60 * 1000; 

  let globalMaxTs = 0;
  if (series.length > 0) {
      series.forEach(d => {
          const ts = new Date(d.timestamp).getTime();
          if (ts > globalMaxTs) globalMaxTs = ts;
      });
  }
  const cutoffTime = globalMaxTs - RECENT_WINDOW;

  const subMap = {};
  series.forEach(d => {
    if (!subMap[d.substation_id]) {
        subMap[d.substation_id] = { 
            id: d.substation_id, 
            status: 'clean', 
            maxScore: 0,
            region: d.region,
            data: [] 
        };
    }
    const entry = subMap[d.substation_id];
    entry.data.push(d);
    if (d.anomaly_score > entry.maxScore) entry.maxScore = d.anomaly_score;
  });

  // Determine Fleet Status
  Object.values(subMap).forEach(sub => {
      const anyAnomaly = sub.data.some(d => d.predicted_anomaly === 1);
      if (anyAnomaly) {
          const activeAnomaly = sub.data.some(d => {
              return d.predicted_anomaly === 1 && new Date(d.timestamp).getTime() > cutoffTime;
          });
          sub.status = activeAnomaly ? 'active' : 'historic';
      } else {
          sub.status = 'clean'; 
      }
  });

  // --- UPDATED SORTING: NUMERICAL ONLY ---
  // Removed the "Active First" logic. Now sorts strictly by ID (GS-001, GS-002...)
  const subList = Object.values(subMap).sort((a, b) => {
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  });

  if (subList.length > 0) {
      const initialSub = subList[0];
      renderSubstationGrid(subList, initialSub.id, globalMaxTs, cutoffTime);
      renderTimeseries(initialSub.data, initialSub.id, globalMaxTs, cutoffTime);
      renderPseudoEmbedding(series, cutoffTime);
      updateHealthMetrics(metrics);
  }
};

function renderSubstationGrid(subList, activeId, globalMaxTs, cutoffTime) {
    const listContainer = document.getElementById('gs-substation-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    subList.forEach(sub => {
        const isActive = sub.id === activeId;
        const shortId = sub.id.split('-')[1] || sub.id;

        let baseClass = "h-8 w-full rounded flex items-center justify-center cursor-pointer transition-all duration-200 border relative group";
        
        if (isActive) {
            baseClass += " bg-sky-500/10 border-sky-500 text-sky-100 shadow-[0_0_8px_rgba(14,165,233,0.3)]";
        } else if (sub.status === 'active') {
            baseClass += " bg-red-500/10 border-red-500/50 text-red-100 hover:bg-red-500/20";
        } else if (sub.status === 'historic') {
            baseClass += " bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-slate-200";
        } else {
            baseClass += " bg-slate-800/40 border-slate-800 text-slate-500 hover:bg-slate-800 hover:text-slate-300";
        }

        const el = document.createElement('div');
        el.className = baseClass;
        el.title = `${sub.id} (${sub.region}) - ${sub.status}`;
        el.onclick = () => {
            renderSubstationGrid(subList, sub.id, globalMaxTs, cutoffTime);
            renderTimeseries(sub.data, sub.id, globalMaxTs, cutoffTime);
        };

        let dot = '';
        if (sub.status === 'active') {
           dot = `<span class="absolute -top-1 -right-1 flex h-2 w-2">
             <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
             <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
           </span>`;
        } else if (sub.status === 'historic') {
           dot = `<span class="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-slate-500 ring-1 ring-slate-900"></span>`;
        }

        el.innerHTML = `
            ${dot}
            <span class="text-[0.6rem] font-mono font-bold">${shortId}</span>
        `;
        listContainer.appendChild(el);
    });
}

function renderTimeseries(dataPoints, subId, globalMaxTs, cutoffTime) {
  const canvas = document.querySelector('[data-gs-timeseries]');
  if (!canvas || !window.Chart) return;
  
  if (!dataPoints || dataPoints.length === 0) {
      if (gsChartInstance) gsChartInstance.destroy();
      return;
  }

  const ctx = canvas.getContext('2d');
  const windowSize = 150;
  let startIndex = Math.max(0, dataPoints.length - windowSize);
  let viewModeText = "Live telemetry";

  // --- CLUSTERING LOGIC ---
  const GAP_TOLERANCE = 12; 
  const incidents = [];
  let currentIncident = null;

  dataPoints.forEach((pt, idx) => {
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

  // --- AUTO-CENTER LOGIC ---
  let targetIncident = null;
  if (incidents.length > 0) {
      targetIncident = incidents[incidents.length - 1]; // Last one
  }

  if (targetIncident) {
      const centerIndex = targetIncident.maxScoreIdx; 
      const centerOffset = Math.floor(windowSize / 2);
      startIndex = Math.max(0, centerIndex - centerOffset);
      
      if (startIndex + windowSize > dataPoints.length) {
          startIndex = Math.max(0, dataPoints.length - windowSize);
      }

      const eventTime = new Date(dataPoints[centerIndex].timestamp);
      const isRecent = eventTime.getTime() > cutoffTime;
      const label = isRecent ? "Active Incident" : "Historic Incident";
      
      const dateStr = eventTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = eventTime.toLocaleTimeString(undefined, { hour: '2-digit', minute:'2-digit' });
      viewModeText = `${label} review: <span class="text-white">${dateStr} ${timeStr}</span>`;
  }

  const slice = dataPoints.slice(startIndex, startIndex + windowSize); 
  
  // Date Labels
  const labels = slice.map(d => {
    const date = new Date(d.timestamp);
    const mon = date.toLocaleString('en-US', { month: 'short' });
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${mon} ${day}, ${hour}:${min}`;
  });
  
  const scores = slice.map(d => d.anomaly_score || 0);
  const anomalyDots = slice.map(d => d.predicted_anomaly === 1 ? (d.anomaly_score || 0) : null);

  const getPointColor = (ctx) => {
      const i = ctx.dataIndex;
      const point = slice[i];
      if (!point) return '#64748b'; 
      const pointTs = new Date(point.timestamp).getTime();
      return pointTs > cutoffTime ? '#ef4444' : '#64748b'; 
  };

  const getSegmentColor = (ctx) => {
      const i = ctx.p1DataIndex; 
      const point = slice[i];
      if (!point || point.predicted_anomaly !== 1) return '#38bdf8'; 
      const pointTs = new Date(point.timestamp).getTime();
      return pointTs > cutoffTime ? '#ef4444' : '#64748b'; 
  };

  const lineMarkers = [];
  incidents.forEach(inc => {
      const relativeIdx = inc.maxScoreIdx - startIndex;
      if (relativeIdx >= 0 && relativeIdx < windowSize) {
          const point = dataPoints[inc.maxScoreIdx];
          const pointTs = new Date(point.timestamp).getTime();
          const isRecent = pointTs > cutoffTime;
          
          lineMarkers.push({
              index: relativeIdx, 
              color: isRecent ? '#ef4444' : '#64748b',
              text: isRecent ? 'ANOMALY DETECTED' : 'HISTORIC INCIDENT'
          });
      }
  });

  if (gsChartInstance) gsChartInstance.destroy();

  gsChartInstance = new Chart(ctx, {
    type: 'line',
    plugins: [verticalLinePlugin],
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Score',
          data: scores,
          borderColor: '#38bdf8',
          borderWidth: 2,
          segment: { borderColor: getSegmentColor },
          backgroundColor: (context) => {
             const chart = context.chart;
             const {ctx, chartArea} = chart;
             if (!chartArea) return null;
             const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
             gradient.addColorStop(0, 'rgba(56, 189, 248, 0.0)');
             gradient.addColorStop(1, 'rgba(56, 189, 248, 0.2)');
             return gradient;
          },
          fill: true,
          pointRadius: 0,
          tension: 0.1,
          order: 2
        },
        {
          label: 'Anomaly',
          data: anomalyDots,
          borderColor: getPointColor,
          backgroundColor: getPointColor,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, verticalLine: { lines: lineMarkers } },
      animation: { duration: 0 },
      scales: {
        x: { 
            display: true, 
            grid: { display: false }, 
            ticks: { 
                color: '#64748b', 
                font: { size: 10 },
                maxTicksLimit: 6, 
                maxRotation: 0
            }
        },
        y: { 
          display: true, 
          min: 0, 
          suggestedMax: Math.max(...scores) * 1.1,
          grid: { color: 'rgba(30, 64, 175, 0.2)' },
          ticks: { color: '#64748b', font: {size: 10} }
        }
      }
    }
  });

  const footer = document.getElementById('gs-timeseries-footer');
  if(footer) footer.innerHTML = `${viewModeText} for <span class="font-mono text-sky-400 font-bold">${subId}</span>.`;
}

function renderPseudoEmbedding(allSeriesData, cutoffTime) {
  const canvas = document.querySelector('[data-gs-embedding]');
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');

  const anomalies = [];
  const nominals = [];

  allSeriesData.forEach(d => {
      const pointTs = new Date(d.timestamp).getTime();
      const date = new Date(d.timestamp);
      const dateStr = date.toLocaleString('en-US', { 
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      });

      const point = {
          ...d, 
          score: d.anomaly_score || 0,
          isAnom: d.predicted_anomaly === 1,
          isRecent: pointTs > cutoffTime,
          fullLabel: `[${d.substation_id}] ${dateStr}`
      };
      if (point.isAnom) anomalies.push(point);
      else nominals.push(point);
  });

  const maxNominals = 800;
  const step = Math.ceil(nominals.length / maxNominals);
  const sampledNominals = [];
  for (let i = 0; i < nominals.length; i += step) {
      sampledNominals.push(nominals[i]);
  }

  const finalData = [...sampledNominals, ...anomalies].map(point => {
      const date = new Date(point.timestamp);
      const hours = date.getHours() % 12; 
      const mins = date.getMinutes();
      const totalMinutes = (hours * 60) + mins;
      const angle = (totalMinutes / 720) * (2 * Math.PI);
      
      let r = point.isAnom ? (1.0 + point.score * 4.0) : (Math.random() * 0.8);

      return {
          x: Math.sin(angle) * r,
          y: Math.cos(angle) * r, 
          isAnom: point.isAnom,
          isRecent: point.isRecent,
          fullLabel: point.fullLabel,
          statusLabel: point.isAnom ? (point.isRecent ? 'Active Anomaly' : 'Historic Anomaly') : 'Nominal'
      };
  });

  const normalSet = finalData.filter(d => !d.isAnom);
  const activeSet = finalData.filter(d => d.isAnom && d.isRecent);
  const historicSet = finalData.filter(d => d.isAnom && !d.isRecent);

  if (gsEmbedInstance) gsEmbedInstance.destroy();

  gsEmbedInstance = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Nominal', data: normalSet, backgroundColor: '#38bdf8', pointRadius: 2 },
        { label: 'Active Anomaly', data: activeSet, backgroundColor: '#ef4444', pointRadius: 5, pointHoverRadius: 7 },
        { label: 'Historic Anomaly', data: historicSet, backgroundColor: '#64748b', pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false, min: -6, max: 6 }, y: { display: false, min: -6, max: 6 } },
      plugins: { 
          legend: { display: true, labels: { color: '#94a3b8' } },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.raw.fullLabel} (${ctx.raw.statusLabel})` }
          }
      }
    }
  });
}

function updateHealthMetrics(metrics) {
  const getStatus = (val, mode) => {
    if (mode === 'higher_is_better') {
      if (val >= 0.80) return { color: 'text-emerald-400', dot: 'bg-emerald-500', shadow: 'shadow-emerald-500/50' };
      if (val >= 0.50) return { color: 'text-amber-400', dot: 'bg-amber-500', shadow: 'shadow-amber-500/50' };
      return { color: 'text-red-400', dot: 'bg-red-500', shadow: 'shadow-red-500/50' };
    } else {
      if (val <= 0.05) return { color: 'text-emerald-400', dot: 'bg-emerald-500', shadow: 'shadow-emerald-500/50' };
      if (val <= 0.15) return { color: 'text-amber-400', dot: 'bg-amber-500', shadow: 'shadow-amber-500/50' };
      return { color: 'text-red-400', dot: 'bg-red-500', shadow: 'shadow-red-500/50' };
    }
  };

  const updateCard = (metricKey, val, mode) => {
    const status = getStatus(val, mode);
    const valueEl = document.getElementById(`gs-metric-${metricKey}`);
    const dotEl = document.getElementById(`gs-dot-${metricKey}`);
    if (valueEl) {
      valueEl.innerText = (val * 100).toFixed(1) + '%';
      valueEl.className = `text-3xl font-bold font-mono transition-colors duration-500 ${status.color}`;
    }
    if (dotEl) {
      dotEl.className = `h-2.5 w-2.5 rounded-full transition-all duration-500 ${status.dot} shadow-[0_0_8px] ${status.shadow}`;
    }
  };

  updateCard('precision', metrics.precision, 'higher_is_better');
  updateCard('recall', metrics.recall, 'higher_is_better');
  updateCard('rate', metrics.contamination, 'lower_is_better');
}
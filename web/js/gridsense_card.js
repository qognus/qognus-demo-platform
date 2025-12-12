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
        
        if (index < 0 || index >= meta.data.length) return;

        const xPos = x.getPixelForValue(index);
        if (xPos < chart.chartArea.left || xPos > chart.chartArea.right) return;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();
        
        ctx.fillStyle = color;
        const textWidth = ctx.measureText(text).width;
        const padding = 6;

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

  const RECENT_WINDOW = 144; // 12 hours

  // 1. Global Time (UTC)
  let globalMaxTs = 0;
  if (series.length > 0) {
      series.forEach(d => {
          const ts = new Date(d.timestamp).getTime();
          if (ts > globalMaxTs) globalMaxTs = ts;
      });
  }
  const cutoffTime = globalMaxTs - (12 * 60 * 60 * 1000);

  // 2. Aggregate Data
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

  // 3. Determine Status
  Object.values(subMap).forEach(sub => {
      const anyAnomaly = sub.data.some(d => d.predicted_anomaly === 1);
      
      if (anyAnomaly) {
          const activeAnomaly = sub.data.some(d => {
              return d.predicted_anomaly === 1 && new Date(d.timestamp).getTime() > cutoffTime;
          });
          
          if (activeAnomaly) {
              sub.status = 'active'; 
          } else {
              sub.status = 'historic'; 
          }
      } else {
          sub.status = 'clean'; 
      }
  });

  // 4. Sort
  const subList = Object.values(subMap).sort((a, b) => {
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  });

  // 5. Render
  if (subList.length > 0) {
      const initialSub = subList[0];
      renderSubstationGrid(subList, initialSub.id, globalMaxTs);
      renderTimeseries(initialSub.data, initialSub.id, globalMaxTs);
      renderPseudoEmbedding(series, cutoffTime);
      updateHealthMetrics(metrics);
  }
};

function renderSubstationGrid(subList, activeId, globalMaxTs) {
    const listContainer = document.getElementById('gs-substation-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';

    subList.forEach(sub => {
        const isActive = sub.id === activeId;
        const shortId = sub.id.split('-')[1] || sub.id;

        // CHANGED: Compact styling for narrower column (h-8, smaller text)
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
            renderSubstationGrid(subList, sub.id, globalMaxTs);
            renderTimeseries(sub.data, sub.id, globalMaxTs);
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

function renderTimeseries(dataPoints, subId, globalMaxTs) {
  const canvas = document.querySelector('[data-gs-timeseries]');
  if (!canvas || !window.Chart) return;
  
  if (!dataPoints || dataPoints.length === 0) {
      if (gsChartInstance) gsChartInstance.destroy();
      return;
  }

  const ctx = canvas.getContext('2d');
  const windowSize = 150;
  const cutoffTime = globalMaxTs - (12 * 60 * 60 * 1000);

  let startIndex = Math.max(0, dataPoints.length - windowSize);
  let viewModeText = "Live telemetry";

  let foundIndex = -1;
  for (let i = dataPoints.length - 1; i >= 0; i--) {
      if (dataPoints[i].predicted_anomaly === 1) {
          foundIndex = i;
          break;
      }
  }

  if (foundIndex !== -1) {
      const anomalyTime = new Date(dataPoints[foundIndex].timestamp).getTime();
      if (anomalyTime > cutoffTime) {
          const centerOffset = Math.floor(windowSize / 2);
          startIndex = Math.max(0, foundIndex - centerOffset);
          if (startIndex + windowSize > dataPoints.length) {
              startIndex = Math.max(0, dataPoints.length - windowSize);
          }
          const eventTime = new Date(dataPoints[foundIndex].timestamp);
          const dateStr = eventTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const timeStr = eventTime.toLocaleTimeString(undefined, { hour: '2-digit', minute:'2-digit' });
          viewModeText = `Incident review: <span class="text-white">${dateStr} ${timeStr}</span>`;
      }
  }

  const slice = dataPoints.slice(startIndex, startIndex + windowSize); 
  const labels = slice.map(d => {
    const date = new Date(d.timestamp);
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${month} ${day} ${hour}:${min}`;
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
  let isAnomalyActive = false;

  slice.forEach((point, index) => {
      if (point.predicted_anomaly === 1) {
          if (!isAnomalyActive) {
              const pointTs = new Date(point.timestamp).getTime();
              const isRecent = pointTs > cutoffTime;
              
              lineMarkers.push({
                  index: index,
                  color: isRecent ? '#ef4444' : '#64748b',
                  text: isRecent ? 'ANOMALY DETECTED' : 'HISTORIC INCIDENT'
              });
              isAnomalyActive = true;
          }
      } else {
          isAnomalyActive = false;
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
      plugins: { 
          legend: { display: false },
          verticalLine: { lines: lineMarkers }
      },
      animation: { duration: 0 },
      scales: {
        x: { display: false },
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
      const date = new Date(d.timestamp);
      const dateStr = date.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: false
      });

      const point = {
          ...d, 
          score: d.anomaly_score || 0,
          isAnom: d.predicted_anomaly === 1,
          isRecent: new Date(d.timestamp).getTime() > cutoffTime,
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
      
      let r;
      if (point.isAnom) {
          r = 1.0 + (point.score * 4.0); 
      } else {
          r = Math.random() * 0.8; 
      }

      return {
          x: Math.sin(angle) * r,
          y: -Math.cos(angle) * r, // Negative Cos to put 12:00 at Top
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
        { 
            label: 'Nominal', 
            data: normalSet, 
            backgroundColor: '#38bdf8', 
            pointRadius: 2 
        },
        { 
            label: 'Active Anomaly', 
            data: activeSet, 
            backgroundColor: '#ef4444', 
            pointRadius: 5,
            pointHoverRadius: 7
        },
        { 
            label: 'Historic Anomaly', 
            data: historicSet, 
            backgroundColor: '#64748b', 
            pointRadius: 3 
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false, min: -6, max: 6 }, y: { display: false, min: -6, max: 6 } },
      plugins: { 
          legend: { display: true, labels: { color: '#94a3b8' } },
          tooltip: {
            callbacks: {
                label: (ctx) => `${ctx.raw.fullLabel} (${ctx.raw.statusLabel})`
            }
          }
      }
    }
  });
}

function updateHealthMetrics(metrics) {
  const setVal = (id, val, colorClass) => {
    const el = document.getElementById(id);
    if(el) {
        el.innerText = val;
        el.className = ''; 
        if(colorClass) el.className = `text-3xl font-bold font-mono ${colorClass}`;
    }
  };
  setVal('gs-metric-precision', (metrics.precision * 100).toFixed(1) + '%', 'text-emerald-400');
  setVal('gs-metric-recall', (metrics.recall * 100).toFixed(1) + '%', 'text-emerald-400');
  setVal('gs-metric-rate', (metrics.contamination * 100).toFixed(1) + '%', 'text-sky-400');
}
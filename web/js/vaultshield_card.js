/**
 * web/js/vaultshield_card.js
 * Visualizes sequence anomalies and security threat narratives.
 */

window.initVaultShield = function() {
    console.log('[VaultShield] Initializing...');

    // Load from the merged artifacts file
    if (!window.VAULTSHIELD_ARTIFACTS) {
        console.warn('[VaultShield] Artifacts not found. Run pipelines/vaultshield/export_web_artifacts.py first.');
        return;
    }

    const data = window.VAULTSHIELD_ARTIFACTS;

    renderOverviewStats(data);
    renderAttackChart(data);
    renderForensics(data);
    renderDistChart(data);
    renderMetrics(data);
};

/* --- 1. Overview Stats --- */
function renderOverviewStats(data) {
    const totalSessions = data.total_sessions || 0;
    const blockedCount = data.attack_counts ? Object.values(data.attack_counts).reduce((a,b)=>a+b, 0) : 0;
    
    document.getElementById('vs-stat-sessions').innerText = totalSessions.toLocaleString();
    document.getElementById('vs-stat-blocked').innerText = blockedCount.toLocaleString();

    const elThreat = document.getElementById('vs-stat-threat-level');
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
}

/* --- 2. Attack Patterns Chart (Bar) --- */
function renderAttackChart(data) {
    const canvas = document.querySelector('[data-vs-attack-chart]');
    if (!canvas || !window.Chart) return;

    const counts = data.attack_counts || {};
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    
    const labels = sorted.map(x => x[0].replace(/_/g, ' '));
    const values = sorted.map(x => x[1]);

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
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

/* --- 3. Forensics Timeline (Rich Visuals) --- */
function renderForensics(data) {
    const container = document.getElementById('vs-timeline-container');
    const explanationEl = document.getElementById('vs-explanation-text');
    const scoreEl = document.getElementById('vs-score-val');
    const scoreBar = document.getElementById('vs-score-bar');
    const headerEl = document.getElementById('vs-session-header');

    if (!container || !data.top_anomaly) return;

    const session = data.top_anomaly;

    headerEl.innerText = `ID: ${session.session_id.substring(0,8)}... | User: ${session.user_id}`;
    scoreEl.innerText = session.anomaly_score.toFixed(2);
    
    // Scale bar: assume 20 is a "huge" score
    const pct = Math.min(100, (session.anomaly_score / 20) * 100);
    scoreBar.style.width = `${pct}%`;

    const badTransition = session.explanation || "";
    const [badStart, badEnd] = badTransition.split(' → ');

    explanationEl.innerHTML = `
        <strong class="text-white">Attack Pattern:</strong> ${session.attack_type.replace(/_/g, ' ')}<br>
        <span class="opacity-80">
        System flagged improbable transition: 
        <span class="text-rose-400 font-mono bg-rose-500/10 px-1 rounded">${badTransition}</span>. 
        Probability: <strong>${session.worst_prob.toExponential(2)}</strong>.
        </span>
    `;

    // Render Timeline Nodes
    container.innerHTML = ''; 
    const events = session.events;

    events.forEach((evt, idx) => {
        const isLast = idx === events.length - 1;
        let nodeColor = "bg-slate-800 border-slate-600 text-slate-400";
        let lineColor = "bg-slate-700";
        
        if (evt.includes("fail") || evt.includes("denied")) {
            nodeColor = "bg-amber-900/50 border-amber-500 text-amber-200";
        }
        if (evt === "login_success" || evt.includes("approved")) {
            nodeColor = "bg-emerald-900/50 border-emerald-500 text-emerald-200";
        }

        // Highlight bad link
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

/* --- 4. Score Distribution (Mocked based on averages) --- */
function renderDistChart(data) {
    const canvas = document.querySelector('[data-vs-dist-chart]');
    if (!canvas || !window.Chart) return;
    
    new Chart(canvas, {
        type: 'line',
        data: {
            labels: ['0-5', '5-10', '10-15', '15-20', '20+'],
            datasets: [
                {
                    label: 'Normal Traffic',
                    data: [800, 150, 20, 5, 0],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Attack Traffic',
                    data: [0, 10, 50, 200, 150],
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

function renderMetrics(data) {
    const el = document.getElementById('vs-metric-prauc');
    if (el && data.metrics) {
        el.innerText = (data.metrics.pr_auc * 100).toFixed(1) + "%";
    }
}
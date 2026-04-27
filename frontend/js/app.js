const API = "/api";
let currentUser = null;
let allActivities = [];
let chartInstances = [];
let _mapInstance  = null;
let _hoverMarker  = null;

const SPORT_COLORS = { running: "#4f8ef7", cycling: "#43c59e", hiking: "#f7b84f", other: "#a0a0a0" };
const SPORT_NAMES  = { running: "Laufen", cycling: "Radfahren", hiking: "Wandern", other: "Sonstiges" };
const SPORT_ICONS  = { running: "🏃", cycling: "🚴", hiking: "🥾", other: "🏅" };
const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

// --- HTTP ---
async function request(method, url, body) {
    const res = await fetch(API + url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Request failed");
    }
    return res.status === 204 ? null : res.json();
}

// --- Helpers ---
function getYear(a)  { return new Date(a.start_time).getFullYear(); }
function getMonth(a) { return new Date(a.start_time).getMonth(); }
function getYears()  { return [...new Set(allActivities.map(getYear))].sort((a, b) => b - a); }

function computeStats(acts) {
    return {
        count: acts.length,
        km:    acts.reduce((s, a) => s + a.distance_m / 1000, 0),
        time:  acts.reduce((s, a) => s + a.duration_s, 0),
        ele:   acts.reduce((s, a) => s + (a.elevation_gain_m || 0), 0),
    };
}

function delta(curr, prev, decimals = 0) {
    if (!prev || prev === 0) return "";
    const diff = curr - prev;
    if (Math.abs(diff) < 0.05) return "";
    const cls  = diff > 0 ? "delta-up" : "delta-down";
    const sign = diff > 0 ? "+" : "";
    const val  = decimals > 0 ? diff.toFixed(decimals) : Math.round(diff);
    return `<span class="${cls}">${sign}${val}</span>`;
}

function destroyCharts() {
    chartInstances.forEach(c => c.destroy());
    chartInstances = [];
}

function mkChart(id, config) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    chartInstances.push(new Chart(ctx.getContext("2d"), config));
}

// --- Geo / trackpoint math ---
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function movingAvg(arr, window) {
    const half = Math.floor(window / 2);
    return arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - half), Math.min(arr.length, i + half + 1))
                        .filter(v => v !== null && !isNaN(v));
        return slice.length ? slice.reduce((a, b) => a + b) / slice.length : null;
    });
}

function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

function processTrackpoints(pts) {
    const cumDist = [0];
    for (let i = 1; i < pts.length; i++) {
        cumDist.push(cumDist[i - 1] + haversineKm(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon));
    }

    const rawPace = [null];
    for (let i = 1; i < pts.length; i++) {
        const dKm  = cumDist[i] - cumDist[i - 1];
        const dSec = (new Date(pts[i].timestamp) - new Date(pts[i - 1].timestamp)) / 1000;
        if (dKm < 0.001 || dSec <= 0) { rawPace.push(null); continue; }
        const p = (dSec / 60) / dKm;
        rawPace.push(p >= 1.5 && p <= 30 ? p : null);
    }

    const MAX = 600;
    const idx  = downsample([...Array(pts.length).keys()], MAX);
    return {
        dist: idx.map(i => cumDist[i]),
        ele:  idx.map(i => pts[i].elevation),
        hr:   idx.map(i => pts[i].hr),
        pace: movingAvg(idx.map(i => rawPace[i]), 15),
        idx,
    };
}

// --- Auth ---
function showLogin() {
    document.getElementById("login-page").classList.remove("hidden");
    document.getElementById("main-page").classList.add("hidden");
}

function showMain() {
    document.getElementById("nav-user").textContent = currentUser.name;
    document.getElementById("login-page").classList.add("hidden");
    document.getElementById("main-page").classList.remove("hidden");
    loadDashboard();
}

async function init() {
    try {
        currentUser = await request("GET", "/users/me");
        allActivities = await request("GET", "/activities/");
        showMain();
    } catch {
        showLogin();
    }
}

// --- Dashboard ---
function loadDashboard() {
    const years = getYears();
    renderDashboard(years[0] || new Date().getFullYear(), years);
}

function renderDashboard(year, years) {
    destroyCharts();
    const content = document.getElementById("content");

    const curr = computeStats(allActivities.filter(a => getYear(a) === year));
    const prev = computeStats(allActivities.filter(a => getYear(a) === year - 1));

    const sports = ["running", "cycling", "hiking", "other"];
    const monthlyBySport = {};
    sports.forEach(sport => {
        monthlyBySport[sport] = MONTHS.map((_, m) =>
            allActivities
                .filter(a => getYear(a) === year && getMonth(a) === m && a.sport_type === sport)
                .reduce((s, a) => s + a.distance_m / 1000, 0)
        );
    });

    const yearTabs = years.map(y =>
        `<button class="year-tab${y === year ? " active" : ""}" data-year="${y}">${y}</button>`
    ).join("");

    const recent = allActivities.filter(a => getYear(a) === year).slice(0, 8);

    content.innerHTML = `
        <div class="page-header">
            <h2>Dashboard</h2>
            <div class="year-tabs">${yearTabs}</div>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${curr.count}</div>
                <div class="stat-label">Aktivitäten ${delta(curr.count, prev.count)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${curr.km.toFixed(1)}</div>
                <div class="stat-label">km gesamt ${delta(curr.km, prev.km, 1)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${fmtDuration(curr.time)}</div>
                <div class="stat-label">Gesamtzeit</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(curr.ele)}</div>
                <div class="stat-label">Höhenmeter ${delta(curr.ele, prev.ele)}</div>
            </div>
        </div>
        <h3>km pro Monat</h3>
        <div class="chart-box"><canvas id="monthly-chart"></canvas></div>
        <h3>Aktivitäten ${year}</h3>
        <div class="activity-list">${recent.map(activityCard).join("") || "<p>Keine Aktivitäten in diesem Jahr.</p>"}</div>
    `;

    const activeSports = sports.filter(s => monthlyBySport[s].some(v => v > 0));
    mkChart("monthly-chart", {
        type: "bar",
        data: {
            labels: MONTHS,
            datasets: activeSports.map(sport => ({
                label: SPORT_NAMES[sport],
                data: monthlyBySport[sport],
                backgroundColor: SPORT_COLORS[sport],
                borderRadius: 3,
            })),
        },
        options: {
            responsive: true,
            plugins: { legend: { position: "top" } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, title: { display: true, text: "km" } },
            },
        },
    });

    document.querySelectorAll(".year-tab").forEach(btn => {
        btn.addEventListener("click", () => renderDashboard(parseInt(btn.dataset.year), years));
    });
    document.querySelectorAll(".activity-card").forEach(el => {
        el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
    });
}

// --- Activity list ---
function loadActivities() {
    renderActivities("all", "all", "date");
}

function renderActivities(sport, year, sort) {
    destroyCharts();
    const content = document.getElementById("content");
    const years = getYears();

    let filtered = allActivities;
    if (sport !== "all") filtered = filtered.filter(a => a.sport_type === sport);
    if (year !== "all") filtered = filtered.filter(a => getYear(a) === parseInt(year));

    if (sort === "distance") filtered = [...filtered].sort((a, b) => b.distance_m - a.distance_m);
    else if (sort === "pace")  filtered = [...filtered].filter(a => a.avg_pace).sort((a, b) => a.avg_pace - b.avg_pace);
    else                       filtered = [...filtered].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    const sportBtns = ["all", "running", "cycling", "hiking", "other"].map(s =>
        `<button class="filter-btn${sport === s ? " active" : ""}" data-sport="${s}">
            ${s === "all" ? "Alle" : SPORT_ICONS[s] + " " + SPORT_NAMES[s]}
        </button>`
    ).join("");

    const yearOpts = ["all", ...years].map(y =>
        `<option value="${y}"${y == year ? " selected" : ""}>${y === "all" ? "Alle Jahre" : y}</option>`
    ).join("");

    const sortOpts = [["date","Datum"],["distance","Distanz"],["pace","Pace"]].map(([v, l]) =>
        `<option value="${v}"${sort === v ? " selected" : ""}>${l}</option>`
    ).join("");

    content.innerHTML = `
        <div class="page-header"><h2>Aktivitäten (${filtered.length})</h2></div>
        <div class="filter-bar">
            <div class="filter-group">${sportBtns}</div>
            <div class="filter-group">
                <select id="year-select">${yearOpts}</select>
                <select id="sort-select">${sortOpts}</select>
            </div>
        </div>
        <div class="activity-list">${filtered.map(activityCard).join("") || "<p>Keine Aktivitäten gefunden.</p>"}</div>
    `;

    const rerender = () => renderActivities(
        document.querySelector(".filter-btn.active")?.dataset.sport ?? "all",
        document.getElementById("year-select").value,
        document.getElementById("sort-select").value
    );

    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            rerender();
        });
    });
    document.getElementById("year-select").addEventListener("change", rerender);
    document.getElementById("sort-select").addEventListener("change", rerender);
    document.querySelectorAll(".activity-card").forEach(el => {
        el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
    });
}

// --- Personal Records ---
async function loadPRs() {
    destroyCharts();
    const content = document.getElementById("content");
    content.innerHTML = `<h2>Bestzeiten</h2><p class="muted">Berechne Bestzeiten aus Trackpoints…</p>`;
    await new Promise(r => setTimeout(r, 0));

    let data;
    try {
        data = await request("GET", "/prs/");
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
        return;
    }

    const prRows = data.standard.map(pr => {
        if (!pr) return `<tr><td>–</td><td colspan="3" class="pr-empty">–</td></tr>`;
        return `<tr class="pr-row" data-id="${pr.activity_id}">
            <td>${pr.label}</td>
            <td><strong>${fmtSeconds(pr.best_s)}</strong></td>
            <td>${fmtPace(pr.pace_min_km)} /km</td>
            <td>${fmtDate(pr.date)}</td>
        </tr>`;
    }).join("");

    const recordCard = (label, value, sub, id) =>
        `<div class="pr-record-card" data-id="${id}">
            <div class="pr-record-value">${value}</div>
            <div class="pr-record-label">${label}</div>
            <div class="pr-record-sub">${sub}</div>
        </div>`;

    const { longest, most_elevation, fastest_pace } = data.records;

    content.innerHTML = `
        <h2>Bestzeiten</h2>
        <h3>🏃 Laufen – Standarddistanzen</h3>
        <div class="pr-table-wrap">
            <table class="pr-table">
                <thead><tr><th>Distanz</th><th>Bestzeit</th><th>Pace</th><th>Datum</th></tr></thead>
                <tbody>${prRows}</tbody>
            </table>
            <p class="pr-hint">Schnellstes Segment der jeweiligen Distanz aus allen Aktivitäten (Sliding Window über Trackpoints).</p>
        </div>
        <h3>🏆 Rekorde</h3>
        <div class="pr-records">
            ${longest       ? recordCard("Längste Strecke",    (longest.distance_m / 1000).toFixed(2) + " km", fmtDate(longest.start_time),       longest.id)       : ""}
            ${most_elevation? recordCard("Meiste Höhenmeter",  Math.round(most_elevation.elevation_gain_m) + " Hm", fmtDate(most_elevation.start_time), most_elevation.id): ""}
            ${fastest_pace  ? recordCard("Schnellste Ø Pace",  fmtPace(fastest_pace.avg_pace) + " /km",        fmtDate(fastest_pace.start_time),    fastest_pace.id)  : ""}
        </div>
    `;

    document.querySelectorAll(".pr-row, .pr-record-card").forEach(el => {
        const id = parseInt(el.dataset.id);
        if (id) el.addEventListener("click", () => loadActivity(id));
    });
}

function fmtSeconds(totalSec) {
    if (!totalSec) return "–";
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

// --- Single activity ---
async function loadActivity(id) {
    destroyCharts();
    const content = document.getElementById("content");
    content.innerHTML = "<p>Lade…</p>";
    try {
        const [activity, trackpoints] = await Promise.all([
            request("GET", `/activities/${id}`),
            request("GET", `/activities/${id}/trackpoints`),
        ]);

        const hasEle  = trackpoints.some(p => p.elevation !== null);
        const hasHr   = trackpoints.some(p => p.hr !== null);
        const hasPace = trackpoints.length > 5;

        const sportOptions = [
            ["running", "🏃 Laufen"],
            ["cycling", "🚴 Radfahren"],
            ["hiking",  "🥾 Wandern"],
            ["other",   "🏅 Sonstige"],
        ].map(([v, l]) => `<option value="${v}"${v === activity.sport_type ? " selected" : ""}>${l}</option>`).join("");

        content.innerHTML = `
            <div class="page-header">
                <h2>${fmtDate(activity.start_time)}</h2>
                <div style="display:flex;gap:.5rem;align-items:center;">
                    <select id="sport-type-select">${sportOptions}</select>
                    <button class="btn-secondary" id="back-btn">← Zurück</button>
                </div>
            </div>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${(activity.distance_m / 1000).toFixed(2)}</div><div class="stat-label">km</div></div>
                <div class="stat-card"><div class="stat-value">${fmtDuration(activity.duration_s)}</div><div class="stat-label">Zeit</div></div>
                ${activity.avg_pace ? `<div class="stat-card"><div class="stat-value">${fmtPace(activity.avg_pace)}</div><div class="stat-label">Ø Pace /km</div></div>` : ""}
                ${activity.avg_hr  ? `<div class="stat-card"><div class="stat-value">${activity.avg_hr}</div><div class="stat-label">Ø HR bpm</div></div>` : ""}
                ${activity.max_hr  ? `<div class="stat-card"><div class="stat-value">${activity.max_hr}</div><div class="stat-label">Max HR bpm</div></div>` : ""}
                ${activity.elevation_gain_m ? `<div class="stat-card"><div class="stat-value">${Math.round(activity.elevation_gain_m)}</div><div class="stat-label">Höhenmeter</div></div>` : ""}
            </div>
            <div id="map"></div>
            ${hasEle  ? '<h3>Höhenprofil</h3><div class="chart-box"><canvas id="chart-ele"></canvas></div>'   : ""}
            ${hasPace ? '<h3>Pace</h3><div class="chart-box"><canvas id="chart-pace"></canvas></div>'         : ""}
            ${hasHr   ? '<h3>Herzfrequenz</h3><div class="chart-box"><canvas id="chart-hr"></canvas></div>'   : ""}
            ${hasHr && currentUser.max_hr ? '<h3>HR-Zonen</h3><div class="chart-box chart-box--zones"><canvas id="chart-hr-zones"></canvas></div>' : ""}
        `;

        document.getElementById("back-btn").addEventListener("click", loadActivities);
        document.getElementById("sport-type-select").addEventListener("change", async (e) => {
            await request("PATCH", `/activities/${id}`, { sport_type: e.target.value });
        });
        if (trackpoints.length > 0) {
            renderMap(trackpoints);
            renderActivityCharts(trackpoints, { hasEle, hasHr, hasPace });
            if (hasHr && currentUser.max_hr) renderHrZones(trackpoints, currentUser.max_hr, currentUser.hr_zones ?? null);
        }
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

function renderActivityCharts(pts, { hasEle, hasHr, hasPace }) {
    const { dist, ele, hr, pace, idx } = processTrackpoints(pts);
    const labels = dist.map(d => d.toFixed(2));

    const syncMap = (dataIdx) => {
        if (!_mapInstance || dataIdx === undefined) return;
        const origIdx = idx[dataIdx];
        if (origIdx === undefined) return;
        const tp = pts[origIdx];
        const ll = [tp.lat, tp.lon];
        if (!_hoverMarker) {
            _hoverMarker = L.circleMarker(ll, { radius: 7, color: "#1a1a2e", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(_mapInstance);
        } else {
            _hoverMarker.setLatLng(ll);
        }
    };
    const clearSync = () => {
        if (_hoverMarker && _mapInstance) { _mapInstance.removeLayer(_hoverMarker); _hoverMarker = null; }
    };

    const vLinePlug = {
        id: "vLine",
        afterDraw(chart) {
            const active = chart.tooltip?._active;
            if (!active?.length) return;
            const { ctx, chartArea: { top, bottom } } = chart;
            const x = chart.getDatasetMeta(0).data[active[0].index]?.x;
            if (x === undefined) return;
            ctx.save();
            ctx.strokeStyle = "rgba(0,0,0,0.22)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
            ctx.restore();
        },
    };

    const lineBase = (color) => ({
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
    });

    const xAxis = {
        title: { display: true, text: "km" },
        ticks: { maxTicksLimit: 10 },
    };

    const syncOpts = {
        onHover: (_, elements) => { if (elements.length) syncMap(elements[0].index); },
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
    };

    const addSync = (id) => {
        document.getElementById(id)?.addEventListener("mouseleave", clearSync);
    };

    if (hasEle) {
        mkChart("chart-ele", {
            type: "line",
            plugins: [vLinePlug],
            data: { labels, datasets: [{ label: "Höhe (m)", data: ele, ...lineBase("#6d9eeb") }] },
            options: {
                ...syncOpts,
                responsive: true,
                scales: { x: xAxis, y: { title: { display: true, text: "m ü.M." } } },
            },
        });
        addSync("chart-ele");
    }

    if (hasPace) {
        mkChart("chart-pace", {
            type: "line",
            plugins: [vLinePlug],
            data: { labels, datasets: [{ label: "Pace", data: pace, ...lineBase("#93c47d") }] },
            options: {
                ...syncOpts,
                responsive: true,
                scales: {
                    x: xAxis,
                    y: {
                        title: { display: true, text: "min/km" },
                        ticks: {
                            callback: v => {
                                const m = Math.floor(v);
                                const s = Math.round((v - m) * 60);
                                return `${m}:${String(s).padStart(2, "0")}`;
                            },
                        },
                    },
                },
            },
        });
        addSync("chart-pace");
    }

    if (hasHr) {
        mkChart("chart-hr", {
            type: "line",
            plugins: [vLinePlug],
            data: { labels, datasets: [{ label: "HR (bpm)", data: hr, ...lineBase("#e06666") }] },
            options: {
                ...syncOpts,
                responsive: true,
                scales: { x: xAxis, y: { title: { display: true, text: "bpm" } } },
            },
        });
        addSync("chart-hr");
    }
}

function renderMap(trackpoints) {
    _mapInstance = null;
    _hoverMarker = null;
    const map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const latlngs = trackpoints.map(p => [p.lat, p.lon]);
    map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [20, 20] });

    const mkIcon = html => L.divIcon({ html, className: "map-pin", iconSize: [20, 20], iconAnchor: [10, 10] });
    L.marker(latlngs[0], { icon: mkIcon("🟢") }).addTo(map);
    L.marker(latlngs[latlngs.length - 1], { icon: mkIcon("🔴") }).addTo(map);

    const hasHr = trackpoints.some(p => p.hr !== null);

    // Per-segment smoothed pace
    const rawPace = [null];
    for (let i = 1; i < trackpoints.length; i++) {
        const dKm  = haversineKm(trackpoints[i-1].lat, trackpoints[i-1].lon, trackpoints[i].lat, trackpoints[i].lon);
        const dMin = (new Date(trackpoints[i].timestamp) - new Date(trackpoints[i-1].timestamp)) / 60000;
        const p = (dKm >= 0.001 && dMin > 0) ? dMin / dKm : null;
        rawPace.push(p && p >= 1.5 && p <= 30 ? p : null);
    }
    const smoothPace = movingAvg(rawPace, 11);

    const validPace = smoothPace.filter(v => v !== null);
    const minP = validPace.length ? Math.min(...validPace) : 4;
    const maxP = validPace.length ? Math.max(...validPace) : 8;

    const hrVals = hasHr ? trackpoints.map(p => p.hr).filter(v => v !== null) : [];
    const minHr = hrVals.length ? Math.min(...hrVals) : 0;
    const maxHr = hrVals.length ? Math.max(...hrVals) : 200;

    function heatColor(val, min, max) {
        const t = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0.5;
        return `hsl(${Math.round(120 * (1 - t))}, 80%, 40%)`;
    }

    const paceGroup = L.layerGroup();
    const hrGroup   = L.layerGroup();

    for (let i = 1; i < trackpoints.length; i++) {
        const seg = [latlngs[i-1], latlngs[i]];
        const p = smoothPace[i];
        const pColor = p !== null ? heatColor(p, minP, maxP) : "#999";
        const pLabel = p !== null
            ? `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")} /km`
            : "–";
        L.polyline(seg, { color: pColor, weight: 4, opacity: 0.85 })
            .addTo(paceGroup)
            .bindTooltip(pLabel, { sticky: true });

        if (hasHr && trackpoints[i].hr !== null) {
            L.polyline(seg, { color: heatColor(trackpoints[i].hr, minHr, maxHr), weight: 4, opacity: 0.85 })
                .addTo(hrGroup)
                .bindTooltip(`${trackpoints[i].hr} bpm`, { sticky: true });
        }
    }

    paceGroup.addTo(map);
    _mapInstance = map;

    if (hasHr) {
        const ctrl = L.control({ position: "topright" });
        ctrl.onAdd = () => {
            const div = L.DomUtil.create("div", "map-mode-ctrl");
            div.innerHTML = `<button class="map-mode-btn active" data-m="pace">Pace</button><button class="map-mode-btn" data-m="hr">HR</button>`;
            L.DomEvent.disableClickPropagation(div);
            div.querySelectorAll("button").forEach(btn => {
                btn.addEventListener("click", () => {
                    div.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.m === btn.dataset.m));
                    if (btn.dataset.m === "pace") { map.removeLayer(hrGroup); paceGroup.addTo(map); }
                    else                          { map.removeLayer(paceGroup); hrGroup.addTo(map); }
                });
            });
            return div;
        };
        ctrl.addTo(map);
    }
}

// --- Activity card ---
function activityCard(a) {
    return `<div class="activity-card" data-id="${a.id}">
        <span class="act-sport">${SPORT_ICONS[a.sport_type] ?? "🏅"}</span>
        <div class="act-info">
            <div class="act-title">${fmtDate(a.start_time)}</div>
            <div class="act-meta">
                ${(a.distance_m / 1000).toFixed(2)} km
                · ${fmtDuration(a.duration_s)}
                ${a.avg_pace ? " · " + fmtPace(a.avg_pace) + " /km" : ""}
                ${a.avg_hr ? " · ♥ " + a.avg_hr : ""}
                ${a.elevation_gain_m ? " · ↑ " + Math.round(a.elevation_gain_m) + " m" : ""}
            </div>
        </div>
    </div>`;
}

// --- Formatters ---
function fmtDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDuration(seconds) {
    if (!seconds) return "–";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(minPerKm) {
    if (!minPerKm) return "–";
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

// --- Event listeners ---
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");
    try {
        await request("POST", "/users/login", {
            email: document.getElementById("email").value,
            password: document.getElementById("password").value,
        });
        [currentUser, allActivities] = await Promise.all([
            request("GET", "/users/me"),
            request("GET", "/activities/"),
        ]);
        showMain();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
    }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
    await request("POST", "/users/logout").catch(() => {});
    currentUser = null;
    allActivities = [];
    showLogin();
});

document.querySelectorAll("nav a[data-view]").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        if (link.dataset.view === "dashboard") loadDashboard();
        else if (link.dataset.view === "activities") loadActivities();
        else if (link.dataset.view === "prs") loadPRs();
        else if (link.dataset.view === "map")      loadMapOverview();
        else if (link.dataset.view === "settings") loadSettings();
    });
});

// --- Map overview (all activities) ---
async function loadMapOverview() {
    destroyCharts();
    const content = document.getElementById("content");
    content.innerHTML = `
        <div class="page-header">
            <h2>Karte</h2>
            <div class="filter-bar">
                <div class="filter-group" id="map-sport-filter">
                    <button class="filter-btn active" data-sport="all">Alle</button>
                    <button class="filter-btn" data-sport="running">🏃 Laufen</button>
                    <button class="filter-btn" data-sport="cycling">🚴 Radfahren</button>
                    <button class="filter-btn" data-sport="hiking">🥾 Wandern</button>
                    <button class="filter-btn" data-sport="other">🏅 Sonstige</button>
                </div>
            </div>
        </div>
        <div id="map-overview"></div>
    `;
    await new Promise(r => setTimeout(r, 0));

    const data = await request("GET", "/activities/overview");

    const map = L.map("map-overview");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const polylines = data
        .filter(a => a.pts && a.pts.length > 1)
        .map(a => {
            const poly = L.polyline(a.pts, {
                color: SPORT_COLORS[a.sport_type] ?? "#888",
                weight: 3,
                opacity: 0.65,
            });
            poly.bindTooltip(
                `${SPORT_ICONS[a.sport_type] ?? "🏅"} ${fmtDate(a.start_time)} · ${(a.distance_m / 1000).toFixed(2)} km`,
                { sticky: true }
            );
            poly.on("click", () => loadActivity(a.id));
            poly._sport = a.sport_type;
            return poly;
        });

    const group = L.layerGroup(polylines).addTo(map);
    if (polylines.length) map.fitBounds(L.featureGroup(polylines).getBounds(), { padding: [20, 20] });

    document.querySelectorAll("#map-sport-filter .filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#map-sport-filter .filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const sport = btn.dataset.sport;
            group.clearLayers();
            polylines.filter(p => sport === "all" || p._sport === sport).forEach(p => group.addLayer(p));
        });
    });
}

// --- Settings ---
function loadSettings() {
    destroyCharts();
    const content = document.getElementById("content");
    const maxHr = currentUser.max_hr ?? "";
    const cz    = currentUser.hr_zones ?? [];
    const zv    = i => cz[i] ?? "";

    content.innerHTML = `
        <h2>Einstellungen</h2>
        <div class="settings-form">
            <label class="settings-label">Maximalpuls (bpm)
                <input type="number" id="max-hr-input" min="100" max="250" value="${maxHr}" placeholder="z.B. 190">
            </label>
            <p class="settings-hint">Wird für die automatische Zonenberechnung verwendet (5 Zonen nach % des Maximalpulses).</p>

            <div class="settings-section-title">Manuelle Zonengrenzen (bpm) <button id="calc-zones-btn" class="btn-secondary" style="margin-left:.5rem">Aus Maximalpuls berechnen</button></div>
            <div class="zones-grid">
                <label class="settings-label">Z1 / Z2 Grenze<input type="number" class="zone-input" data-z="0" min="80" max="240" value="${zv(0)}" placeholder="z.B. 120"></label>
                <label class="settings-label">Z2 / Z3 Grenze<input type="number" class="zone-input" data-z="1" min="80" max="240" value="${zv(1)}" placeholder="z.B. 140"></label>
                <label class="settings-label">Z3 / Z4 Grenze<input type="number" class="zone-input" data-z="2" min="80" max="240" value="${zv(2)}" placeholder="z.B. 160"></label>
                <label class="settings-label">Z4 / Z5 Grenze<input type="number" class="zone-input" data-z="3" min="80" max="240" value="${zv(3)}" placeholder="z.B. 175"></label>
            </div>
            <p class="settings-hint">Leer lassen, um die automatische %-Berechnung zu verwenden.</p>

            <button id="save-settings-btn" class="btn-primary">Speichern</button>
            <span id="settings-msg" class="settings-msg hidden">✓ Gespeichert</span>
        </div>
    `;

    document.getElementById("calc-zones-btn").addEventListener("click", () => {
        const mhr = parseInt(document.getElementById("max-hr-input").value);
        if (!mhr) return;
        const pcts = [0.60, 0.70, 0.80, 0.90];
        document.querySelectorAll(".zone-input").forEach((inp, i) => {
            inp.value = Math.round(mhr * pcts[i]);
        });
    });

    document.getElementById("save-settings-btn").addEventListener("click", async () => {
        const mhr  = parseInt(document.getElementById("max-hr-input").value) || null;
        const vals = [...document.querySelectorAll(".zone-input")].map(inp => parseInt(inp.value) || null);
        const zones = vals.every(v => v !== null) ? vals : null;
        await request("PATCH", "/users/me", { max_hr: mhr, hr_zones: zones });
        currentUser.max_hr   = mhr;
        currentUser.hr_zones = zones;
        const msg = document.getElementById("settings-msg");
        msg.classList.remove("hidden");
        setTimeout(() => msg.classList.add("hidden"), 2000);
    });
}

// --- HR Zones ---
const HR_ZONES = [
    { label: "Z1 Regeneration", max: 0.60, color: "#7bc8f6" },
    { label: "Z2 Grundlage",    max: 0.70, color: "#4f8ef7" },
    { label: "Z3 Aerob",        max: 0.80, color: "#93c47d" },
    { label: "Z4 Schwelle",     max: 0.90, color: "#f7b84f" },
    { label: "Z5 Maximal",      max: 1.00, color: "#e06666" },
];

function computeHrZones(trackpoints, maxHr, customZones) {
    const limits = customZones && customZones.length === 4
        ? [...customZones, Infinity]
        : HR_ZONES.map(z => z.max * maxHr);
    const times = new Array(5).fill(0);
    for (let i = 1; i < trackpoints.length; i++) {
        const hr = trackpoints[i].hr;
        if (!hr || !trackpoints[i].timestamp || !trackpoints[i-1].timestamp) continue;
        const dt = (new Date(trackpoints[i].timestamp) - new Date(trackpoints[i-1].timestamp)) / 1000;
        if (dt <= 0 || dt > 60) continue;
        const zone = limits.findIndex(lim => hr <= lim);
        times[zone === -1 ? 4 : zone] += dt;
    }
    return times;
}

function renderHrZones(trackpoints, maxHr, customZones) {
    const times = computeHrZones(trackpoints, maxHr, customZones);
    const total = times.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    mkChart("chart-hr-zones", {
        type: "doughnut",
        data: {
            labels: HR_ZONES.map((z, i) => `${z.label} (${fmtDuration(Math.round(times[i]))})`),
            datasets: [{ data: times, backgroundColor: HR_ZONES.map(z => z.color), borderWidth: 1 }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: "right" },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const pct = total > 0 ? Math.round(ctx.parsed / total * 100) : 0;
                            return ` ${fmtDuration(Math.round(ctx.parsed))}  (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

init();

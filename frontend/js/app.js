const API = "/api";
let currentUser = null;
let allActivities = [];
let chartInstances = [];

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

        content.innerHTML = `
            <div class="page-header">
                <h2>${SPORT_ICONS[activity.sport_type] ?? "🏅"} ${fmtDate(activity.start_time)}</h2>
                <button class="btn-secondary" id="back-btn">← Zurück</button>
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
        `;

        document.getElementById("back-btn").addEventListener("click", loadActivities);
        if (trackpoints.length > 0) {
            renderMap(trackpoints);
            renderActivityCharts(trackpoints, { hasEle, hasHr, hasPace });
        }
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

function renderActivityCharts(pts, { hasEle, hasHr, hasPace }) {
    const { dist, ele, hr, pace } = processTrackpoints(pts);
    const labels = dist.map(d => d.toFixed(2));

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

    if (hasEle) {
        mkChart("chart-ele", {
            type: "line",
            data: { labels, datasets: [{ label: "Höhe (m)", data: ele, ...lineBase("#6d9eeb") }] },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { x: xAxis, y: { title: { display: true, text: "m ü.M." } } },
            },
        });
    }

    if (hasPace) {
        mkChart("chart-pace", {
            type: "line",
            data: { labels, datasets: [{ label: "Pace", data: pace, ...lineBase("#93c47d") }] },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: xAxis,
                    y: {
                        title: { display: true, text: "min/km" },
                        reverse: false,
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
    }

    if (hasHr) {
        mkChart("chart-hr", {
            type: "line",
            data: { labels, datasets: [{ label: "HR (bpm)", data: hr, ...lineBase("#e06666") }] },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { x: xAxis, y: { title: { display: true, text: "bpm" } } },
            },
        });
    }
}

function renderMap(trackpoints) {
    const map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    const latlngs = trackpoints.map(p => [p.lat, p.lon]);
    const poly = L.polyline(latlngs, { color: "#1a1a2e", weight: 3 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    L.marker(latlngs[0]).addTo(map).bindPopup("Start");
    L.marker(latlngs[latlngs.length - 1]).addTo(map).bindPopup("Ziel");
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
        currentUser = await request("POST", "/users/login", {
            email: document.getElementById("email").value,
            password: document.getElementById("password").value,
        });
        allActivities = await request("GET", "/activities/");
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
    });
});

init();

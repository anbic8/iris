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

// --- Theme ---
function applyChartTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    Chart.defaults.color = isDark ? "#9ca3af" : "#666";
    Chart.defaults.borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
}

function initTheme() {
    const theme = localStorage.getItem("iris-theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
    applyChartTheme();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function exportCsv(acts) {
    const header = ["Datum","Sportart","Distanz_km","Dauer_s","Pace_min_km","HR_avg","HR_max","Hoehenmeter_m","Notiz"];
    const rows = acts.map(a => [
        a.start_time ? new Date(a.start_time).toLocaleDateString("de-DE") : "",
        a.sport_type,
        a.distance_m ? (a.distance_m / 1000).toFixed(3) : "",
        a.duration_s ?? "",
        a.avg_pace ? fmtPace(a.avg_pace) : "",
        a.avg_hr ?? "",
        a.max_hr ?? "",
        a.elevation_gain_m ? Math.round(a.elevation_gain_m) : "",
        a.notes ? `"${String(a.notes).replace(/"/g, '""')}"` : "",
    ]);
    const csv = [header, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "iris_aktivitaeten.csv"; a.click();
    URL.revokeObjectURL(url);
}

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

// --- Training load / Form calculations ---

function getISOWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day  = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function estimateMaxHr(user) {
    if (user.max_hr) return user.max_hr;
    if (user.birth_year) return Math.max(150, 220 - (new Date().getFullYear() - user.birth_year));
    return 180;
}

function estimateHrFromPace(paceMinKm, maxHr) {
    // 3 min/km → ~95% HRmax, 9 min/km → ~55% HRmax (linear)
    const pct = Math.max(0.55, Math.min(0.95, 0.95 - (paceMinKm - 3.0) / 6.0 * 0.40));
    return Math.round(maxHr * pct);
}

function getZoneBoundaries(user) {
    const maxHr = estimateMaxHr(user);
    if (user.hr_zones && user.hr_zones.length >= 4) return user.hr_zones;
    return [0.60, 0.70, 0.80, 0.90].map(p => Math.round(maxHr * p));
}

function calcTrimp(act, user) {
    const maxHr   = estimateMaxHr(user);
    const restHr  = user.resting_hr || 60;
    const gender  = user.gender || "male";
    const durMin  = act.duration_s / 60;
    let avgHr = act.avg_hr;
    if (!avgHr && act.avg_pace) avgHr = estimateHrFromPace(act.avg_pace, maxHr);
    if (!avgHr) return durMin * 0.5;
    const ratio = Math.max(0, Math.min(1, (avgHr - restHr) / Math.max(1, maxHr - restHr)));
    return gender === "female"
        ? durMin * ratio * 0.86 * Math.exp(1.67 * ratio)
        : durMin * ratio * 0.64 * Math.exp(1.92 * ratio);
}

function calcVo2(act) {
    if (!act.avg_pace || !act.duration_s || act.sport_type !== "running") return null;
    const v = 1000 / act.avg_pace;        // m/min
    const t = act.duration_s / 60;        // minutes
    if (t < 8 || v < 80) return null;
    const vo2    = -4.60 + 0.182258 * v + 0.000104 * v * v;
    const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    if (pctMax <= 0) return null;
    const est = vo2 / pctMax;
    return est > 20 && est < 90 ? est : null;
}

function calcVo2max(acts) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    let best = null;
    // prefer last 180 days, fall back to all-time
    for (const a of acts) {
        const v = calcVo2(a);
        if (!v) continue;
        if (!best || v > best.v) best = { v, recent: new Date(a.start_time) >= cutoff };
    }
    if (!best) return null;
    if (!best.recent) {
        // try all-time best
        for (const a of acts) {
            const v = calcVo2(a);
            if (v && (!best || v > best.v)) best = { v, recent: false };
        }
    }
    return best ? Math.round(best.v * 10) / 10 : null;
}

function predictRaceTime(vo2max, distKm) {
    if (!vo2max || vo2max < 20) return null;
    let lo = 1, hi = 600;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const v   = distKm * 1000 / mid;
        const req = -4.60 + 0.182258 * v + 0.000104 * v * v;
        const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * mid) + 0.2989558 * Math.exp(-0.1932605 * mid);
        if (vo2max * pct > req) hi = mid; else lo = mid;
    }
    return Math.round((lo + hi) / 2 * 60);
}

function calcFitnessSeries(acts, user, lookbackDays = 180) {
    const daily = {};
    for (const a of acts) {
        const key = a.start_time.slice(0, 10);
        daily[key] = (daily[key] || 0) + calcTrimp(a, user);
    }
    const kAtl = 1 - Math.exp(-1 / 7);
    const kCtl = 1 - Math.exp(-1 / 42);
    let atl = 0, ctl = 0;
    const end  = new Date();
    const from = new Date(end.getTime() - (lookbackDays + 42) * 86400000);
    const out  = [];
    const cur  = new Date(from);
    while (cur <= end) {
        const key   = cur.toISOString().slice(0, 10);
        const trimp = daily[key] || 0;
        const tsb   = ctl - atl;
        atl = atl + (trimp - atl) * kAtl;
        ctl = ctl + (trimp - ctl) * kCtl;
        if (cur >= new Date(end.getTime() - lookbackDays * 86400000)) {
            out.push({ date: key, atl, ctl, tsb, trimp });
        }
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

function calcWeeklyTrimp(acts, user, weeksBack = 20) {
    const weekly = {};
    for (const a of acts) {
        const d  = new Date(a.start_time);
        const wk = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`;
        weekly[wk] = (weekly[wk] || 0) + calcTrimp(a, user);
    }
    const result = [];
    const now = new Date();
    for (let i = weeksBack - 1; i >= 0; i--) {
        const d  = new Date(now.getTime() - i * 7 * 86400000);
        const wk = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`;
        // label as "DD.MM"
        const mon = new Date(d.getTime() - ((d.getDay() || 7) - 1) * 86400000);
        const lbl = `${String(mon.getDate()).padStart(2,"0")}.${String(mon.getMonth()+1).padStart(2,"0")}`;
        result.push({ week: wk, label: lbl, trimp: Math.round(weekly[wk] || 0) });
    }
    return result;
}

function calcZoneDistForm(acts, user, days = 90) {
    const bounds  = getZoneBoundaries(user);
    const cutoff  = new Date(Date.now() - days * 86400000);
    const dist    = [0, 0, 0, 0, 0];
    for (const a of acts) {
        if (new Date(a.start_time) < cutoff || !a.avg_hr || !a.duration_s) continue;
        const hr = a.avg_hr;
        const z  = hr < bounds[0] ? 0 : hr < bounds[1] ? 1 : hr < bounds[2] ? 2 : hr < bounds[3] ? 3 : 4;
        dist[z] += a.duration_s;
    }
    return dist;
}

function calcMonotony(acts, user, days = 28) {
    const cutoff = new Date(Date.now() - days * 86400000);
    const daily  = {};
    for (const a of acts) {
        if (new Date(a.start_time) < cutoff) continue;
        const key = a.start_time.slice(0, 10);
        daily[key] = (daily[key] || 0) + calcTrimp(a, user);
    }
    const values = [];
    const cur    = new Date(cutoff);
    while (cur <= new Date()) {
        values.push(daily[cur.toISOString().slice(0, 10)] || 0);
        cur.setDate(cur.getDate() + 1);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std  = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    const mono = std > 0 ? Math.round((mean / std) * 100) / 100 : 0;
    return { monotony: mono, strain: Math.round(values.reduce((a, b) => a + b, 0) * mono) };
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
    const isAll = year === "all";

    const yearActs = isAll ? allActivities : allActivities.filter(a => getYear(a) === year);
    const prevActs = isAll ? [] : allActivities.filter(a => getYear(a) === year - 1);
    const curr = computeStats(yearActs);
    const prev = computeStats(prevActs);

    const sports = ["running", "cycling", "hiking", "other"];
    let chartLabels, chartBySport, chartTitle;

    if (isAll) {
        const sortedYears = [...years].sort((a, b) => a - b);
        chartLabels = sortedYears.map(String);
        chartBySport = {};
        sports.forEach(sport => {
            chartBySport[sport] = sortedYears.map(y =>
                allActivities.filter(a => getYear(a) === y && a.sport_type === sport)
                    .reduce((s, a) => s + a.distance_m / 1000, 0)
            );
        });
        chartTitle = "km pro Jahr";
    } else {
        chartLabels = MONTHS;
        chartBySport = {};
        sports.forEach(sport => {
            chartBySport[sport] = MONTHS.map((_, m) =>
                allActivities.filter(a => getYear(a) === year && getMonth(a) === m && a.sport_type === sport)
                    .reduce((s, a) => s + a.distance_m / 1000, 0)
            );
        });
        chartTitle = "km pro Monat";
    }

    const yearTabs = ["all", ...years].map(y =>
        `<button class="year-tab${y === year ? " active" : ""}" data-year="${y}">${y === "all" ? "Gesamt" : y}</button>`
    ).join("");

    const recent = yearActs.slice(0, 8);

    content.innerHTML = `
        <div class="page-header">
            <h2>Dashboard</h2>
            <div class="year-tabs">${yearTabs}</div>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${curr.count}</div>
                <div class="stat-label">Aktivitäten ${!isAll ? delta(curr.count, prev.count) : ""}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${curr.km.toFixed(1)}</div>
                <div class="stat-label">km gesamt ${!isAll ? delta(curr.km, prev.km, 1) : ""}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${fmtDuration(curr.time)}</div>
                <div class="stat-label">Gesamtzeit</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(curr.ele)}</div>
                <div class="stat-label">Höhenmeter ${!isAll ? delta(curr.ele, prev.ele) : ""}</div>
            </div>
        </div>
        <h3>${chartTitle}</h3>
        <div class="chart-box"><canvas id="monthly-chart"></canvas></div>
        <h3>Monatsübersicht</h3>
        <div class="month-table-wrap">
            <table class="month-table" id="month-overview-table"></table>
        </div>
        <h3>${isAll ? "Letzte Aktivitäten" : "Aktivitäten " + year}</h3>
        <div class="activity-list">${recent.map(activityCard).join("") || "<p>Keine Aktivitäten.</p>"}</div>
    `;

    const activeSports = sports.filter(s => chartBySport[s].some(v => v > 0));
    mkChart("monthly-chart", {
        type: "bar",
        data: {
            labels: chartLabels,
            datasets: activeSports.map(sport => ({
                label: SPORT_NAMES[sport],
                data: chartBySport[sport],
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

    // --- Monatsübersicht table ---
    const tbl = document.getElementById("month-overview-table");
    if (tbl) {
        const sports = ["running", "cycling", "hiking", "other"];
        if (isAll) {
            const sortedYears = [...years].sort((a, b) => a - b);
            const rows = sortedYears.map(y => {
                const acts = allActivities.filter(a => getYear(a) === y);
                if (!acts.length) return null;
                const s = computeStats(acts);
                const bySport = sports.filter(sp => acts.some(a => a.sport_type === sp))
                    .map(sp => `<span style="color:${SPORT_COLORS[sp]}">${SPORT_ICONS[sp]} ${(acts.filter(a=>a.sport_type===sp).reduce((s,a)=>s+a.distance_m/1000,0)).toFixed(0)} km</span>`)
                    .join(" ");
                return `<tr><td><strong>${y}</strong></td><td>${s.count}</td><td>${s.km.toFixed(1)}</td><td>${fmtDuration(s.time)}</td><td>${Math.round(s.ele)}</td><td class="sport-breakdown">${bySport}</td></tr>`;
            }).filter(Boolean);
            tbl.innerHTML = `<thead><tr><th>Jahr</th><th>Akt.</th><th>km</th><th>Zeit</th><th>Hm</th><th>Sportart</th></tr></thead><tbody>${rows.join("")}</tbody>`;
        } else {
            const rows = MONTHS.map((m, i) => {
                const acts = allActivities.filter(a => getYear(a) === year && getMonth(a) === i);
                if (!acts.length) return null;
                const s = computeStats(acts);
                const bySport = sports.filter(sp => acts.some(a => a.sport_type === sp))
                    .map(sp => `<span style="color:${SPORT_COLORS[sp]}">${SPORT_ICONS[sp]} ${(acts.filter(a=>a.sport_type===sp).reduce((s,a)=>s+a.distance_m/1000,0)).toFixed(0)} km</span>`)
                    .join(" ");
                return `<tr><td><strong>${m}</strong></td><td>${s.count}</td><td>${s.km.toFixed(1)}</td><td>${fmtDuration(s.time)}</td><td>${Math.round(s.ele)}</td><td class="sport-breakdown">${bySport}</td></tr>`;
            }).filter(Boolean);
            tbl.innerHTML = `<thead><tr><th>Monat</th><th>Akt.</th><th>km</th><th>Zeit</th><th>Hm</th><th>Sportart</th></tr></thead><tbody>${rows.join("")}</tbody>`;
        }
    }

    document.querySelectorAll(".year-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            const v = btn.dataset.year;
            renderDashboard(v === "all" ? "all" : parseInt(v), years);
        });
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
        <div class="page-header">
            <h2>Aktivitäten (${filtered.length})</h2>
            <div style="display:flex;gap:.5rem;">
                <button id="export-csv-btn" class="btn-secondary">↓ CSV</button>
                <button id="upload-btn" class="btn-secondary">↑ GPX hochladen</button>
            </div>
        </div>
        <div id="upload-section" class="upload-section hidden">
            <form id="upload-form">
                <input type="file" id="gpx-file" accept=".gpx,.json" multiple required>
                <select id="upload-sport">
                    <option value="">Sportart auto-erkennen</option>
                    <option value="running">🏃 Laufen</option>
                    <option value="cycling">🚴 Radfahren</option>
                    <option value="hiking">🥾 Wandern</option>
                    <option value="other">🏅 Sonstige</option>
                </select>
                <button type="submit" class="btn-primary">Hochladen</button>
                <span id="upload-msg" class="upload-msg"></span>
            </form>
            <div id="upload-errors" class="upload-errors hidden"></div>
        </div>
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

    document.getElementById("export-csv-btn").addEventListener("click", () => exportCsv(filtered));
    document.getElementById("upload-btn").addEventListener("click", () => {
        document.getElementById("upload-section").classList.toggle("hidden");
    });
    document.getElementById("upload-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const files = [...document.getElementById("gpx-file").files];
        if (!files.length) return;
        const sport   = document.getElementById("upload-sport").value;
        const msg     = document.getElementById("upload-msg");
        const errDiv  = document.getElementById("upload-errors");
        msg.style.color = "";
        errDiv.innerHTML = "";
        errDiv.classList.add("hidden");

        let ok = 0, fail = 0;
        const errors = [];

        for (const file of files) {
            msg.textContent = `${ok + fail + 1} / ${files.length} wird hochgeladen…`;
            const isJson = file.name.toLowerCase().endsWith(".json");
            const endpoint = isJson ? "/activities/upload-json" : "/activities/upload";
            const fd = new FormData();
            fd.append("file", file);
            if (sport) fd.append("sport_type", sport);
            try {
                const res = await fetch(API + endpoint, { method: "POST", body: fd });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    const detail = err.detail ?? "Fehler";
                    const friendly = res.status === 409
                        ? "bereits importiert (doppelte Startzeit)"
                        : res.status === 422
                            ? `ungültige Datei – ${detail}`
                            : detail;
                    errors.push(`${file.name}: ${friendly}`);
                    fail++;
                } else {
                    allActivities.unshift(await res.json());
                    ok++;
                }
            } catch {
                errors.push(`${file.name}: Netzwerkfehler`);
                fail++;
            }
        }

        if (fail === 0) {
            document.getElementById("upload-section").classList.add("hidden");
            renderActivities("all", "all", "date");
        } else {
            msg.style.color = fail === files.length ? "var(--error)" : "";
            msg.textContent = `${ok} hochgeladen, ${fail} fehlgeschlagen`;
            errDiv.innerHTML = errors.map(e => `<div class="upload-error-item">${escapeHtml(e)}</div>`).join("");
            errDiv.classList.remove("hidden");
            if (ok > 0) renderActivities("all", "all", "date");
        }
    });

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

    const prTableHtml = (rows) => `
        <div class="pr-table-wrap">
            <table class="pr-table">
                <thead><tr><th>Distanz</th><th>Bestzeit</th><th>Pace</th><th>Datum</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    const prRows = (standard) => standard.map(pr => {
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

    const recordCards = (records) => {
        const { longest, most_elevation, fastest_pace } = records;
        return `<div class="pr-records">
            ${longest        ? recordCard("Längste Strecke",   (longest.distance_m/1000).toFixed(2)+" km",          fmtDate(longest.start_time),       longest.id)        : ""}
            ${most_elevation ? recordCard("Meiste Höhenmeter", Math.round(most_elevation.elevation_gain_m)+" Hm",    fmtDate(most_elevation.start_time), most_elevation.id) : ""}
            ${fastest_pace   ? recordCard("Schnellste Ø Pace", fmtPace(fastest_pace.avg_pace)+" /km",               fmtDate(fastest_pace.start_time),   fastest_pace.id)   : ""}
        </div>`;
    };

    const { season } = data;
    const seasonHtml = season ? `
        <div class="season-divider">
            <h3>🗓 Saisonrekorde ${season.year}</h3>
            <p class="pr-hint">Nur Aktivitäten aus ${season.year}.</p>
            ${prTableHtml(prRows(season.standard))}
            ${recordCards(season.records)}
        </div>` : "";

    content.innerHTML = `
        <h2>Bestzeiten</h2>
        <h3>🏃 Laufen – Allzeit-Bestzeiten</h3>
        ${prTableHtml(prRows(data.standard))}
        <p class="pr-hint" style="margin-bottom:1rem">Schnellstes Segment via Sliding Window über alle Aktivitäten.</p>
        <h3>🏆 Allzeit-Rekorde</h3>
        ${recordCards(data.records)}
        ${seasonHtml}
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
                <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                    <select id="sport-type-select">${sportOptions}</select>
                    <button class="btn-secondary" id="back-btn">← Zurück</button>
                    <button class="btn-delete" id="delete-btn" title="Aktivität löschen">🗑</button>
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
            <div class="notes-section">
                <h3>Notiz <span id="notes-status" class="notes-status"></span></h3>
                <textarea id="notes-input" class="notes-input" placeholder="Notiz hinzufügen…" rows="3">${escapeHtml(activity.notes || "")}</textarea>
            </div>
        `;

        document.getElementById("back-btn").addEventListener("click", loadActivities);
        document.getElementById("delete-btn").addEventListener("click", async () => {
            if (!confirm("Aktivität wirklich löschen?")) return;
            try {
                await request("DELETE", `/activities/${id}`);
                allActivities = allActivities.filter(a => a.id !== id);
                loadActivities();
            } catch (e) {
                alert("Fehler beim Löschen: " + e.message);
            }
        });
        document.getElementById("sport-type-select").addEventListener("change", async (e) => {
            await request("PATCH", `/activities/${id}`, { sport_type: e.target.value });
        });

        let _noteTimer;
        document.getElementById("notes-input").addEventListener("input", () => {
            clearTimeout(_noteTimer);
            const statusEl = document.getElementById("notes-status");
            statusEl.textContent = "…";
            statusEl.className = "notes-status";
            _noteTimer = setTimeout(async () => {
                const notes = document.getElementById("notes-input")?.value ?? "";
                try {
                    await request("PATCH", `/activities/${id}`, { notes });
                    const act = allActivities.find(a => a.id === id);
                    if (act) act.notes = notes;
                    statusEl.textContent = "✓ gespeichert";
                    statusEl.className = "notes-status notes-status--ok";
                    setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 2000);
                } catch {
                    statusEl.textContent = "Fehler";
                    statusEl.className = "notes-status notes-status--err";
                }
            }, 800);
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

document.getElementById("nav-toggle").addEventListener("click", () => {
    document.querySelector(".nav-links").classList.toggle("open");
});

document.getElementById("theme-toggle").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("iris-theme", next);
    document.getElementById("theme-toggle").textContent = next === "dark" ? "☀️" : "🌙";
    applyChartTheme();
    destroyCharts();
});

document.querySelectorAll("nav a[data-view]").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelector(".nav-links").classList.remove("open");
        if (link.dataset.view === "dashboard")       loadDashboard();
        else if (link.dataset.view === "activities") loadActivities();
        else if (link.dataset.view === "prs")        loadPRs();
        else if (link.dataset.view === "map")        loadMapOverview();
        else if (link.dataset.view === "form")       loadForm();
        else if (link.dataset.view === "settings")   loadSettings();
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

// --- Form page ---
async function loadForm() {
    destroyCharts();
    const content = document.getElementById("content");
    content.innerHTML = `<h2>Trainingsform</h2><p class="muted">Berechne…</p>`;
    await new Promise(r => setTimeout(r, 0));

    if (!currentUser.max_hr && !currentUser.birth_year) {
        content.innerHTML = `<h2>Trainingsform</h2>
            <p class="muted">Bitte zuerst <strong>Maximalpuls</strong> oder <strong>Geburtsjahr</strong> in den Einstellungen hinterlegen.</p>`;
        return;
    }

    const series       = calcFitnessSeries(allActivities, currentUser, 180);
    const last         = series[series.length - 1] || { atl: 0, ctl: 0, tsb: 0 };
    const vo2max       = calcVo2max(allActivities);
    const weekly       = calcWeeklyTrimp(allActivities, currentUser, 20);
    const zoneDist     = calcZoneDistForm(allActivities, currentUser, 90);
    const { monotony, strain } = calcMonotony(allActivities, currentUser, 28);

    const RACE_DISTS = [
        {label:"1 km",km:1},{label:"3 km",km:3},{label:"5 km",km:5},
        {label:"10 km",km:10},{label:"Halbmarathon",km:21.095},{label:"Marathon",km:42.195},
    ];
    const predictions = RACE_DISTS.map(d => ({
        ...d, time_s: predictRaceTime(vo2max, d.km)
    }));

    // TSB status
    const tsb = last.tsb;
    const [tsbLabel, tsbClass, tsbColor] =
        tsb > 25  ? ["Overtapered",     "tsb-neutral",  "#9ca3af"] :
        tsb > 5   ? ["Wettkampfform ✓", "tsb-optimal",  "#2e7d32"] :
        tsb > -5  ? ["Erhaltung",        "tsb-neutral",  "#f59e0b"] :
        tsb > -25 ? ["Aufbauphase",      "tsb-build",    "#ea580c"] :
                    ["Überbelastung ⚠",  "tsb-over",     "var(--error)"];

    // Days until TSB reaches +5 (full rest projection)
    let daysToForm = null;
    if (tsb < 5) {
        let sAtl = last.atl, sCkl = last.ctl;
        const ka = 1 - Math.exp(-1/7), kc = 1 - Math.exp(-1/42);
        for (let d = 1; d <= 60; d++) {
            sAtl += (0 - sAtl) * ka; sCkl += (0 - sCkl) * kc;
            if (sCkl - sAtl >= 5) { daysToForm = d; break; }
        }
    }

    const predRows = predictions.map(p => {
        if (!p.time_s) return "";
        const pace = (p.time_s / 60) / p.km;
        return `<tr><td>${p.label}</td><td><strong>${fmtSeconds(p.time_s)}</strong></td><td>${fmtPace(pace)} /km</td></tr>`;
    }).join("");

    content.innerHTML = `
        <h2>Trainingsform</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${Math.round(last.ctl)}</div>
                <div class="stat-label">CTL – Fitness</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(last.atl)}</div>
                <div class="stat-label">ATL – Ermüdung</div>
            </div>
            <div class="stat-card">
                <div class="stat-value ${tsbClass}" style="color:${tsbColor}">${Math.round(tsb)}</div>
                <div class="stat-label">TSB – Form</div>
            </div>
            ${vo2max ? `<div class="stat-card">
                <div class="stat-value">${vo2max}</div>
                <div class="stat-label">VO₂max (ml/kg/min)</div>
            </div>` : ""}
        </div>

        <div class="form-status-bar" style="border-left-color:${tsbColor}">
            <strong style="color:${tsbColor}">${tsbLabel}</strong>
            ${tsb > 5 && tsb <= 25 ? " · Guter Zeitpunkt für einen Wettkampf." : ""}
            ${daysToForm ? ` · Bei vollständiger Regeneration in ca. <strong>${daysToForm} Tagen</strong> in Wettkampfform.` : ""}
        </div>

        <div class="form-grid-2">
            <div>
                <h3>CTL / ATL / TSB – Verlauf (180 Tage)</h3>
                <div class="chart-box"><canvas id="chart-fitness"></canvas></div>
            </div>
            <div>
                <h3>Wöchentlicher TRIMP (20 Wochen)</h3>
                <div class="chart-box"><canvas id="chart-weekly-trimp"></canvas></div>
            </div>
        </div>

        ${vo2max ? `
        <h3>Rennprognosen · VO₂max ${vo2max} ml/kg/min</h3>
        <div class="pr-table-wrap">
            <table class="pr-table">
                <thead><tr><th>Distanz</th><th>Prognose</th><th>Pace</th></tr></thead>
                <tbody>${predRows}</tbody>
            </table>
        </div>
        <p class="pr-hint" style="margin-bottom:1.5rem">Berechnet nach Jack Daniels (VDOT). Basiert auf der besten VO₂max-Schätzung der letzten 180 Tage.</p>
        ` : `<p class="muted" style="margin:1rem 0">Für Rennprognosen werden Laufaktivitäten mit Pace-Daten benötigt.</p>`}

        <div class="form-grid-2">
            <div>
                <h3>HR-Zonenverteilung (letzte 90 Tage)</h3>
                <div class="chart-box chart-box--zones"><canvas id="chart-form-zones"></canvas></div>
            </div>
            <div>
                <h3>Trainingsmonotonie (28 Tage)</h3>
                <div class="form-monotony">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value ${monotony > 1.5 ? "text-warn" : ""}">${monotony}</div>
                            <div class="stat-label">Monotonie-Index</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${strain}</div>
                            <div class="stat-label">Strain</div>
                        </div>
                    </div>
                    <p class="form-hint">
                        <strong>Monotonie</strong> = Ø TRIMP/Tag ÷ Standardabweichung.<br>
                        &lt; 1,0 gute Variation · 1,0–1,5 akzeptabel · &gt; 1,5 zu monoton.<br>
                        <strong>Strain</strong> = Wochen-TRIMP × Monotonie.
                    </p>
                </div>
            </div>
        </div>
    `;

    // Fitness chart
    const downsample = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0 || i === arr.length - 1);
    const ds = downsample(series, 180);
    mkChart("chart-fitness", {
        type: "line",
        data: {
            labels: ds.map(d => d.date),
            datasets: [
                { label: "CTL Fitness",  data: ds.map(d => Math.round(d.ctl)), borderColor: "#4f8ef7", backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: "ATL Ermüdung", data: ds.map(d => Math.round(d.atl)), borderColor: "#e06666", backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.3 },
                { label: "TSB Form",     data: ds.map(d => Math.round(d.tsb)), borderColor: "#93c47d", backgroundColor: "rgba(147,196,125,0.15)", borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true },
            ],
        },
        options: {
            responsive: true,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top" }, tooltip: { callbacks: {
                title: items => items[0].label,
            }}},
            scales: {
                x: { ticks: { maxTicksLimit: 8 } },
                y: { title: { display: true, text: "Trainingslast" } },
            },
        },
    });

    // Weekly TRIMP chart
    mkChart("chart-weekly-trimp", {
        type: "bar",
        data: {
            labels: weekly.map(w => w.label),
            datasets: [{ label: "TRIMP", data: weekly.map(w => w.trimp), backgroundColor: "#4f8ef7", borderRadius: 3 }],
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxTicksLimit: 10 } },
                y: { title: { display: true, text: "TRIMP" }, beginAtZero: true },
            },
        },
    });

    // Zone donut (reuse existing HR zone colors)
    const zoneColors = ["#93c47d","#6fa8dc","#ffd966","#e06666","#cc0000"];
    const zoneLabels = ["Z1 Regeneration","Z2 Grundlage","Z3 Tempo","Z4 Schwelle","Z5 Maximal"];
    const zoneTotal  = zoneDist.reduce((a, b) => a + b, 0);
    if (zoneTotal > 0) {
        mkChart("chart-form-zones", {
            type: "doughnut",
            data: {
                labels: zoneLabels,
                datasets: [{ data: zoneDist, backgroundColor: zoneColors, borderWidth: 1 }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: "right" },
                    tooltip: { callbacks: { label: ctx => {
                        const s = ctx.raw;
                        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
                        return ` ${ctx.label}: ${h}h ${m}min (${Math.round(s/zoneTotal*100)}%)`;
                    }}},
                },
            },
        });
    } else {
        document.getElementById("chart-form-zones")?.closest(".chart-box")?.insertAdjacentHTML("afterend", "<p class='muted'>Keine HR-Daten in den letzten 90 Tagen.</p>");
    }
}

// --- Settings ---
function loadSettings() {
    destroyCharts();
    const content = document.getElementById("content");
    const u  = currentUser;
    const cz = u.hr_zones ?? [];
    const zv = i => cz[i] ?? "";

    const adminHtml = u.is_admin ? `
        <h3>Benutzerverwaltung</h3>
        <div id="user-list"><p class="muted">Lade…</p></div>
        <div class="settings-form" style="margin-top:1rem">
            <div class="settings-section-title">Neuen Benutzer anlegen</div>
            <div class="zones-grid">
                <label class="settings-label">Name<input type="text" id="new-name" placeholder="Max Mustermann"></label>
                <label class="settings-label">E-Mail<input type="email" id="new-email" placeholder="max@example.com"></label>
                <label class="settings-label">Passwort<input type="password" id="new-password"></label>
            </div>
            <label class="settings-label" style="flex-direction:row;align-items:center;gap:.5rem;font-weight:400">
                <input type="checkbox" id="new-is-admin"> Admin-Rechte
            </label>
            <button id="create-user-btn" class="btn-primary">Anlegen</button>
            <span id="create-user-msg" class="settings-msg hidden"></span>
        </div>` : "";

    content.innerHTML = `
        <h2>Einstellungen</h2>

        <h3>Profil</h3>
        <div class="settings-form">
            <label class="settings-label">Name<input type="text" id="profile-name" value="${u.name ?? ""}"></label>
            <div class="zones-grid">
                <label class="settings-label">Geburtsjahr<input type="number" id="profile-birth" min="1900" max="2025" value="${u.birth_year ?? ""}" placeholder="z.B. 1990"></label>
                <label class="settings-label">Gewicht (kg)<input type="number" id="profile-weight" min="30" max="250" step="0.1" value="${u.weight_kg ?? ""}" placeholder="z.B. 70"></label>
                <label class="settings-label">Ruhepuls (bpm)<input type="number" id="profile-resting-hr" min="30" max="100" value="${u.resting_hr ?? ""}" placeholder="z.B. 55"></label>
                <label class="settings-label">Geschlecht
                    <select id="profile-gender">
                        <option value="male"${(u.gender ?? "male") === "male" ? " selected" : ""}>Männlich</option>
                        <option value="female"${u.gender === "female" ? " selected" : ""}>Weiblich</option>
                    </select>
                </label>
            </div>
            <p class="settings-hint">Ruhepuls und Geschlecht werden für die TRIMP-Berechnung auf der Form-Seite verwendet.</p>
            <button id="save-profile-btn" class="btn-primary">Profil speichern</button>
            <span id="profile-msg" class="settings-msg hidden">✓ Gespeichert</span>
        </div>

        <h3>Passwort ändern</h3>
        <div class="settings-form">
            <label class="settings-label">Neues Passwort<input type="password" id="new-pw" placeholder="Mindestens 4 Zeichen"></label>
            <button id="save-pw-btn" class="btn-primary">Passwort ändern</button>
            <span id="pw-msg" class="settings-msg hidden">✓ Geändert</span>
        </div>

        <h3>Maximalpuls &amp; HR-Zonen</h3>
        <div class="settings-form">
            <label class="settings-label">Maximalpuls (bpm)
                <input type="number" id="max-hr-input" min="100" max="250" value="${u.max_hr ?? ""}" placeholder="z.B. 190">
            </label>
            <div class="settings-section-title">Manuelle Zonengrenzen (bpm)
                <button id="calc-zones-btn" class="btn-secondary" style="margin-left:.5rem">Aus Maximalpuls berechnen</button>
            </div>
            <div class="zones-grid">
                <label class="settings-label">Z1/Z2<input type="number" class="zone-input" data-z="0" min="80" max="240" value="${zv(0)}" placeholder="z.B. 120"></label>
                <label class="settings-label">Z2/Z3<input type="number" class="zone-input" data-z="1" min="80" max="240" value="${zv(1)}" placeholder="z.B. 140"></label>
                <label class="settings-label">Z3/Z4<input type="number" class="zone-input" data-z="2" min="80" max="240" value="${zv(2)}" placeholder="z.B. 160"></label>
                <label class="settings-label">Z4/Z5<input type="number" class="zone-input" data-z="3" min="80" max="240" value="${zv(3)}" placeholder="z.B. 175"></label>
            </div>
            <p class="settings-hint">Leer lassen → automatische Berechnung aus Maximalpuls (%).</p>
            <button id="save-settings-btn" class="btn-primary">HR-Einstellungen speichern</button>
            <span id="settings-msg" class="settings-msg hidden">✓ Gespeichert</span>
        </div>

        ${adminHtml}
    `;

    const flash = (id, text = "✓ Gespeichert", isError = false) => {
        const el = document.getElementById(id);
        el.textContent = text;
        el.style.color = isError ? "var(--error)" : "";
        el.classList.remove("hidden");
        if (!isError) setTimeout(() => el.classList.add("hidden"), 2500);
    };

    document.getElementById("save-profile-btn").addEventListener("click", async () => {
        const name = document.getElementById("profile-name").value.trim();
        if (!name) return;
        const resting_hr = parseInt(document.getElementById("profile-resting-hr").value) || null;
        const gender     = document.getElementById("profile-gender").value;
        await request("PATCH", "/users/me", {
            name,
            birth_year: parseInt(document.getElementById("profile-birth").value) || null,
            weight_kg:  parseFloat(document.getElementById("profile-weight").value) || null,
            resting_hr,
            gender,
        });
        currentUser.name       = name;
        currentUser.resting_hr = resting_hr;
        currentUser.gender     = gender;
        document.getElementById("nav-user").textContent = name;
        flash("profile-msg");
    });

    document.getElementById("save-pw-btn").addEventListener("click", async () => {
        const pw = document.getElementById("new-pw").value;
        if (!pw || pw.length < 4) return;
        await request("PATCH", "/users/me", { password: pw });
        document.getElementById("new-pw").value = "";
        flash("pw-msg", "✓ Geändert");
    });

    document.getElementById("calc-zones-btn").addEventListener("click", () => {
        const mhr = parseInt(document.getElementById("max-hr-input").value);
        if (!mhr) return;
        [0.60, 0.70, 0.80, 0.90].forEach((p, i) => {
            document.querySelector(`.zone-input[data-z="${i}"]`).value = Math.round(mhr * p);
        });
    });

    document.getElementById("save-settings-btn").addEventListener("click", async () => {
        const mhr  = parseInt(document.getElementById("max-hr-input").value) || null;
        const vals = [...document.querySelectorAll(".zone-input")].map(inp => parseInt(inp.value) || null);
        const zones = vals.every(v => v !== null) ? vals : null;
        await request("PATCH", "/users/me", { max_hr: mhr, hr_zones: zones });
        currentUser.max_hr = mhr;
        currentUser.hr_zones = zones;
        flash("settings-msg");
    });

    if (u.is_admin) {
        loadUserList();
        document.getElementById("create-user-btn").addEventListener("click", async () => {
            const name     = document.getElementById("new-name").value.trim();
            const email    = document.getElementById("new-email").value.trim();
            const password = document.getElementById("new-password").value;
            const isAdmin  = document.getElementById("new-is-admin").checked;
            if (!name || !email || !password) return;
            try {
                await request("POST", "/users/", { name, email, password, is_admin: isAdmin });
                ["new-name","new-email","new-password"].forEach(id => document.getElementById(id).value = "");
                document.getElementById("new-is-admin").checked = false;
                flash("create-user-msg", "✓ Benutzer angelegt");
                loadUserList();
            } catch (err) {
                flash("create-user-msg", err.message, true);
            }
        });
    }
}

async function loadUserList() {
    const el = document.getElementById("user-list");
    if (!el) return;
    const users = await request("GET", "/users/");
    el.innerHTML = `<table class="pr-table">
        <thead><tr><th>Name</th><th>E-Mail</th><th>Admin</th><th></th></tr></thead>
        <tbody>${users.map(u => `<tr>
            <td>${u.name}</td><td>${u.email}</td>
            <td>${u.is_admin ? "✓" : ""}</td>
            <td>${u.id !== currentUser.id
                ? `<button class="btn-secondary del-user" data-id="${u.id}">Löschen</button>`
                : ""}</td>
        </tr>`).join("")}</tbody>
    </table>`;
    el.querySelectorAll(".del-user").forEach(btn => {
        btn.addEventListener("click", async () => {
            if (!confirm("Benutzer wirklich löschen? Alle Aktivitäten werden ebenfalls gelöscht.")) return;
            await request("DELETE", `/users/${btn.dataset.id}`);
            loadUserList();
        });
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

initTheme();
init();

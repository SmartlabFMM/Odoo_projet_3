/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUnmount, onWillUpdateProps, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { loadJS } from "@web/core/assets";

const VITALS = [
    { key: "heart_rate",        label: "Heart Rate",       unit: "bpm" },
    { key: "pulse",             label: "Pulse",            unit: "bpm" },
    { key: "oxygen_saturation", label: "O₂ Saturation",    unit: "%" },
    { key: "respiratory_rate",  label: "Respiratory Rate", unit: "/min" },
    { key: "temperature",       label: "Temperature",      unit: "°C" },
];

const SESSION_COLORS = [
    "54,162,235",
    "255,99,132",
    "75,192,192",
    "255,159,64",
    "153,102,255",
    "255,205,86",
];

const FIELDS = [
    "measurement_date", "heart_rate", "pulse",
    "oxygen_saturation", "respiratory_rate", "temperature", "stream_session_id",
];

// How often to poll for new measurements while the patient is live.
const POLL_INTERVAL_MS = 3000;

// How often to re-check the patient's stream_running flag to auto-start/stop polling.
const STATUS_CHECK_INTERVAL_MS = 5000;

function groupBySessions(records) {
    const map = new Map();
    for (const m of records) {
        const sid = m.stream_session_id || "__untracked__";
        if (!map.has(sid)) map.set(sid, []);
        map.get(sid).push(m);
    }

    const sessions = Array.from(map.entries()).map(([sid, recs], chronoIdx) => {
        const sorted = [...recs].sort(
            (a, b) => new Date(a.measurement_date) - new Date(b.measurement_date)
        );
        const first = new Date(sorted[0].measurement_date);
        const last  = new Date(sorted[sorted.length - 1].measurement_date);
        const fmt   = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const date  = first.toLocaleDateString([], { month: "short", day: "numeric" });
        return {
            session_id: sid,
            index:      chronoIdx,
            color:      SESSION_COLORS[chronoIdx % SESSION_COLORS.length],
            label:      `${date}  ${fmt(first)} – ${fmt(last)}`,
            records:    sorted,
        };
    });

    // Reverse so newest session appears first.
    return sessions.reverse();
}

function resolveId(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw[0] || null;
    if (typeof raw === "object") return raw.id || null;
    return raw;
}

class VitalsChartWidget extends Component {
    static template = "health_monitoring.VitalsChartWidget";
    static props = ["*"];

    setup() {
        this.orm    = useService("orm");
        this.vitals = VITALS;
        this.state  = useState({
            sessions: [],
            loaded:   false,
            isLive:   false,   // true when the linked patient's stream is running
        });

        // Internal — not reactive, not exposed to the template.
        this._charts          = {};
        this._allRecords      = [];
        this._lastFetchTime   = null;
        this._pollTimer       = null;
        this._statusTimer     = null;
        this._medicalRecordId = null;
        this._patientId       = null;

        onMounted(async () => {
            await loadJS(
                "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
            );
            this._resolveIds(this.props);
            await this._loadAllMeasurements();
            this._startStatusChecker();
        });

        // Called with the *next* props before they are applied.
        onWillUpdateProps(async (nextProps) => {
            this._stopPolling();
            this._stopStatusChecker();
            this._destroyCharts();
            this._resolveIds(nextProps);
            await this._loadAllMeasurements();
            this._startStatusChecker();
        });

        onWillUnmount(() => {
            this._stopPolling();
            this._stopStatusChecker();
            this._destroyCharts();
        });
    }

    // ─── ID helpers ───────────────────────────────────────────────────────────

    _resolveIds(props) {
        this._medicalRecordId = resolveId(props.record?.resId ?? props.record?.data?.id);
        this._patientId       = resolveId(props.record?.data?.patient_id);
    }

    // ─── Patient status checker ───────────────────────────────────────────────
    //
    // Reads patient.stream_running every STATUS_CHECK_INTERVAL_MS and starts or
    // stops the measurement poll accordingly.  No manual toggle is needed.

    _startStatusChecker() {
        this._stopStatusChecker();
        // Fire immediately so there is no initial delay.
        this._checkAndSyncPolling();
        this._statusTimer = setInterval(
            () => this._checkAndSyncPolling(),
            STATUS_CHECK_INTERVAL_MS
        );
    }

    _stopStatusChecker() {
        if (this._statusTimer) {
            clearInterval(this._statusTimer);
            this._statusTimer = null;
        }
    }

    async _checkAndSyncPolling() {
        if (!this._patientId) {
            this._stopPolling();
            return;
        }
        try {
            const results = await this.orm.read(
                "patient.monitoring.patient",
                [this._patientId],
                ["stream_running"]
            );
            const isLive = results.length ? !!results[0].stream_running : false;

            if (isLive && !this._pollTimer) {
                this._startPolling();
            } else if (!isLive && this._pollTimer) {
                this._stopPolling();
            }
        } catch (_) {
            // Silently ignore transient errors; will retry on the next tick.
        }
    }

    // ─── Measurement poll controls ────────────────────────────────────────────

    _startPolling() {
        this._stopPolling();
        this.state.isLive = true;
        this._pollTimer   = setInterval(
            () => this._pollNewMeasurements(),
            POLL_INTERVAL_MS
        );
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this.state.isLive = false;
    }

    // ─── Initial / full load ──────────────────────────────────────────────────

    async _loadAllMeasurements() {
        // Reset everything before a fresh load.
        this._allRecords    = [];
        this._lastFetchTime = null;
        this.state.sessions = [];
        this.state.loaded   = false;

        if (!this._medicalRecordId) {
            this.state.loaded = true;
            return;
        }

        // Primary: measurements linked to this medical record.
        let rows = await this.orm.searchRead(
            "patient.monitoring.measurement",
            [["medical_record_id", "=", this._medicalRecordId]],
            FIELDS,
            { order: "measurement_date asc" }
        );

        // Fallback: unlinked measurements for the same patient.
        if (!rows.length && this._patientId) {
            rows = await this.orm.searchRead(
                "patient.monitoring.measurement",
                [
                    ["patient_id",        "=", this._patientId],
                    ["medical_record_id", "=", false],
                ],
                FIELDS,
                { order: "measurement_date asc" }
            );
        }

        this._allRecords = rows;

        // Anchor timestamp: incremental polls only fetch rows newer than this.
        this._lastFetchTime = rows.length
            ? rows[rows.length - 1].measurement_date
            : new Date().toISOString().replace("T", " ").slice(0, 19);

        this.state.sessions = groupBySessions(this._allRecords);
        this.state.loaded   = true;

        // Wait one tick for OWL to render the canvases, then draw charts.
        // Polling is started (if needed) by _startStatusChecker() after this resolves.
        setTimeout(() => this._buildCharts(), 50);
    }

    // ─── Incremental poll ─────────────────────────────────────────────────────

    async _pollNewMeasurements() {
        if (!this._medicalRecordId) return;

        const domain = [["medical_record_id", "=", this._medicalRecordId]];
        if (this._lastFetchTime) {
            domain.push(["measurement_date", ">", this._lastFetchTime]);
        }

        let newRows;
        try {
            newRows = await this.orm.searchRead(
                "patient.monitoring.measurement",
                domain,
                FIELDS,
                { order: "measurement_date asc" }
            );
        } catch (_) {
            // Silently swallow transient network errors; the timer will retry.
            return;
        }

        if (!newRows.length) return;

        // Advance the anchor timestamp.
        this._lastFetchTime = newRows[newRows.length - 1].measurement_date;
        this._allRecords    = [...this._allRecords, ...newRows];

        // If new rows introduce a session we've never seen, rebuild fully so
        // OWL renders the new session card + canvases, then redraw all charts.
        const existingIds   = new Set(this.state.sessions.map((s) => s.session_id));
        const hasNewSession = newRows.some(
            (r) => !existingIds.has(r.stream_session_id || "__untracked__")
        );

        if (hasNewSession) {
            this.state.sessions = groupBySessions(this._allRecords);
            setTimeout(() => this._buildCharts(), 50);
        } else {
            // Fast path: push new points directly into existing Chart.js instances —
            // no DOM change, no flicker on historical sessions.
            this._appendDataToCharts(newRows);
        }
    }

    // Append new data points to already-rendered Chart.js instances.
    _appendDataToCharts(newRows) {
        for (const session of this.state.sessions) {
            const sessionRows = newRows.filter(
                (r) => (r.stream_session_id || "__untracked__") === session.session_id
            );
            if (!sessionRows.length) continue;

            for (const vital of VITALS) {
                const chartKey = `${session.index}-${vital.key}`;
                const chart    = this._charts[chartKey];
                if (!chart) continue;

                let updated = false;
                for (const m of sessionRows) {
                    if (m[vital.key] > 0) {
                        chart.data.datasets[0].data.push({
                            x: new Date(m.measurement_date).toLocaleTimeString([], {
                                hour: "2-digit", minute: "2-digit", second: "2-digit",
                            }),
                            y: m[vital.key],
                        });
                        updated = true;
                    }
                }
                // "none" skips animations for a smoother real-time feel.
                if (updated) chart.update("none");
            }
        }
    }

    // ─── Chart rendering ──────────────────────────────────────────────────────

    _destroyCharts() {
        for (const chart of Object.values(this._charts)) chart.destroy();
        this._charts = {};
    }

    _buildCharts() {
        if (typeof Chart === "undefined" || !this.state.sessions.length) return;

        for (const session of this.state.sessions) {
            for (const vital of VITALS) {
                const canvasId = `vchart-${session.index}-${vital.key}`;
                const canvas   = document.getElementById(canvasId);
                if (!canvas) continue;

                const data = session.records
                    .filter((m) => m[vital.key] > 0)
                    .map((m) => ({
                        x: new Date(m.measurement_date).toLocaleTimeString([], {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                        }),
                        y: m[vital.key],
                    }));

                if (!data.length) continue;

                const chartKey = `${session.index}-${vital.key}`;
                if (this._charts[chartKey]) this._charts[chartKey].destroy();

                const c = session.color;
                this._charts[chartKey] = new Chart(canvas, {
                    type: "line",
                    data: {
                        datasets: [{
                            label:            `${vital.label} (${vital.unit})`,
                            data,
                            borderColor:      `rgb(${c})`,
                            backgroundColor:  `rgba(${c}, 0.08)`,
                            borderWidth:      2,
                            tension:          0.35,
                            fill:             true,
                            pointRadius:      3,
                            pointHoverRadius: 5,
                        }],
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            title: {
                                display: true,
                                text:    `${vital.label} (${vital.unit})`,
                                font:    { size: 12, weight: "600" },
                                color:   "#444",
                                padding: { bottom: 6 },
                            },
                        },
                        scales: {
                            x: {
                                type:  "category",
                                ticks: { maxRotation: 45, maxTicksLimit: 8, font: { size: 10 } },
                            },
                            y: {
                                beginAtZero: false,
                                ticks:       { font: { size: 10 } },
                            },
                        },
                    },
                });
            }
        }
    }
}

registry.category("fields").add("vitals_chart", { component: VitalsChartWidget });
/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUnmount, useState } from "@odoo/owl";
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
    "oxygen_saturation", "respiratory_rate", "temperature",
    "stream_session_id", "patient_id", "has_anomaly",
];

const POLL_INTERVAL_MS = 5000;

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
        const first     = new Date(sorted[0].measurement_date);
        const last      = new Date(sorted[sorted.length - 1].measurement_date);
        const fmt       = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const date      = first.toLocaleDateString([], { month: "short", day: "numeric" });
        const anomalies = sorted.filter((m) => m.has_anomaly).length;
        return {
            session_id: sid,
            index:      chronoIdx,
            color:      SESSION_COLORS[chronoIdx % SESSION_COLORS.length],
            label:      `${date}  ${fmt(first)} – ${fmt(last)}`,
            count:      sorted.length,
            anomalies,
            records:    sorted,
        };
    });

    return sessions.reverse();
}

class MeasurementsSessionView extends Component {
    static template = "health_monitoring.MeasurementsSessionView";
    static props    = { action: { optional: true } };

    setup() {
        this.orm    = useService("orm");
        this.vitals = VITALS;

        const context = this.props.action?.context || {};

        const rawPid      = context.patient_id;
        const resolvedPid = Array.isArray(rawPid)
            ? rawPid[0]
            : (rawPid && typeof rawPid === "object" ? rawPid.id : rawPid) || null;

        this.state = useState({
            patients:          [],
            selectedPatientId: resolvedPid ? parseInt(resolvedPid) : null,
            patientLocked:     !!resolvedPid,
            sessions:          [],
            loaded:            false,
            patientsLoaded:    false,
            isLive:            false,
        });

        this._charts       = {};
        this._allRecords   = [];
        this._lastFetchTime = null;
        this._pollTimer    = null;

        onMounted(async () => {
            await loadJS(
                "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
            );
            await this._loadPatients();
            await this._loadMeasurements();
        });

        onWillUnmount(() => {
            this._stopPolling();
            this._destroyCharts();
        });
    }

    _startPolling() {
        this._stopPolling();
        this.state.isLive = true;
        this._pollTimer   = setInterval(() => this._pollNewMeasurements(), POLL_INTERVAL_MS);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this.state.isLive = false;
    }

    toggleLive() {
        if (this.state.isLive) {
            this._stopPolling();
        } else {
            this._startPolling();
        }
    }

    async _loadPatients() {
        const patients = await this.orm.searchRead(
            "patient.monitoring.patient",
            [],
            ["id", "name"],
            { order: "name asc" }
        );
        this.state.patients       = patients;
        this.state.patientsLoaded = true;
    }

    async _loadMeasurements() {
        this._stopPolling();
        this._destroyCharts();
        this.state.loaded   = false;
        this.state.sessions = [];
        this._allRecords    = [];

        const domain = this.state.selectedPatientId
            ? [["patient_id", "=", this.state.selectedPatientId]]
            : [];

        const rows = await this.orm.searchRead(
            "patient.monitoring.measurement",
            domain,
            FIELDS,
            { order: "measurement_date asc" }
        );

        this._allRecords    = rows;
        this._lastFetchTime = rows.length
            ? rows[rows.length - 1].measurement_date
            : new Date().toISOString().replace("T", " ").slice(0, 19);

        this.state.sessions = groupBySessions(this._allRecords);
        this.state.loaded   = true;

        setTimeout(() => {
            this._buildCharts();
            this._startPolling();
        }, 50);
    }

    async _pollNewMeasurements() {
        const domain = [];
        if (this.state.selectedPatientId) {
            domain.push(["patient_id", "=", this.state.selectedPatientId]);
        }
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
            return;
        }

        if (!newRows.length) return;

        this._lastFetchTime = newRows[newRows.length - 1].measurement_date;
        this._allRecords    = [...this._allRecords, ...newRows];

        const existingIds  = new Set(this.state.sessions.map((s) => s.session_id));
        const hasNewSession = newRows.some((r) => {
            const sid = r.stream_session_id || "__untracked__";
            return !existingIds.has(sid);
        });

        if (hasNewSession) {
            this.state.sessions = groupBySessions(this._allRecords);
            setTimeout(() => this._buildCharts(), 50);
        } else {
            this._appendDataToCharts(newRows);
        }
    }

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
                if (updated) chart.update("none");
            }
        }
    }

    async onPatientChange(ev) {
        const val = ev.target.value;
        this.state.selectedPatientId = val ? parseInt(val) : null;
        await this._loadMeasurements();
    }

    _destroyCharts() {
        for (const chart of Object.values(this._charts)) {
            try { chart.destroy(); } catch (_) {}
        }
        this._charts = {};
    }

    _buildCharts() {
        if (typeof Chart === "undefined" || !this.state.sessions.length) return;

        for (const session of this.state.sessions) {
            for (const vital of VITALS) {
                const canvasId = `mschart-${session.index}-${vital.key}`;
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

registry.category("actions").add(
    "health_monitoring.measurements_session_view",
    MeasurementsSessionView
);
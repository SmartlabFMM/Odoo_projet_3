/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onMounted, onWillUpdateProps, useState } from "@odoo/owl";
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

function groupBySessions(records) {
    const map = new Map();
    for (const m of records) {
        const sid = m.stream_session_id || "__untracked__";
        if (!map.has(sid)) map.set(sid, []);
        map.get(sid).push(m);
    }

    // FIX: Assign `index` in chronological order FIRST (oldest session → index 0,
    // so index + 1 equals the true session number in the template).
    // Then reverse the array so the newest session is rendered at the top of the UI.
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
            index:      chronoIdx,                                        // chronological (0 = oldest = Session 1)
            color:      SESSION_COLORS[chronoIdx % SESSION_COLORS.length],
            label:      `${date}  ${fmt(first)} – ${fmt(last)}`,
            records:    sorted,
        };
    });

    // Reverse for display only — newest session appears first on screen,
    // but index values (and therefore session numbers) remain chronological.
    return sessions.reverse();
}

class VitalsChartWidget extends Component {
    static template = "health_monitoring.VitalsChartWidget";
    static props = ["*"];

    setup() {
        this.orm    = useService("orm");
        this.vitals = VITALS;
        this.state  = useState({ sessions: [], loaded: false });
        this._charts = {};

        onMounted(async () => {
            await loadJS(
                "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
            );
            await this._fetchAndRender();
        });

        onWillUpdateProps(async () => {
            this._destroyCharts();
            await this._fetchAndRender();
        });
    }

    async _fetchAndRender() {
        await this._fetchMeasurements();
        setTimeout(() => this._buildCharts(), 50);
    }

    async _fetchMeasurements() {
        // resId is the reliable record ID in Odoo 17 field widget context.
        // data.id is kept as a secondary fallback for older OWL versions.
        const medicalRecordId =
            this.props.record?.resId ||
            this.props.record?.data?.id ||
            null;

        if (!medicalRecordId) {
            this.state.loaded = true;
            return;
        }

        // Primary query: measurements properly linked to this medical record
        let rows = await this.orm.searchRead(
            "patient.monitoring.measurement",
            [["medical_record_id", "=", medicalRecordId]],
            FIELDS,
            { order: "measurement_date asc" }
        );

        // Fallback: if the controller was missing sudo() before this fix was applied,
        // existing measurements will have medical_record_id = False.
        // In that case, fetch by patient_id so the charts still render.
        if (!rows.length) {
            const raw       = this.props.record?.data?.patient_id;
            const patientId = Array.isArray(raw) ? raw[0] : (raw || null);

            if (patientId) {
                rows = await this.orm.searchRead(
                    "patient.monitoring.measurement",
                    [
                        ["patient_id", "=", patientId],
                        ["medical_record_id", "=", false],
                    ],
                    FIELDS,
                    { order: "measurement_date asc" }
                );
            }
        }

        this.state.sessions = groupBySessions(rows);
        this.state.loaded   = true;
    }

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
                            label:           `${vital.label} (${vital.unit})`,
                            data,
                            borderColor:     `rgb(${c})`,
                            backgroundColor: `rgba(${c}, 0.08)`,
                            borderWidth:     2,
                            tension:         0.35,
                            fill:            true,
                            pointRadius:     3,
                            pointHoverRadius: 5,
                        }],
                    },
                    options: {
                        responsive:          true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            title: {
                                display:  true,
                                text:     `${vital.label} (${vital.unit})`,
                                font:     { size: 12, weight: "600" },
                                color:    "#444",
                                padding:  { bottom: 6 },
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
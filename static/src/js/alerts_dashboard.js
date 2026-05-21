/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

const PAGE_SIZE = 12;

class AlertsDashboard extends Component {
    static template = "health_monitoring.AlertsDashboard";
    static props = {
        action: { optional: true },
    };

    setup() {
        this.actionService = useService("action");
        this.orm           = useService("orm");
        this.dialogService = useService("dialog");

        const ctx          = this.props.action?.context ?? {};
        this.patientId     = ctx.patient_id   || null;
        this.patientName   = ctx.patient_name || null;
        this.isFiltered    = Boolean(this.patientId);

        this.state = useState({
            alerts:         [],
            loaded:         false,
            searchQuery:    "",
            currentPage:    1,
            pageSize:       PAGE_SIZE,
            activeFilter:   "all",   // all | pending | acknowledged | resolved
            activeSeverity: "all",   // all | critical | high | medium | low
            selectedIds:    new Set(),
        });

        onMounted(() => this._loadAlerts());
    }

    // ── Data ───────────────────────────────────────────────────────────────────

    async _loadAlerts() {
        try {
            const domain = this.isFiltered
                ? [["patient_id", "=", this.patientId]]
                : [];

            const alerts = await this.orm.searchRead(
                "patient.monitoring.alert",
                domain,
                [
                    "name", "patient_id", "alert_type", "severity",
                    "description", "state", "alert_status",
                    "alert_date", "handled_by_id", "notified_staff_ids",
                    "acknowledged_date", "resolved_date",
                ],
                { order: "alert_date desc" }
            );

            Object.assign(this.state, {
                alerts,
                loaded:      true,
                selectedIds: new Set(),
            });
        } catch (e) {
            console.error("AlertsDashboard._loadAlerts failed:", e);
            this.state.loaded = true;
        }
    }

    // ── Stats ──────────────────────────────────────────────────────────────────

    get totalCount() {
        return this.state.alerts.length;
    }

    get pendingCount() {
        return this.state.alerts.filter(a => a.state === "pending").length;
    }

    get criticalHighCount() {
        return this.state.alerts.filter(
            a => ["critical", "high"].includes(a.severity) && a.state !== "resolved"
        ).length;
    }

    get resolvedCount() {
        return this.state.alerts.filter(a => a.state === "resolved").length;
    }

    get currentCount() {
        return this.state.alerts.filter(a => a.alert_status === "current").length;
    }

    // ── Filtering & Pagination ─────────────────────────────────────────────────

    get filteredAlerts() {
        let list = this.state.alerts;

        if (this.state.activeFilter !== "all") {
            list = list.filter(a => a.state === this.state.activeFilter);
        }

        if (this.state.activeSeverity !== "all") {
            list = list.filter(a => a.severity === this.state.activeSeverity);
        }

        const q = this.state.searchQuery.toLowerCase().trim();
        if (q) {
            list = list.filter(a =>
                a.name.toLowerCase().includes(q) ||
                (a.patient_id   && a.patient_id[1].toLowerCase().includes(q))    ||
                (a.description  && a.description.toLowerCase().includes(q))       ||
                (a.alert_type   && this.typeLabel(a.alert_type).toLowerCase().includes(q))
            );
        }

        return list;
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredAlerts.length / this.state.pageSize));
    }

    get pagedAlerts() {
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        return this.filteredAlerts.slice(start, start + this.state.pageSize);
    }

    get paginationFrom() {
        if (this.filteredAlerts.length === 0) return 0;
        return (this.state.currentPage - 1) * this.state.pageSize + 1;
    }

    get paginationTo() {
        return Math.min(
            this.state.currentPage * this.state.pageSize,
            this.filteredAlerts.length
        );
    }

    get hasPrev() { return this.state.currentPage > 1; }
    get hasNext()  { return this.state.currentPage < this.totalPages; }

    // ── UI Event Handlers ──────────────────────────────────────────────────────

    onSearch(ev) {
        this.state.searchQuery = ev.target.value;
        this.state.currentPage = 1;
        this.state.selectedIds = new Set();
    }

    clearSearch() {
        this.state.searchQuery = "";
        this.state.currentPage = 1;
        this.state.selectedIds = new Set();
    }

    setFilter(filter) {
        this.state.activeFilter = filter;
        this.state.currentPage  = 1;
        this.state.selectedIds  = new Set();
    }

    setSeverity(severity) {
        this.state.activeSeverity = severity;
        this.state.currentPage    = 1;
        this.state.selectedIds    = new Set();
    }

    prevPage() { if (this.hasPrev) this.state.currentPage--; }
    nextPage()  { if (this.hasNext)  this.state.currentPage++; }

    toggleSelect(id) {
        const next = new Set(this.state.selectedIds);
        if (next.has(id)) next.delete(id);
        else              next.add(id);
        this.state.selectedIds = next;
    }

    clearSelection() {
        this.state.selectedIds = new Set();
    }

    // ── Inline Record Actions ──────────────────────────────────────────────────

    async acknowledgeAlert(id, ev) {
        ev.stopPropagation();
        try {
            await this.orm.call("patient.monitoring.alert", "action_acknowledge", [[id]]);
            await this._loadAlerts();
        } catch (e) {
            console.error("AlertsDashboard.acknowledgeAlert failed:", e);
        }
    }

    async resolveAlert(id, ev) {
        ev.stopPropagation();
        try {
            await this.orm.call("patient.monitoring.alert", "action_resolve", [[id]]);
            await this._loadAlerts();
        } catch (e) {
            console.error("AlertsDashboard.resolveAlert failed:", e);
        }
    }

    deleteSelected() {
        const ids = [...this.state.selectedIds];
        if (!ids.length) return;

        const count = ids.length;
        const label = count === 1 ? "1 alert" : `${count} alerts`;

        this.dialogService.add(ConfirmationDialog, {
            title:        "Delete Alerts",
            body:         `You are about to permanently delete ${label}. This action cannot be undone.`,
            confirmLabel: "Delete",
            cancelLabel:  "Cancel",
            confirm: async () => {
                try {
                    await this.orm.unlink("patient.monitoring.alert", ids);
                } catch (e) {
                    console.error("AlertsDashboard.deleteSelected failed:", e);
                    return;
                }

                await this._loadAlerts();

                if (this.state.currentPage > this.totalPages) {
                    this.state.currentPage = this.totalPages;
                }
            },
            cancel: () => {},
        });
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    openAlert(id) {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.alert",
            res_id:    id,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    newAlert() {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.alert",
            views:     [[false, "form"]],
            target:    "current",
            context:   this.isFiltered
                ? { default_patient_id: this.patientId }
                : {},
        });
    }

    backToPatient() {
        if (!this.patientId) return;
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.patient",
            res_id:    this.patientId,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    // ── Formatters ─────────────────────────────────────────────────────────────

    fmtIdx(localIndex) {
        const globalIndex = (this.state.currentPage - 1) * this.state.pageSize + localIndex;
        return String(globalIndex + 1).padStart(2, "0");
    }

    fmtDate(dt) {
        if (!dt) return "—";
        const d      = new Date(dt.replace(" ", "T"));
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    fmtTime(dt) {
        if (!dt) return "";
        const d = new Date(dt.replace(" ", "T"));
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    typeLabel(key) {
        const map = {
            anomaly:     "Anomaly",
            critical:    "Critical Condition",
            medication:  "Medication",
            appointment: "Appointment",
            manual:      "Manual",
        };
        return map[key] || key || "—";
    }

    severityLabel(key) {
        const map = {
            low:      "Low",
            medium:   "Medium",
            high:     "High",
            critical: "Critical",
        };
        return map[key] || key || "—";
    }

    stateLabel(key) {
        const map = {
            pending:      "Pending",
            acknowledged: "Acknowledged",
            resolved:     "Resolved",
        };
        return map[key] || key || "—";
    }

    severityClass(severity) {
        const map = {
            critical: "hm_alert--critical",
            high:     "hm_alert--high",
            medium:   "hm_alert--medium",
            low:      "hm_alert--low",
        };
        return map[severity] || "";
    }

    stateTagClass(state) {
        const map = {
            pending:      "hm_tag--pending",
            acknowledged: "hm_tag--ack",
            resolved:     "hm_tag--ok",
        };
        return map[state] || "hm_tag--off";
    }

    buildDesc(alert) {
        const parts = [];
        if (alert.patient_id)    parts.push(alert.patient_id[1]);
        if (alert.alert_date)    parts.push(this.fmtDate(alert.alert_date));
        if (alert.handled_by_id) parts.push(`Handled by ${alert.handled_by_id[1]}`);
        return parts.join(" · ") || "—";
    }
}

registry.category("actions").add(
    "health_monitoring.alerts_dashboard",
    AlertsDashboard
);
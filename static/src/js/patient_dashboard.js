/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

const PAGE_SIZE = 10;

class PatientDashboard extends Component {
    static template = "health_monitoring.PatientDashboard";
    static props = {
        action: { optional: true },
    };

    setup() {
        this.actionService = useService("action");
        this.orm           = useService("orm");
        this.dialogService = useService("dialog");

        const ctx        = this.props.action?.context ?? {};
        this.staffId     = ctx.staff_id   || null;
        this.staffName   = ctx.staff_name || null;
        this.isFiltered  = Boolean(this.staffId);

        this.state = useState({
            patients:    [],
            totalCount:  0,
            liveCount:   0,
            loaded:      false,
            searchQuery: "",
            currentPage: 1,
            pageSize:    PAGE_SIZE,
            selectedIds: new Set(),
        });

        onMounted(() => this._loadPatients());
    }

    async _loadPatients() {
        try {
            const domain = this.isFiltered
                ? [["assigned_staff_id", "=", this.staffId]]
                : [];

            const patients = await this.orm.searchRead(
                "patient.monitoring.patient",
                domain,
                [
                    "name", "first_name", "last_name", "patient_ref",
                    "age", "sex", "assigned_staff_id",
                    "admission_date", "stream_running",
                ],
                { order: "admission_date desc" }
            );

            Object.assign(this.state, {
                patients,
                totalCount: patients.length,
                liveCount:  patients.filter(p => p.stream_running).length,
                loaded:     true,
                selectedIds: new Set(),
            });
        } catch (e) {
            console.error("PatientDashboard._loadPatients failed:", e);
            this.state.loaded = true;
        }
    }

    get filteredPatients() {
        const q = this.state.searchQuery.toLowerCase().trim();
        if (!q) return this.state.patients;
        return this.state.patients.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.patient_ref && p.patient_ref.toLowerCase().includes(q)) ||
            (p.assigned_staff_id && p.assigned_staff_id[1].toLowerCase().includes(q)) ||
            (p.sex && this.sexLabel(p.sex).toLowerCase().includes(q))
        );
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredPatients.length / this.state.pageSize));
    }

    get pagedPatients() {
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        return this.filteredPatients.slice(start, start + this.state.pageSize);
    }

    get paginationFrom() {
        if (this.filteredPatients.length === 0) return 0;
        return (this.state.currentPage - 1) * this.state.pageSize + 1;
    }

    get paginationTo() {
        return Math.min(
            this.state.currentPage * this.state.pageSize,
            this.filteredPatients.length
        );
    }

    get hasPrev() {
        return this.state.currentPage > 1;
    }

    get hasNext() {
        return this.state.currentPage < this.totalPages;
    }

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

    prevPage() {
        if (this.hasPrev) this.state.currentPage--;
    }

    nextPage() {
        if (this.hasNext) this.state.currentPage++;
    }

    toggleSelect(id) {
        const next = new Set(this.state.selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.state.selectedIds = next;
    }

    clearSelection() {
        this.state.selectedIds = new Set();
    }

    deleteSelected() {
        const ids = [...this.state.selectedIds];
        if (ids.length === 0) return;

        const count = ids.length;
        const label = count === 1 ? "1 patient record" : `${count} patient records`;

        this.dialogService.add(ConfirmationDialog, {
            title: "Delete Patients",
            body:  `You are about to permanently delete ${label}. This action cannot be undone.`,
            confirmLabel: "Delete",
            cancelLabel:  "Cancel",
            confirm: async () => {
                try {
                    await this.orm.unlink("patient.monitoring.patient", ids);
                } catch (e) {
                    console.error("PatientDashboard.deleteSelected failed:", e);
                    return;
                }

                await this._loadPatients();

                if (this.state.currentPage > this.totalPages) {
                    this.state.currentPage = this.totalPages;
                }
            },
            cancel: () => {},
        });
    }

    openPatient(id) {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.patient",
            res_id:    id,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    newPatient() {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.patient",
            views:     [[false, "form"]],
            target:    "current",
            context: this.isFiltered
                ? { default_assigned_staff_id: this.staffId }
                : {},
        });
    }

    backToStaff() {
        if (!this.staffId) return;
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.staff",
            res_id:    this.staffId,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    fmtIdx(localIndex) {
        const globalIndex = (this.state.currentPage - 1) * this.state.pageSize + localIndex;
        return String(globalIndex + 1).padStart(2, "0");
    }

    sexLabel(key) {
        const map = { male: "Male", female: "Female", other: "Other" };
        return map[key] || key || "—";
    }

    buildDesc(patient) {
        const parts = [];
        if (patient.age)               parts.push(`${patient.age} yrs`);
        if (patient.sex)               parts.push(this.sexLabel(patient.sex));
        if (patient.assigned_staff_id) parts.push(patient.assigned_staff_id[1]);
        if (patient.admission_date)    parts.push(`Admitted ${patient.admission_date}`);
        return parts.join(" · ") || "—";
    }
}

registry.category("actions").add(
    "health_monitoring.patient_dashboard",
    PatientDashboard
);
/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

const PAGE_SIZE = 10;

class MedicalRecordDashboard extends Component {
    static template = "health_monitoring.MedicalRecordDashboard";

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
            records:        [],
            totalCount:     0,
            confirmedCount: 0,
            archivedCount:  0,
            loaded:         false,
            searchQuery:    "",
            currentPage:    1,
            pageSize:       PAGE_SIZE,
            selectedIds:    new Set(),
        });

        onMounted(() => this._loadRecords());
    }

    async _loadRecords() {
        try {
            const domain = this.isFiltered
                ? [["patient_id", "=", this.patientId]]
                : [];

            const records = await this.orm.searchRead(
                "patient.monitoring.medical.record",
                domain,
                [
                    "name", "patient_id", "date",
                    "record_type", "drafting_staff_id", "state",
                ],
                { order: "date desc" }
            );

            Object.assign(this.state, {
                records,
                totalCount:     records.length,
                confirmedCount: records.filter(r => r.state === "confirmed").length,
                archivedCount:  records.filter(r => r.state === "archived").length,
                loaded:         true,
                selectedIds:    new Set(),
            });
        } catch (e) {
            console.error("MedicalRecordDashboard._loadRecords failed:", e);
            this.state.loaded = true;
        }
    }

    get filteredRecords() {
        const q = this.state.searchQuery.toLowerCase().trim();
        if (!q) return this.state.records;
        return this.state.records.filter(r =>
            r.name.toLowerCase().includes(q) ||
            (r.patient_id        && r.patient_id[1].toLowerCase().includes(q))        ||
            (r.drafting_staff_id && r.drafting_staff_id[1].toLowerCase().includes(q)) ||
            (r.record_type       && this.typeLabel(r.record_type).toLowerCase().includes(q)) ||
            (r.state             && this.stateLabel(r.state).toLowerCase().includes(q))
        );
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredRecords.length / this.state.pageSize));
    }

    get pagedRecords() {
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        return this.filteredRecords.slice(start, start + this.state.pageSize);
    }

    get paginationFrom() {
        if (this.filteredRecords.length === 0) return 0;
        return (this.state.currentPage - 1) * this.state.pageSize + 1;
    }

    get paginationTo() {
        return Math.min(
            this.state.currentPage * this.state.pageSize,
            this.filteredRecords.length
        );
    }

    get hasPrev() { return this.state.currentPage > 1; }
    get hasNext()  { return this.state.currentPage < this.totalPages; }

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

    deleteSelected() {
        const ids = [...this.state.selectedIds];
        if (!ids.length) return;

        const count = ids.length;
        const label = count === 1 ? "1 medical record" : `${count} medical records`;

        this.dialogService.add(ConfirmationDialog, {
            title:        "Delete Medical Records",
            body:         `You are about to permanently delete ${label}. This action cannot be undone.`,
            confirmLabel: "Delete",
            cancelLabel:  "Cancel",
            confirm: async () => {
                try {
                    await this.orm.unlink("patient.monitoring.medical.record", ids);
                } catch (e) {
                    console.error("MedicalRecordDashboard.deleteSelected failed:", e);
                    return;
                }

                await this._loadRecords();

                if (this.state.currentPage > this.totalPages) {
                    this.state.currentPage = this.totalPages;
                }
            },
            cancel: () => {},
        });
    }

    openRecord(id) {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.medical.record",
            res_id:    id,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    newRecord() {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.medical.record",
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

    fmtIdx(localIndex) {
        const globalIndex = (this.state.currentPage - 1) * this.state.pageSize + localIndex;
        return String(globalIndex + 1).padStart(2, "0");
    }

    fmtDate(dt) {
        if (!dt) return "—";
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const [datePart] = dt.split(" ");
        const [year, month, day] = datePart.split("-");
        return `${parseInt(day, 10)} ${months[parseInt(month, 10) - 1]} ${year}`;
    }

    typeLabel(key) {
        const map = {
            consultation: "Consultation",
            diagnosis:    "Diagnosis",
            treatment:    "Treatment",
            lab_result:   "Lab Result",
            prescription: "Prescription",
            surgery:      "Surgery",
            follow_up:    "Follow-up",
        };
        return map[key] || key || "—";
    }

    stateLabel(key) {
        const map = { draft: "Draft", confirmed: "Confirmed", archived: "Archived" };
        return map[key] || key || "—";
    }

    stateTagClass(state) {
        const map = {
            confirmed: "hm_tag--ok",
            draft:     "hm_tag--draft",
            archived:  "hm_tag--arc",
        };
        return map[state] || "hm_tag--off";
    }

    buildDesc(record) {
        const parts = [];
        if (record.date)              parts.push(this.fmtDate(record.date));
        if (record.drafting_staff_id) parts.push(record.drafting_staff_id[1]);
        return parts.join(" · ") || "—";
    }
}

registry.category("actions").add(
    "health_monitoring.medical_record_dashboard",
    MedicalRecordDashboard
);
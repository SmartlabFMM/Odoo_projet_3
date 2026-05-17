/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const PAGE_SIZE = 6;

class MedicalStaffDashboard extends Component {
    static template = "health_monitoring.MedicalStaffDashboard";
    static props = {};

    setup() {
        this.actionService = useService("action");
        this.orm           = useService("orm");

        this.state = useState({
            staff:         [],
            totalCount:    0,
            telegramCount: 0,
            loaded:        false,
            searchQuery:   "",
            currentPage:   1,
            pageSize:      PAGE_SIZE,
        });

        onMounted(() => this._loadStaff());
    }

    async _loadStaff() {
        try {
            const staff = await this.orm.searchRead(
                "patient.monitoring.staff",
                [["user_id", "!=", false]],
                [
                    "name", "user_id", "employee_id",
                    "specialization", "department",
                    "phone", "telegram_linked",
                ],
                { order: "name asc" }
            );

            Object.assign(this.state, {
                staff,
                totalCount:    staff.length,
                telegramCount: staff.filter(s => s.telegram_linked).length,
                loaded:        true,
            });
        } catch (e) {
            console.error("MedicalStaffDashboard._loadStaff failed:", e);
            this.state.loaded = true;
        }
    }

    get filteredStaff() {
        const q = this.state.searchQuery.toLowerCase().trim();
        if (!q) return this.state.staff;
        return this.state.staff.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.employee_id && s.employee_id.toLowerCase().includes(q)) ||
            (s.department   && s.department.toLowerCase().includes(q)) ||
            (s.specialization &&
                this.specLabel(s.specialization).toLowerCase().includes(q))
        );
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredStaff.length / this.state.pageSize));
    }

    get pagedStaff() {
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        return this.filteredStaff.slice(start, start + this.state.pageSize);
    }

    get paginationFrom() {
        if (this.filteredStaff.length === 0) return 0;
        return (this.state.currentPage - 1) * this.state.pageSize + 1;
    }

    get paginationTo() {
        return Math.min(
            this.state.currentPage * this.state.pageSize,
            this.filteredStaff.length
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
    }

    clearSearch() {
        this.state.searchQuery = "";
        this.state.currentPage = 1;
    }

    prevPage() {
        if (this.hasPrev) this.state.currentPage--;
    }

    nextPage() {
        if (this.hasNext) this.state.currentPage++;
    }

    goToPage(n) {
        const clamped = Math.max(1, Math.min(n, this.totalPages));
        this.state.currentPage = clamped;
    }

    openStaff(id) {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.staff",
            res_id:    id,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    fmtIdx(localIndex) {
        const globalIndex = (this.state.currentPage - 1) * this.state.pageSize + localIndex;
        return String(globalIndex + 1).padStart(2, "0");
    }

    specLabel(key) {
        const map = {
            doctor:     "Doctor",
            nurse:      "Nurse",
            technician: "Technician",
            admin:      "Admin",
        };
        return map[key] || key || "—";
    }

    userName(member) {
        return member.user_id ? member.user_id[1] : "—";
    }

    buildDesc(member) {
        const parts = [];
        if (member.department)  parts.push(member.department);
        if (member.phone)       parts.push(member.phone);
        if (member.employee_id) parts.push(member.employee_id);
        return parts.join(" · ") || "—";
    }
}

registry.category("actions").add(
    "health_monitoring.medical_staff_dashboard",
    MedicalStaffDashboard
);
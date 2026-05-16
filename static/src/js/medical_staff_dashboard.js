/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

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

    openStaff(id) {
        this.actionService.doAction({
            type:      "ir.actions.act_window",
            res_model: "patient.monitoring.staff",
            res_id:    id,
            views:     [[false, "form"]],
            target:    "current",
        });
    }

    fmtIdx(i) {
        return String(i + 1).padStart(2, "0");
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
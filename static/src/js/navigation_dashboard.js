/** @odoo-module **/

import { Component, onMounted, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

class NavigationDashboard extends Component {
    static template = "health_monitoring.NavigationDashboard";
    static props = {};

    setup() {
        this.actionService = useService("action");
        this.orm           = useService("orm");

        this.state = useState({
            patientCount: 0,
            staffCount:   0,
            liveCount:    0,
            loaded:       false,
        });

        onMounted(async () => {
            await this._loadCounts();
        });
    }

    async _loadCounts() {
        try {
            this.state.patientCount = await this.orm.searchCount(
                "patient.monitoring.patient", []
            );
        } catch (e) {
            console.error("[NavigationDashboard] patientCount failed:", e);
        }

        try {
            this.state.staffCount = await this.orm.searchCount(
                "patient.monitoring.staff", []
            );
        } catch (e) {
            console.error("[NavigationDashboard] staffCount failed:", e);
        }

        try {
            this.state.liveCount = await this.orm.searchCount(
                "patient.monitoring.patient", [["stream_running", "=", true]]
            );
        } catch (e) {
            console.error("[NavigationDashboard] liveCount failed:", e);
        }

        this.state.loaded = true;
    }

    navigateTo(xmlId) {
        this.actionService.doAction(xmlId);
    }

    openPatients() {
        this.navigateTo("health_monitoring.action_patient");
    }

    openMedicalStaff() {
        this.navigateTo("health_monitoring.action_medical_staff_overview");
    }

    openMedicalRecords() {
        this.navigateTo("health_monitoring.action_medical_records_client");
    }

    openReports() {
        this.navigateTo("health_monitoring.action_report_wizard");
    }
}

registry.category("actions").add(
    "health_monitoring.navigation_dashboard",
    NavigationDashboard
);
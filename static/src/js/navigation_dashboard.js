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
            try {
                const [patientCount, staffCount, liveCount] = await Promise.all([
                    this.orm.searchCount("patient.monitoring.patient", []),
                    this.orm.searchCount("patient.monitoring.staff",   [["active", "=", true]]),
                    this.orm.searchCount("patient.monitoring.patient", [["stream_running", "=", true]]),
                ]);
                Object.assign(this.state, { patientCount, staffCount, liveCount, loaded: true });
            } catch (_e) {
                this.state.loaded = true;
            }
        });
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
        this.navigateTo("health_monitoring.action_medical_record");
    }

    openReports() {
        this.navigateTo("health_monitoring.action_report_wizard");
    }
}

registry.category("actions").add(
    "health_monitoring.navigation_dashboard",
    NavigationDashboard
);
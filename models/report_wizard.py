from odoo import models, fields, api
import io
import base64
import logging
from datetime import datetime, time as dt_time

_logger = logging.getLogger(__name__)

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    _logger.warning(
        "[health_monitoring] matplotlib is not installed — charts will be omitted from PDF reports. "
        "Install it with: pip install matplotlib"
    )

VITAL_SIGNS = [
    ('heart_rate', 'Heart Rate (bpm)'),
    ('pulse', 'Pulse (bpm)'),
    ('temperature', 'Temperature (°C)'),
    ('oxygen_saturation', 'O2 Saturation (%)'),
    ('respiratory_rate', 'Respiratory Rate (/min)'),
    ('bmi', 'BMI'),
]

VITAL_COLORS = {
    'heart_rate': '#EF4444',
    'pulse': '#F97316',
    'temperature': '#8B5CF6',
    'oxygen_saturation': '#2563EB',
    'respiratory_rate': '#10B981',
    'bmi': '#6B7280',
}


class ReportGraphLine(models.TransientModel):
    _name = 'patient.monitoring.report.graph.line'
    _description = 'Report Graph Line'
    _order = 'sequence, id'

    wizard_id = fields.Many2one(
        'patient.monitoring.report.wizard',
        string='Wizard', ondelete='cascade', required=True
    )
    sequence = fields.Integer(default=10)
    vital_sign = fields.Selection(VITAL_SIGNS, string='Vital Sign', required=True)
    time_scope = fields.Selection([
        ('all_time', 'All Time'),
        ('date_range', 'Custom Range'),
    ], string='Time Scope', required=True, default='all_time')
    date_from = fields.Date(string='From')
    date_to = fields.Date(string='To')

    @api.onchange('time_scope')
    def _onchange_time_scope(self):
        if self.time_scope == 'all_time':
            self.date_from = False
            self.date_to = False


class ReportPatientMonitoring(models.AbstractModel):
    """
    Abstract report model — bridges the wizard and the QWeb template.
    Naming convention: report.<module>.<template_xmlid>
    """
    _name = 'report.health_monitoring.report_patient_monitoring'
    _description = 'Patient Monitoring PDF Report'

    def _get_report_values(self, docids, data=None):

        wizards = self.env['patient.monitoring.report.wizard'].browse(docids)
        return {
            'doc_ids': docids,
            'doc_model': 'patient.monitoring.report.wizard',
            'docs': wizards,
            'report_data': {wizard.id: wizard._build_report_data() for wizard in wizards},
        }


class PatientReportWizard(models.TransientModel):
    _name = 'patient.monitoring.report.wizard'
    _description = 'Patient Report Wizard'

    patient_id = fields.Many2one(
        'patient.monitoring.patient', string='Patient', required=True
    )
    medical_record_id = fields.Many2one(
        'patient.monitoring.medical.record',
        string='Medical Record',
        domain="[('patient_id', '=', patient_id)]",
        help="Select a specific medical record to include, or leave empty to include all records for this patient."
    )
    graph_line_ids = fields.One2many(
        'patient.monitoring.report.graph.line', 'wizard_id',
        string='Vital Sign Graphs'
    )

    @api.onchange('patient_id')
    def _onchange_patient_id(self):
        self.medical_record_id = False
        self.graph_line_ids = [(5,)]



    def _generate_chart(self, vital_sign, label, measurements):
        """
        Render a line chart for a single vital sign using matplotlib.
        Returns a base64-encoded PNG string, or None if matplotlib is
        unavailable or there are fewer than 2 data points.
        """
        if not HAS_MATPLOTLIB:
            return None

        pairs = [
            (m.measurement_date, float(getattr(m, vital_sign)))
            for m in measurements
            if getattr(m, vital_sign, None)
        ]
        if len(pairs) < 2:
            return None

        dates, values = zip(*pairs)
        color = VITAL_COLORS.get(vital_sign, '#2563EB')

        fig, ax = plt.subplots(figsize=(9, 3.0))

        ax.plot(
            dates, values,
            marker='o', markersize=3.5, linewidth=1.8,
            color=color, zorder=3
        )
        ax.fill_between(dates, values, alpha=0.08, color=color)

        record = self.medical_record_id
        if not record:
            record = self.env['patient.monitoring.medical.record'].search(
                [('patient_id', '=', self.patient_id.id)],
                order='date desc', limit=1
            )
        if record:
            min_field = f'min_{vital_sign}'
            max_field = f'max_{vital_sign}'
            min_val = getattr(record, min_field, None)
            max_val = getattr(record, max_field, None)
            if min_val:
                ax.axhline(
                    min_val, linestyle='--', linewidth=0.9,
                    color='#F97316', alpha=0.7, label=f'Min ({min_val})'
                )
            if max_val:
                ax.axhline(
                    max_val, linestyle='--', linewidth=0.9,
                    color='#EF4444', alpha=0.7, label=f'Max ({max_val})'
                )
            if min_val or max_val:
                ax.legend(fontsize=7, loc='upper right')

        ax.set_ylabel(label, fontsize=8)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=10))
        fig.autofmt_xdate(rotation=25, ha='right')
        ax.grid(True, linestyle='--', alpha=0.35, zorder=0)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        fig.tight_layout(pad=1.2)

        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=130, bbox_inches='tight')
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode()


    def _build_report_data(self):
        """
        Collect all data required by the QWeb template for one wizard record.
        Returns a plain dict — the template accesses it with dict-key notation
        via report_data[doc.id].
        """
        self.ensure_one()
        patient = self.patient_id

        if self.medical_record_id:
            med_records = self.medical_record_id
        else:
            med_records = self.env['patient.monitoring.medical.record'].search(
                [('patient_id', '=', patient.id)], order='date desc'
            )

        vital_map = dict(VITAL_SIGNS)
        charts = []

        for line in self.graph_line_ids:
            domain = [('patient_id', '=', patient.id)]

            if line.time_scope == 'date_range':
                if line.date_from:
                    domain.append((
                        'measurement_date', '>=',
                        datetime.combine(line.date_from, dt_time.min)
                    ))
                if line.date_to:
                    domain.append((
                        'measurement_date', '<=',
                        datetime.combine(line.date_to, dt_time.max)
                    ))

            measurements = self.env['patient.monitoring.measurement'].search(
                domain, order='measurement_date asc'
            )

            label = vital_map[line.vital_sign]

            if line.time_scope == 'all_time':
                scope_label = 'All Time'
            else:
                parts = []
                if line.date_from:
                    parts.append(f"From {line.date_from.strftime('%b %d, %Y')}")
                if line.date_to:
                    parts.append(f"To {line.date_to.strftime('%b %d, %Y')}")
                scope_label = '  ·  '.join(parts) or 'Custom Range'

            image_b64 = self._generate_chart(line.vital_sign, label, measurements)

            charts.append({
                'vital_sign': line.vital_sign,
                'label': label,
                'scope_label': scope_label,
                'image_b64': image_b64,
                'count': len(measurements),
            })

        return {
            'patient': patient,
            'med_records': med_records,
            'charts': charts,
        }


    def action_export_pdf(self):
        self.ensure_one()
        return self.env.ref(
            'health_monitoring.action_report_patient_monitoring'
        ).report_action(self)

    def action_print(self):
        return self.action_export_pdf()
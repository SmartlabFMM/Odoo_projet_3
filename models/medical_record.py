from odoo import models, fields, api


class MedicalRecord(models.Model):
    _name = 'patient.monitoring.medical.record'
    _description = 'Medical Record'
    _inherit = []
    _order = 'date desc'

    name = fields.Char(
        string='Record Reference', required=True, copy=False,
        default=lambda self: self.env['ir.sequence'].next_by_code('patient.monitoring.medical.record')
    )

    patient_id = fields.Many2one(
        'patient.monitoring.patient', string='Patient',
        required=True, ondelete='cascade'
    )

    date = fields.Datetime(string='Record Date', default=fields.Datetime.now, required=True)
    record_type = fields.Selection([
        ('consultation', 'Consultation'),
        ('diagnosis', 'Diagnosis'),
        ('treatment', 'Treatment'),
        ('lab_result', 'Lab Result'),
        ('prescription', 'Prescription'),
        ('surgery', 'Surgery'),
        ('follow_up', 'Follow-up'),
    ], string='Record Type', required=True, default='consultation')

    diagnosis = fields.Text(string='Diagnosis')
    treatment = fields.Text(string='Treatment Plan')
    prescriptions = fields.Text(string='Prescriptions')
    notes = fields.Text(string='Clinical Notes')

    drafting_staff_id = fields.Many2one(
        'patient.monitoring.staff',
        string='Drafting Staff',
        readonly=True,
        help='Automatically set to the staff account that created or last confirmed this record.',
        default=lambda self: self.env['patient.monitoring.staff'].search(
            [('user_id', '=', self.env.uid)], limit=1
        ),
    )

    measurement_ids = fields.One2many(
        'patient.monitoring.measurement', 'medical_record_id',
        string='Associated Measurements'
    )

    attachments = fields.Many2many(
        'ir.attachment', string='Attachments'
    )

    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('archived', 'Archived'),
    ], string='Status', default='draft')

    min_heart_rate = fields.Float(string='Min Heart Rate (bpm)')
    max_heart_rate = fields.Float(string='Max Heart Rate (bpm)')

    min_pulse = fields.Float(string='Min Pulse (bpm)')
    max_pulse = fields.Float(string='Max Pulse (bpm)')

    min_oxygen_saturation = fields.Float(string='Min O2 Saturation (%)')
    max_oxygen_saturation = fields.Float(string='Max O2 Saturation (%)')

    min_respiratory_rate = fields.Float(string='Min Respiratory Rate (/min)')
    max_respiratory_rate = fields.Float(string='Max Respiratory Rate (/min)')

    min_temperature = fields.Float(string='Min Temperature (°C)')
    max_temperature = fields.Float(string='Max Temperature (°C)')

    def action_confirm(self):
        confirming_staff = self.env['patient.monitoring.staff'].search(
            [('user_id', '=', self.env.uid)], limit=1
        )

        for record in self:
            others = self.search([
                ('patient_id', '=', record.patient_id.id),
                ('state',      '=', 'confirmed'),
                ('id',         '!=', record.id),
            ])
            if others:
                others.write({'state': 'archived'})

            vals = {'state': 'confirmed'}
            if confirming_staff:
                vals['drafting_staff_id'] = confirming_staff.id
            record.write(vals)

    def action_archive_record(self):
        self.write({'state': 'archived'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})

    def action_print_report(self):
        return self.env.ref(
            'health_monitoring.action_report_medical_record'
        ).report_action(self)
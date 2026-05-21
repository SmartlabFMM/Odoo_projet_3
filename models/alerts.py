from odoo import models, fields, api


class Alerts(models.Model):
    _name = 'patient.monitoring.alert'
    _description = 'Patient Alert'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'create_date desc'

    name = fields.Char(
        string='Alert Reference', required=True, copy=False,
        default=lambda self: self.env['ir.sequence'].next_by_code('patient.monitoring.alert')
    )

    measurement_id = fields.Many2one(
        'patient.monitoring.measurement', string='Triggered by Measurement',
        ondelete='set null'
    )

    patient_id = fields.Many2one(
        'patient.monitoring.patient', string='Patient',
        related='measurement_id.patient_id', store=True, readonly=True
    )

    alert_type = fields.Selection([
        ('anomaly', 'Anomaly Detected'),
        ('critical', 'Critical Condition'),
        ('medication', 'Medication Reminder'),
        ('appointment', 'Appointment'),
        ('manual', 'Manual Alert'),
    ], string='Alert Type', required=True, default='anomaly', tracking=True)

    severity = fields.Selection([
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ], string='Severity', required=True, default='medium', tracking=True)

    description = fields.Text(string='Alert Description', required=True)
    resolution_notes = fields.Text(string='Resolution Notes')

    state = fields.Selection([
        ('pending', 'Pending'),
        ('acknowledged', 'Acknowledged'),
        ('resolved', 'Resolved'),
    ], string='Status', default='pending', tracking=True)

    alert_status = fields.Selection([
        ('current', 'Current'),
        ('old', 'Old'),
    ], string='Alert Status', default='current', index=True, tracking=True,
       help=(
           "Current: the anomaly condition is still active (no clean "
           "measurement has arrived after the triggering measurement).\n"
           "Old: a subsequent normal measurement confirmed the condition "
           "has normalised."
       )
    )

    notified_staff_ids = fields.Many2many(
        'patient.monitoring.staff',
        'alert_staff_rel', 'alert_id', 'staff_id',
        string='Notified Staff'
    )
    handled_by_id = fields.Many2one(
        'patient.monitoring.staff', string='Handled By', tracking=True
    )

    alert_date = fields.Datetime(string='Alert Date', default=fields.Datetime.now)
    acknowledged_date = fields.Datetime(string='Acknowledged Date')
    resolved_date = fields.Datetime(string='Resolved Date')

    color = fields.Integer(string='Color Index', compute='_compute_color')

    @api.depends('severity', 'state')
    def _compute_color(self):
        color_map = {
            'critical': 1, 'high': 2, 'medium': 3, 'low': 4,
        }
        for rec in self:
            if rec.state == 'resolved':
                rec.color = 10
            else:
                rec.color = color_map.get(rec.severity, 0)

    def action_acknowledge(self):
        self.write({
            'state': 'acknowledged',
            'acknowledged_date': fields.Datetime.now(),
        })

    def action_resolve(self):
        staff = self._get_current_staff()
        vals = {
            'state': 'resolved',
            'resolved_date': fields.Datetime.now(),
        }
        if staff:
            vals['handled_by_id'] = staff.id
        self.write(vals)

    def mark_as_old(self):
        current = self.filtered(lambda a: a.alert_status == 'current')
        if current:
            current.write({'alert_status': 'old'})

    def _get_current_staff(self):
        return self.env['patient.monitoring.staff'].search(
            [('user_id', '=', self.env.uid)], limit=1
        )

    def _notify_medical_staff(self):
        self.ensure_one()
        staff_to_notify = self.env['patient.monitoring.staff']

        if self.patient_id and self.patient_id.assigned_staff_id:
            assigned_user = self.patient_id.assigned_staff_id
            staff_record = self.env['patient.monitoring.staff'].search(
                [('user_id', '=', assigned_user.id)], limit=1
            )
            if staff_record:
                staff_to_notify |= staff_record

        if staff_to_notify:
            self.notified_staff_ids = [(6, 0, staff_to_notify.ids)]
            self.message_post(
                body=f"Alert: {self.description}",
                message_type='notification',
                subtype_xmlid='mail.mt_note',
            )

    def action_send_alert(self):
        self._notify_medical_staff()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Alert Sent',
                'message': f'Alert {self.name} has been sent to medical staff.',
                'type': 'success',
            }
        }
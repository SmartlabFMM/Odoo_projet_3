from odoo import models, fields, api

class Alerts(models.Model):
    _name = 'patient.alerts'
    _description = 'Patient Alerts'
    
    timestamp = fields.Datetime(string='Timestamp', default=fields.Datetime.now)
    severity = fields.Char(string='Severity')
    message = fields.Text(string='Message')
    acknowledged = fields.Boolean(string='Acknowledged', default=False)
    acknowledged_at = fields.Datetime(string='Acknowledged At')
    
    # Relationships
    patient_id = fields.Many2one('patient.patient', string='Patient', required=True)
    measurement_id = fields.Many2one('patient.measurements', string='Triggered By Measurement')
    staff_id = fields.Many2one('medical.staff', string='Received By')
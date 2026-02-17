from odoo import models, fields, api

class Measurements(models.Model):
    _name = 'patient.measurements'
    _description = 'Patient Measurements'
    
    timestamp = fields.Datetime(string='Timestamp', default=fields.Datetime.now)
    value = fields.Float(string='Value', required=True)
    is_anomaly = fields.Boolean(string='Is Anomaly', default=False)
    logs = fields.Text(string='Logs')  # Using Text field to store string array as JSON or newline-separated
    
    # Relationships
    patient_id = fields.Many2one('patient.patient', string='Patient', required=True)
    vital_sign_id = fields.Many2one('patient.vital.sign', string='Vital Sign', required=True)
    alert_ids = fields.One2many('patient.alerts', 'measurement_id', string='Triggered Alerts')
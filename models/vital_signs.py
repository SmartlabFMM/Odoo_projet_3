from odoo import models, fields, api

class VitalSign(models.Model):
    _name = 'patient.vital.sign'
    _description = 'Vital Sign Types'
    
    type = fields.Char(string='Type', required=True)
    normal_min_range = fields.Float(string='Normal Minimum Range', required=True)
    normal_max_range = fields.Float(string='Normal Maximum Range', required=True)
    
    # Relationships
    measurement_ids = fields.One2many('patient.measurements', 'vital_sign_id', string='Measurements')
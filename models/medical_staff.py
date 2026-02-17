from odoo import models, fields, api

class MedicalStaff(models.Model):
    _name = 'medical.staff'
    _description = 'Medical Staff Information'
    
    first_name = fields.Char(string='First Name', required=True)
    last_name = fields.Char(string='Last Name', required=True)
    department = fields.Char(string='Department')
    phone_number = fields.Integer(string='Phone Number')
    email = fields.Char(string='Email')
    
    # Relationships
    alert_ids = fields.One2many('patient.alerts', 'staff_id', string='Received Alerts')
from odoo import models, fields, api
from odoo.exceptions import ValidationError
from datetime import date

class Patient(models.Model):
    _name = 'patient.patient'
    _description = 'Patient Information'
        
    medical_record_number = fields.Char(
        string='Medical Record Number', 
        required=True,
        copy=False
    )
    first_name = fields.Char(string='First Name', required=True)
    last_name = fields.Char(string='Last Name', required=True) 
    date_of_birth = fields.Date(string='Date of Birth', required=True)
    sex = fields.Selection([
        ('male', 'Male'),
        ('female', 'Female'),
    ], string='Sex', required=True)
    age = fields.Integer(string='Age', compute='_compute_age', store=True)
    phone_number = fields.Integer(string='Phone Number')
    address = fields.Text(string='Address')
    
    @api.depends('date_of_birth')
    def _compute_age(self):
        for record in self:
            if record.date_of_birth:
                today = date.today()
                birth_date = record.date_of_birth
                record.age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
            else:
                record.age = 0
    
    @api.constrains('date_of_birth')
    def _check_birth_date(self):
        for record in self:
            if record.date_of_birth and record.date_of_birth > date.today():
                raise ValidationError("The Date of Birth cannot be in the future!")
            
    # Relationships
    measurement_ids = fields.One2many('patient.measurements', 'patient_id', string='Measurements')
    alert_ids = fields.One2many('patient.alerts', 'patient_id', string='Alerts')
    
    _sql_constraints = [
        ('medical_record_number_unique', 
         'UNIQUE(medical_record_number)', 
         'Medical Record Number must be unique!')
    ]
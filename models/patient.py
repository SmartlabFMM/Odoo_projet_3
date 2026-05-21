from odoo import models, fields, api
from odoo.exceptions import UserError
import requests
import logging

_logger = logging.getLogger(__name__)


class Patient(models.Model):
    _name        = 'patient.monitoring.patient'
    _description = 'Patient'
    _inherit     = []
    _rec_name    = 'name'

    first_name = fields.Char(string='First Name', required=True)
    last_name  = fields.Char(string='Last Name',  required=True)
    name       = fields.Char(string='Full Name',  compute='_compute_name', store=True)

    patient_ref = fields.Char(
        string='Patient Reference', required=True, copy=False,
        default=lambda self: self.env['ir.sequence'].next_by_code('patient.monitoring.patient')
    )

    date_of_birth = fields.Date(string='Date of Birth', required=True)
    age           = fields.Integer(string='Age', compute='_compute_age', store=True)
    sex           = fields.Selection(
        [('male', 'Male'), ('female', 'Female')],
        string='Sex', required=True
    )

    phone_number      = fields.Char(string='Phone Number')
    email             = fields.Char(string='Email')
    address           = fields.Text(string='Address')
    emergency_contact = fields.Char(string='Emergency Contact')
    emergency_phone   = fields.Char(string='Emergency Phone')

    medical_record_ids = fields.One2many(
        'patient.monitoring.medical.record', 'patient_id', string='Medical Records'
    )
    medical_record_count = fields.Integer(compute='_compute_counts', string='Records')

    measurement_ids = fields.One2many(
        'patient.monitoring.measurement', 'patient_id', string='Measurements'
    )
    session_count = fields.Integer(compute='_compute_counts', string='Session Count')

    alert_ids = fields.One2many(
        'patient.monitoring.alert', 'patient_id', string='Alerts'
    )
    alert_count        = fields.Integer(compute='_compute_counts', string='Alert Count')
    active_alert_count = fields.Integer(compute='_compute_counts', string='Active Alerts')

    assigned_staff_id = fields.Many2one(
        'patient.monitoring.staff',
        
        string='Assigned Medical Staff',
        ondelete='set null',
    )

    admission_date = fields.Date(string='Admission Date', default=fields.Date.today)
    discharge_date = fields.Date(string='Discharge Date')
    notes          = fields.Text(string='Additional Notes')

    camera_url = fields.Char(
        string='Camera URL',
    )
    stream_running = fields.Boolean(
        string='Stream Running',
        default=False,
        copy=False,
    )
    has_consented = fields.Boolean(
        string='Patient Consent',
        default=False,
        copy=False,
    )

    monitoring_status = fields.Selection(
        [('live', 'Live'), ('offline', 'Offline')],
        string='Monitoring',
        compute='_compute_monitoring_status',
        store=False,
    )

    @api.depends('first_name', 'last_name')
    def _compute_name(self):
        for rec in self:
            rec.name = f"{rec.first_name or ''} {rec.last_name or ''}".strip()

    @api.depends('date_of_birth')
    def _compute_age(self):
        from datetime import date
        today = date.today()
        for rec in self:
            if rec.date_of_birth:
                rec.age = today.year - rec.date_of_birth.year - (
                    (today.month, today.day) <
                    (rec.date_of_birth.month, rec.date_of_birth.day)
                )
            else:
                rec.age = 0

    @api.depends('stream_running')
    def _compute_monitoring_status(self):
        for rec in self:
            rec.monitoring_status = 'live' if rec.stream_running else 'offline'

    @api.depends('medical_record_ids', 'measurement_ids', 'alert_ids')
    def _compute_counts(self):
        for rec in self:
            rec.medical_record_count = len(rec.medical_record_ids)
            session_ids = rec.measurement_ids.filtered(
                lambda m: m.stream_session_id
            ).mapped('stream_session_id')
            rec.session_count        = len(set(session_ids))
            rec.alert_count          = len(rec.alert_ids)
            rec.active_alert_count   = len(
                rec.alert_ids.filtered(lambda a: a.state == 'pending')
            )

    def _get_fastapi_url(self):
        url = self.env['ir.config_parameter'].sudo().get_param(
            'patient_monitoring.fastapi_url', 'http://localhost:8000'
        )
        return url.rstrip('/')

    def action_start_stream(self):
        self.ensure_one()
        if not self.has_consented:
            raise UserError(
                "This patient has not given consent for remote monitoring. "
                "Please check the 'Patient Consent' box on the patient form before starting the stream."
            )
        if not self.camera_url:
            raise UserError(
                "Please set a Camera URL for this patient before starting the stream."
            )
        if self.stream_running:
            raise UserError(f"Stream is already running for patient {self.patient_ref}.")

        base_url = self._get_fastapi_url()
        try:
            response = requests.post(
                f"{base_url}/stream/start",
                json={"patient_id": self.patient_ref, "camera_url": self.camera_url},
                timeout=10,
            )
            response.raise_for_status()
        except requests.exceptions.ConnectionError:
            raise UserError(
                f"Could not reach the FastAPI service at {base_url}.\n"
                "Check that it is running and that the URL in Settings → Technical → "
                "System Parameters (patient_monitoring.fastapi_url) is correct."
            )
        except requests.exceptions.HTTPError as e:
            detail = e.response.json().get('detail', str(e)) if e.response else str(e)
            raise UserError(f"FastAPI returned an error: {detail}")

        self.stream_running = True
        _logger.info("Stream started for patient %s", self.patient_ref)

        return {
            'type': 'ir.actions.client',
            'tag':  'display_notification',
            'params': {
                'title':   'Stream Started',
                'message': f'Camera stream is now live for {self.name}.',
                'type':    'success',
                'next':    {'type': 'ir.actions.client', 'tag': 'reload'},
            },
        }

    def action_stop_stream(self):
        self.ensure_one()
        if not self.stream_running:
            raise UserError(f"No active stream for patient {self.patient_ref}.")

        base_url = self._get_fastapi_url()
        try:
            response = requests.post(
                f"{base_url}/stream/stop/{self.patient_ref}",
                timeout=10,
            )
            if response.status_code == 400:
                _logger.warning(
                    "FastAPI reported no active session for %s — resetting stream flag.",
                    self.patient_ref,
                )
            else:
                response.raise_for_status()
        except requests.exceptions.ConnectionError:
            raise UserError(f"Could not reach the FastAPI service at {base_url}.")
        except requests.exceptions.HTTPError as e:
            detail = e.response.json().get('detail', str(e)) if e.response else str(e)
            raise UserError(f"FastAPI returned an error: {detail}")

        self.stream_running = False
        _logger.info("Stream stopped for patient %s", self.patient_ref)

        return {
            'type': 'ir.actions.client',
            'tag':  'display_notification',
            'params': {
                'title':   'Stream Stopped',
                'message': f'Camera stream stopped for {self.name}.',
                'type':    'warning',
                'next':    {'type': 'ir.actions.client', 'tag': 'reload'},
            },
        }

    def action_view_medical_records(self):
        self.ensure_one()
        return {
            'type':    'ir.actions.client',
            'tag':     'health_monitoring.medical_record_dashboard',
            'name':    f'Medical Records – {self.name}',
            'context': {
                'patient_id':          self.id,
                'patient_name':        self.name,
                'default_patient_id':  self.id,
            },
        }

    def action_view_measurements(self):
        self.ensure_one()
        return {
            'type':    'ir.actions.client',
            'tag':     'health_monitoring.measurements_session_view',
            'name':    f'Measurements – {self.name}',
            'context': {
                'patient_id':   self.id,
                'patient_name': self.name,
            },
        }

    def action_view_alerts(self):
        self.ensure_one()
        return {
            'type':      'ir.actions.act_window',
            'name':      'Alerts',
            'res_model': 'patient.monitoring.alert',
            'view_mode': 'list,form',
            'domain':    [('patient_id', '=', self.id)],
            'context':   {'default_patient_id': self.id},
        }
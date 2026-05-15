import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class PatientMonitoringController(http.Controller):

    @http.route(
        '/patient_monitoring/api/patient/<string:patient_ref>/thresholds',
        type='jsonrpc', auth='user', methods=['POST'],
    )
    def get_patient_thresholds(self, patient_ref, **kwargs):
        patient = request.env['patient.monitoring.patient'].sudo().search(
            [('patient_ref', '=', patient_ref)], limit=1
        )
        if not patient:
            return {'error': f'Patient {patient_ref} not found'}

        record = request.env['patient.monitoring.medical.record'].sudo().search(
            [('patient_id', '=', patient.id)],
            order='date desc', limit=1,
        )

        if not record:
            return {
                'patient_id':   patient.id,
                'patient_ref':  patient_ref,
                'patient_name': patient.name,
                'thresholds':   {},
            }

        return {
            'patient_id':   patient.id,
            'patient_ref':  patient_ref,
            'patient_name': patient.name,
            'thresholds': {
                'heart_rate':        {'min': record.min_heart_rate or None,        'max': record.max_heart_rate or None},
                'pulse':             {'min': record.min_pulse or None,             'max': record.max_pulse or None},
                'oxygen_saturation': {'min': record.min_oxygen_saturation or None, 'max': record.max_oxygen_saturation or None},
                'respiratory_rate':  {'min': record.min_respiratory_rate or None,  'max': record.max_respiratory_rate or None},
                'temperature':       {'min': record.min_temperature or None,       'max': record.max_temperature or None},
            },
        }

    @http.route(
        '/patient_monitoring/api/patient/<string:patient_ref>/measurement',
        type='jsonrpc', auth='user', methods=['POST'],
    )
    def post_patient_measurement(self, patient_ref, **kwargs):
        patient = request.env['patient.monitoring.patient'].sudo().search(
            [('patient_ref', '=', patient_ref)], limit=1
        )
        if not patient:
            return {'error': f'Patient {patient_ref} not found'}

        record = request.env['patient.monitoring.medical.record'].sudo().search(
            [('patient_id', '=', patient.id), ('state', '=', 'confirmed')],
            order='date desc', limit=1,
        )
        if not record:
            record = request.env['patient.monitoring.medical.record'].sudo().search(
                [('patient_id', '=', patient.id)],
                order='date desc', limit=1,
            )

        vitals            = kwargs.get('vitals', {})
        stream_session_id = kwargs.get('stream_session_id')

        def parse(val):
            if val is None:
                return 0.0
            try:
                return float(str(val).replace('/', '.'))
            except (ValueError, TypeError):
                return 0.0

        measurement = request.env['patient.monitoring.measurement'].sudo().create({
            'patient_id':        patient.id,
            'medical_record_id': record.id if record else False,
            'stream_session_id': stream_session_id,
            'heart_rate':        parse(vitals.get('heart_rate')),
            'pulse':             parse(vitals.get('pulse')),
            'oxygen_saturation': parse(vitals.get('oxygen_saturation')),
            'respiratory_rate':  parse(vitals.get('respiratory_rate')),
            'temperature':       parse(vitals.get('temperature')),
        })

        return {
            'success':         True,
            'measurement_id':  measurement.id,
            'measurement_ref': measurement.name,
            'has_anomaly':     measurement.has_anomaly,
            'anomaly_details': measurement.anomaly_details or '',
        }

    @http.route(
        '/patient_monitoring/api/patient/<string:patient_ref>/staff_contact',
        type='jsonrpc', auth='user', methods=['POST'],
    )
    def get_staff_contact(self, patient_ref, **kwargs):
        """
        Return the Telegram chat_id of the medical staff member assigned to a patient.

        The Patient model links to res.users via assigned_staff_id.
        The MedicalStaff model links to res.users via user_id.
        We bridge the two to reach the staff record and read telegram_chat_id.
        """
        patient = request.env['patient.monitoring.patient'].sudo().search(
            [('patient_ref', '=', patient_ref)], limit=1
        )
        if not patient:
            return {'error': f'Patient {patient_ref} not found'}

        if not patient.assigned_staff_id:
            _logger.info(
                '[PatientMonitoring] Patient %s has no assigned staff — '
                'Telegram alert will use global fallback.',
                patient_ref,
            )
            return {
                'staff_name':       None,
                'telegram_chat_id': None,
            }

        staff = request.env['patient.monitoring.staff'].sudo().search(
            [('user_id', '=', patient.assigned_staff_id.id)], limit=1
        )

        if not staff:
            _logger.warning(
                '[PatientMonitoring] No patient.monitoring.staff row found for '
                'res.users id=%s (patient %s). '
                'The assigned user has no linked staff profile.',
                patient.assigned_staff_id.id, patient_ref,
            )
            return {
                'staff_name':       patient.assigned_staff_id.name,
                'telegram_chat_id': None,
            }

        return {
            'staff_name':       staff.name,
            'telegram_chat_id': staff.telegram_chat_id or None,
        }

    @http.route(
        '/patient_monitoring/api/staff/register_telegram',
        type='jsonrpc', auth='public', methods=['POST'], csrf=False,
    )
    def register_staff_telegram(self, employee_id=None, chat_id=None, token=None, **kwargs):
        """
        Called by the FastAPI Telegram bot polling loop when a staff member
        sends /start EMP_<employee_id> to the bot.

        Security: protected by a shared secret token stored in Odoo System
        Parameters as  patient_monitoring.telegram_register_token  and in
        the FastAPI .env as  TELEGRAM_REGISTER_TOKEN.  Both must match.

        auth='public' is intentional — this endpoint is called by the bot
        process, which has no Odoo session cookie.
        """
        expected_token = (
            request.env['ir.config_parameter']
            .sudo()
            .get_param('patient_monitoring.telegram_register_token', '')
        )

        if not expected_token:
            _logger.error(
                '[PatientMonitoring] patient_monitoring.telegram_register_token '
                'is not set in System Parameters. Telegram registration is disabled.'
            )
            return {
                'success': False,
                'error':   'Server misconfiguration: registration token not set.',
            }

        if not token or token != expected_token:
            _logger.warning(
                '[PatientMonitoring] register_telegram: invalid token attempt '
                '(employee_id=%s, chat_id=%s)', employee_id, chat_id,
            )
            return {'success': False, 'error': 'Invalid token'}

        if not employee_id or not chat_id:
            return {'success': False, 'error': 'employee_id and chat_id are required'}

        staff = request.env['patient.monitoring.staff'].sudo().search(
            [('employee_id', '=', str(employee_id))], limit=1
        )

        if not staff:
            _logger.warning(
                '[PatientMonitoring] register_telegram: employee_id=%s not found.',
                employee_id,
            )
            return {
                'success': False,
                'error':   f"Employee ID '{employee_id}' does not exist in the system.",
            }

        staff.write({'telegram_chat_id': str(chat_id)})

        _logger.info(
            '[PatientMonitoring] Telegram linked: employee=%s, staff=%s, chat_id=%s',
            employee_id, staff.name, chat_id,
        )

        return {
            'success':    True,
            'staff_name': staff.name,
        }
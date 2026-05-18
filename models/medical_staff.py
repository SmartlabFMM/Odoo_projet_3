import io
import base64
import logging

from odoo import models, fields, api
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class MedicalStaff(models.Model):
    _name        = 'patient.monitoring.staff'
    _description = 'Medical Staff'
    _inherit     = ['mail.thread', 'mail.activity.mixin']

    name        = fields.Char(string='Full Name',   required=True, tracking=True)
    employee_id = fields.Char(string='Employee ID', required=True, copy=False)

    specialization = fields.Selection([
        ('doctor', 'Doctor'),
        ('nurse',  'Nurse'),
    ], string='Specialization', required=True, tracking=True)

    department = fields.Char(string='Department')
    phone      = fields.Char(string='Phone')
    email      = fields.Char(string='Email')

    user_id = fields.Many2one(
        'res.users',
        string='System User',
        ondelete='cascade',
        tracking=True,
    )

    patient_ids = fields.One2many(
        'patient.monitoring.patient', 'assigned_staff_id',
        string='Managed Patients',
    )
    patient_count = fields.Integer(
        string='Patient Count', compute='_compute_patient_count',
    )

    alert_ids = fields.Many2many(
        'patient.monitoring.alert', string='Received Alerts',
    )

    telegram_chat_id = fields.Char(
        string='Telegram Chat ID',
        copy=False,
        tracking=True,
        help=(
            'Populated automatically when the staff member scans the QR code '
            'and taps Start in the Telegram bot. Do not edit manually.'
        ),
    )
    telegram_linked = fields.Boolean(
        string='Telegram Linked',
        compute='_compute_telegram_linked',
        store=True,
    )
    telegram_deep_link = fields.Char(
        string='Telegram Deep Link',
        compute='_compute_telegram_setup',
        store=False,
    )
    telegram_qr_code = fields.Binary(
        string='Telegram QR Code',
        compute='_compute_telegram_setup',
        store=False,
        attachment=False,
    )
    telegram_status_html = fields.Html(
        string='Registration Status',
        compute='_compute_telegram_setup',
        sanitize=False,
        store=False,
    )

    @api.depends('patient_ids')
    def _compute_patient_count(self):
        for rec in self:
            rec.patient_count = len(rec.patient_ids)

    @api.depends('telegram_chat_id')
    def _compute_telegram_linked(self):
        for rec in self:
            rec.telegram_linked = bool(rec.telegram_chat_id)

    @api.depends('employee_id', 'telegram_chat_id')
    def _compute_telegram_setup(self):
        bot_username = (
            self.env['ir.config_parameter']
            .sudo()
            .get_param('patient_monitoring.telegram_bot_username', '')
        )

        for rec in self:
            if rec.telegram_chat_id:
                rec.telegram_deep_link = False
                rec.telegram_qr_code   = False
                rec.telegram_status_html = (
                    '<div class="hm_tg_status hm_tg_linked">'
                    '  <span class="hm_tg_icon">&#10003;</span>'
                    '  <div class="hm_tg_info">'
                    '    <span class="hm_tg_label">Telegram Linked</span>'
                    f'   <span class="hm_tg_chatid">Chat ID:&nbsp;<code>{rec.telegram_chat_id}</code></span>'
                    '  </div>'
                    '</div>'
                )
                continue

            if not bot_username or not rec.employee_id:
                rec.telegram_deep_link   = False
                rec.telegram_qr_code     = False
                rec.telegram_status_html = (
                    '<div class="hm_tg_status hm_tg_warning">'
                    '  <span class="hm_tg_icon">&#9888;</span>'
                    '  <div class="hm_tg_info">'
                    '    <span class="hm_tg_label">Configuration Required</span>'
                    '    <span class="hm_tg_hint">Set <strong>patient_monitoring.telegram_bot_username</strong>'
                    '    in <em>Settings &rarr; Technical &rarr; System Parameters</em> to enable QR setup.</span>'
                    '  </div>'
                    '</div>'
                )
                continue

            deep_link = f"https://t.me/{bot_username}?start=EMP_{rec.employee_id}"
            rec.telegram_deep_link = deep_link

            qr_b64 = rec._generate_qr_png(deep_link)
            rec.telegram_qr_code = qr_b64

            if qr_b64:
                rec.telegram_status_html = (
                    '<div class="hm_tg_status hm_tg_unlinked">'
                    '  <span class="hm_tg_icon">&#8856;</span>'
                    '  <div class="hm_tg_info">'
                    '    <span class="hm_tg_label">Not Yet Linked</span>'
                    '    <span class="hm_tg_hint">Scan the QR code below with your phone to register.</span>'
                    '  </div>'
                    '</div>'
                )
            else:
                rec.telegram_status_html = (
                    '<div class="hm_tg_status hm_tg_unlinked">'
                    '  <span class="hm_tg_icon">&#8856;</span>'
                    '  <div class="hm_tg_info">'
                    '    <span class="hm_tg_label">Not Yet Linked</span>'
                    f'   <span class="hm_tg_hint">Open Telegram and search for <strong>@{bot_username}</strong>,'
                    '    then tap Start to register.</span>'
                    '  </div>'
                    '</div>'
                )

    @staticmethod
    def _generate_qr_png(data: str):
        try:
            import qrcode
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=8,
                border=4,
            )
            qr.add_data(data)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue())
        except ImportError:
            _logger.warning(
                "The 'qrcode' package is not installed. "
                "Run: pip install 'qrcode[pil]' in the Odoo virtualenv."
            )
            return False

    @api.onchange('user_id')
    def _onchange_user_id(self):
        """Pre-fill contact fields from the linked user when selected."""
        if self.user_id:
            if not self.name:
                self.name  = self.user_id.name
            if not self.email:
                self.email = self.user_id.email or ''
            if not self.phone:
                self.phone = (
                    self.user_id.partner_id.phone or
                    self.user_id.partner_id.mobile or ''
                )

    def action_view_patients(self):
        """
        Open the styled Patient Dashboard filtered to this staff member's
        patients.  The dashboard reads `staff_id` / `staff_name` from the
        action context and applies the appropriate domain filter.
        """
        self.ensure_one()
        return {
            'type':    'ir.actions.client',
            'tag':     'health_monitoring.patient_dashboard',
            'name':    f'{self.name} — Patients',
            'context': {
                'staff_id':   self.id,
                'staff_name': self.name,
            },
        }

    def action_reset_telegram(self):
        self.ensure_one()
        self.write({'telegram_chat_id': False})
        return {
            'type': 'ir.actions.client',
            'tag':  'display_notification',
            'params': {
                'title':   'Telegram Unlinked',
                'message': (
                    f'{self.name} has been unlinked from Telegram. '
                    'They must scan the QR code again to re-register.'
                ),
                'type': 'warning',
                'next': {'type': 'ir.actions.client', 'tag': 'reload'},
            },
        }

    _sql_constraints = [
        ('employee_id_unique', 'unique(employee_id)', 'Employee ID must be unique.'),
        ('user_id_unique',     'unique(user_id)',     'This user already has a staff profile.'),
    ]

    @api.constrains('user_id')
    def _check_user_has_staff_role(self):
        """
        Guard against manually linking a user who doesn't have the Medical Staff
        role. Skipped during automatic sync from res.users (context flag
        'skip_group_check' is set by _sync_medical_staff_records) because the
        sync already verifies group membership before calling create().
        """
        if self.env.context.get('skip_group_check'):
            return

        medical_staff_group = self.env.ref(
            'health_monitoring.group_medical_staff',
            raise_if_not_found=False,
        )
        if not medical_staff_group:
            return

        for rec in self:
            if rec.user_id and medical_staff_group not in rec.user_id.groups_id:
                raise ValidationError(
                    f'"{rec.user_id.name}" does not have the Medical Staff role. '
                    'Assign the role first — the staff profile will then be created automatically.'
                )
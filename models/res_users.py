from odoo import models, api
import logging

_logger = logging.getLogger(__name__)


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model_create_multi
    def create(self, vals_list):
        users = super().create(vals_list)
        users._sync_medical_staff_records()
        return users

    def write(self, vals):
        result = super().write(vals)
        if 'groups_id' in vals:
            self._sync_medical_staff_records()
        return result

    def _sync_medical_staff_records(self):
        if not self.ids:
            return

        medical_staff_group = self.env.ref(
            'health_monitoring.group_medical_staff',
            raise_if_not_found=False,
        )
        if not medical_staff_group:
            return

        self.env.cr.execute(
            "SELECT uid FROM res_groups_users_rel WHERE gid = %s AND uid = ANY(%s)",
            (medical_staff_group.id, list(self.ids)),
        )
        medical_staff_user_ids = [row[0] for row in self.env.cr.fetchall()]
        if not medical_staff_user_ids:
            return

        Staff = self.env['patient.monitoring.staff'].sudo().with_context(
            skip_group_check=True
        )

        for user in self.browse(medical_staff_user_ids):
            existing = Staff.search([('user_id', '=', user.id)], limit=1)
            if existing:
                continue

            Staff.create({
                'name':           user.name,
                'user_id':        user.id,
                'employee_id':    f'EMP-{user.id:05d}',
                'email':          user.email or '',
                'phone':          user.partner_id.phone or user.partner_id.mobile or '',
                'specialization': 'nurse',
            })

            _logger.info(
                '[MedicalStaff] Auto-created staff record for user %s (id=%s)',
                user.name, user.id,
            )
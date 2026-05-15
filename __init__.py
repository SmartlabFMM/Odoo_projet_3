from . import models
from . import controllers

def post_migrate(env, *args, **kwargs):
    """
    Runs on every install and upgrade.
    Backfills staff profile records for all existing internal users.
    """
    base_user_group = env.ref('base.group_user', raise_if_not_found=False)
    if not base_user_group:
        return

    cr = env.cr
    cr.execute(
        "SELECT uid FROM res_groups_users_rel WHERE gid = %s",
        (base_user_group.id,),
    )
    internal_user_ids = [r[0] for r in cr.fetchall()]
    if not internal_user_ids:
        return

    env['res.users'].browse(internal_user_ids)._sync_medical_staff_records()

    import logging
    logging.getLogger(__name__).info(
        '[MedicalStaff] post_migrate: synced staff records for %d internal user(s).',
        len(internal_user_ids),
    )

def post_init_hook(env):
    post_migrate(env)
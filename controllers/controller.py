# from odoo import http


# class HealthMonitoring(http.Controller):
#     @http.route('/health_monitoring/health_monitoring', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/health_monitoring/health_monitoring/objects', auth='public')
#     def list(self, **kw):
#         return http.request.render('health_monitoring.listing', {
#             'root': '/health_monitoring/health_monitoring',
#             'objects': http.request.env['health_monitoring.health_monitoring'].search([]),
#         })

#     @http.route('/health_monitoring/health_monitoring/objects/<model("health_monitoring.health_monitoring"):obj>', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('health_monitoring.object', {
#             'object': obj
#         })


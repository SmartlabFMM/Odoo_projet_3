{
    'name':     'Health Monitoring & AI Alerts Module',
    'version':  '0.1',
    'category': 'Healthcare',
    'author':   'Smartlab FMM',

    'depends': ['base', 'mail'],

    'external_dependencies': {
        'python': ['qrcode', 'PIL', 'matplotlib'],
    },

    'post_init_hook': 'post_init_hook',

    'data': [
        'security/security.xml',
        'security/ir.model.access.csv',
        'data/alert_thresholds.xml',
        'views/dashboard_views.xml',
        'views/medical_staff_views.xml',
        'views/patient_views.xml',
        'views/medical_record_views.xml',
        'views/measurements_views.xml',
        'views/alerts_views.xml',
        'views/report_views.xml',
        'views/analytics_views.xml',
        'views/menu_views.xml',
    ],

    'assets': {
        'web.assets_backend': [
            'health_monitoring/static/src/css/dashboard_shared.css',
            'health_monitoring/static/src/js/medical_record_dashboard.js',
            'health_monitoring/static/src/js/medical_staff_dashboard.js',
            'health_monitoring/static/src/js/navigation_dashboard.js',
            'health_monitoring/static/src/js/patient_dashboard.js',
            'health_monitoring/static/src/js/vitals_chart_widget.js',
            'health_monitoring/static/src/js/medical_record_dashboard.js',
            'health_monitoring/static/src/xml/medical_record_dashboard.xml',
            'health_monitoring/static/src/xml/medical_staff_dashboard.xml',
            'health_monitoring/static/src/xml/navigation_dashboard.xml',
            'health_monitoring/static/src/xml/patient_dashboard.xml',
            'health_monitoring/static/src/xml/vitals_chart_widget.xml',
            'health_monitoring/static/src/css/navigation_dashboard.css',
            'health_monitoring/static/src/css/patient_monitoring.css',
        ],
    },

    'installable': True,
    'application': True,
    'license':     'LGPL-3',
}
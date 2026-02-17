{
    "name": "Health Monitoring",
    "version": "1.0",
    "category": "Medical",
    "license": "AGPL-3",
    "author" : "Youssef Battikh",
    "depends": ["base"],
    "data": [
        "security/ir.model.access.csv",
        "views/patient_views.xml",
        "views/medical_staff_views.xml",
        "views/vital_signs_views.xml",
        "views/measurements_views.xml",
        "views/alert_views.xml",
    ],
    "installable": True,
    "application": True,
}

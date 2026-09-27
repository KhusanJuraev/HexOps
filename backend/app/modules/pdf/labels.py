"""Text printed in exported PDFs, in the user's UI language.

The enum names match frontend/src/shared/i18n/locales/*.json (reports.type, .severity,
.status); tests/pdf/test_labels.py keeps them in step.
"""

LANGS = ("en", "ru", "uz")

LABELS: dict[str, dict[str, str]] = {
    "en": {
        "kind.report": "Report",
        "kind.note": "Note",
        "project": "Project",
        "type": "Type",
        "severity": "Severity",
        "status": "Status",
        "cvss": "CVSS",
        "bounty": "Bounty",
        "submitted_at": "Submitted",
        "triaged_at": "Triaged",
        "closed_at": "Closed",
        "paid_at": "Paid",
        "created_at": "Created",
        "updated_at": "Updated",
        "tags": "Tags",
        "image": "Image",
        "exported": "Exported",
    },
    "ru": {
        "kind.report": "Отчёт",
        "kind.note": "Заметка",
        "project": "Проект",
        "type": "Тип",
        "severity": "Критичность",
        "status": "Статус",
        "cvss": "CVSS",
        "bounty": "Вознаграждение",
        "submitted_at": "Отправлен",
        "triaged_at": "Принят в работу",
        "closed_at": "Закрыт",
        "paid_at": "Оплачен",
        "created_at": "Создан",
        "updated_at": "Изменён",
        "tags": "Теги",
        "image": "Изображение",
        "exported": "Экспортирован",
    },
    "uz": {
        "kind.report": "Hisobot",
        "kind.note": "Qayd",
        "project": "Loyiha",
        "type": "Turi",
        "severity": "Jiddiylik",
        "status": "Holat",
        "cvss": "CVSS",
        "bounty": "Mukofot",
        "submitted_at": "Yuborilgan",
        "triaged_at": "Koʻrib chiqila boshlangan",
        "closed_at": "Yopilgan",
        "paid_at": "Toʻlangan",
        "created_at": "Yaratilgan",
        "updated_at": "Yangilangan",
        "tags": "Teglar",
        "image": "Rasm",
        "exported": "Eksport qilingan",
    },
}

ENUMS: dict[str, dict[str, dict[str, str]]] = {
    "en": {
        "type": {"cve": "CVE", "bbp": "Bug bounty (BBP)", "vdp": "VDP", "pentest": "Pentest"},
        "severity": {
            "critical": "Critical",
            "high": "High",
            "medium": "Medium",
            "low": "Low",
            "info": "Info",
        },
        "status": {
            "draft": "Draft",
            "submitted": "Submitted",
            "triaged": "Triaged",
            "accepted": "Accepted",
            "duplicate": "Duplicate",
            "rejected": "Rejected",
            "paid": "Paid",
        },
    },
    "ru": {
        "type": {"cve": "CVE", "bbp": "Bug bounty (BBP)", "vdp": "VDP", "pentest": "Пентест"},
        "severity": {
            "critical": "Критическая",
            "high": "Высокая",
            "medium": "Средняя",
            "low": "Низкая",
            "info": "Информационная",
        },
        "status": {
            "draft": "Черновик",
            "submitted": "Отправлен",
            "triaged": "Принят в работу",
            "accepted": "Подтверждён",
            "duplicate": "Дубликат",
            "rejected": "Отклонён",
            "paid": "Оплачен",
        },
    },
    "uz": {
        "type": {"cve": "CVE", "bbp": "Bug bounty (BBP)", "vdp": "VDP", "pentest": "Pentest"},
        "severity": {
            "critical": "Kritik",
            "high": "Yuqori",
            "medium": "Oʻrta",
            "low": "Past",
            "info": "Maʼlumot",
        },
        "status": {
            "draft": "Qoralama",
            "submitted": "Yuborilgan",
            "triaged": "Koʻrib chiqilmoqda",
            "accepted": "Qabul qilingan",
            "duplicate": "Dublikat",
            "rejected": "Rad etilgan",
            "paid": "Toʻlangan",
        },
    },
}


def label(lang: str, key: str) -> str:
    return LABELS.get(lang, LABELS["en"]).get(key, key)


def value(lang: str, key: str, raw: str) -> str:
    """Translate an enum value (type/severity/status); anything else is shown as is."""
    return ENUMS.get(lang, ENUMS["en"]).get(key, {}).get(raw, raw)

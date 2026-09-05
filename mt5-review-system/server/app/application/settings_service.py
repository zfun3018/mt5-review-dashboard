from __future__ import annotations


class SettingsService:
    def __init__(self, catalogs, settings, status, backups) -> None:
        self.catalogs = catalogs
        self.settings = settings
        self.status = status
        self.backups = backups

    def get_classifications(self, dimension=None, active_only=False):
        return self.catalogs.list_classifications(dimension, active_only)

    def get_custom_fields(self):
        return self.catalogs.list_custom_fields()

    def get_analysis_settings(self):
        return self.settings.get_analysis_settings()

    def get_status(self):
        return self.status.get_status()

    def list_backups(self):
        return self.backups.list_backups()

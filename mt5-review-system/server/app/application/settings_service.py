from __future__ import annotations


class SettingsService:
    def __init__(self, catalogs, settings, status, backups) -> None:
        self.catalogs = catalogs
        self.settings = settings
        self.status = status
        self.backups = backups

    def get_classifications(self, dimension=None, active_only=False):
        return self.catalogs.list_classifications(dimension, active_only)

    def get_custom_fields(self, active_only=False):
        # Preserve compatibility with lightweight catalog adapters that still
        # expose the original zero-argument read method.
        if active_only:
            return self.catalogs.list_custom_fields(active_only=True)
        return self.catalogs.list_custom_fields()

    def restore_custom_field(self, field_id: int):
        from ..data.catalog_commands import restore_custom_field
        return restore_custom_field(field_id)

    def archive_custom_field(self, field_id: int):
        # Backwards compatible alias: archive is what UI calls "stop using".
        from ..data.catalog_commands import delete_custom_field
        delete_custom_field(field_id)
        return {"ok": True}

    def restore_classification(self, option_id: str):
        from ..data.catalog_commands import restore_classification_option
        return restore_classification_option(option_id)

    def get_analysis_settings(self):
        return self.settings.get_analysis_settings()

    def get_status(self):
        return self.status.get_status()

    def list_backups(self):
        return self.backups.list_backups()

"""Stable error types shared across application boundaries."""


class ApplicationError(Exception):
    """Base class for errors safe to translate at the presentation boundary."""


class ValidationError(ApplicationError, ValueError):
    """Raised when input violates an application contract."""

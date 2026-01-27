from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv
from typing import Any

from .const import (
    DOMAIN,
    CONF_SERVICE_URL,
    CONF_AUTH_METHOD,
    CONF_AUTH_BASIC_USERNAME,
    CONF_AUTH_BASIC_PASSWORD,
    AUTH_METHOD_PASSTHRU,
    AUTH_METHOD_NONE,
    AUTH_METHOD_BASIC,
)


class MediaMtxConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for MediaMTX."""

    VERSION = 2

    vol_service_url = {
        vol.Required(
            CONF_SERVICE_URL,
            default="http://localhost:8889",
        ): cv.string,
    }

    vol_auth_settings = {
        vol.Required(
            CONF_AUTH_METHOD,
            default=AUTH_METHOD_NONE,
        ): vol.In([AUTH_METHOD_NONE, AUTH_METHOD_PASSTHRU, AUTH_METHOD_BASIC]),
        vol.Optional(
            CONF_AUTH_BASIC_USERNAME,
        ): cv.string,
        vol.Optional(
            CONF_AUTH_BASIC_PASSWORD,
        ): cv.string,
    }

    schema_create = vol.Schema(vol_service_url | vol_auth_settings)
    schema_update = vol.Schema(vol_auth_settings)

    # config logic is the same for new/edit
    def validate_service_url(self, service_url) -> dict[str, str]:
        """Form validation, common for create/update"""
        errors: dict[str, str] = {}

        # Basic validation: must start with http:// or https://
        if not service_url.startswith(("http://", "https://")):
            errors["base"] = "invalid_url"

        return errors

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        """Handle the initial step when adding the integration."""
        errors: dict[str, str] = {}

        if user_input is not None:
            service_url = user_input[CONF_SERVICE_URL].strip()
            errors = self.validate_service_url(service_url)

            if not errors:
                # user defined ID is our permanent system ID
                await self.async_set_unique_id(service_url)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=service_url,
                    data=user_input,
                )  # type: ignore[arg-type]

        return self.async_show_form(
            step_id="user",
            data_schema=self.schema_create,
            errors=errors,
        )  # type: ignore[arg-type]

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            # Use the unique id already embedded in class instance
            return self.async_update_reload_and_abort(
                self._get_reconfigure_entry(),
                data_updates=user_input,
            )

        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self.schema_update,
        )

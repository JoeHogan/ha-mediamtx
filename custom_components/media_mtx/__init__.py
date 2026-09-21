from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry

from .const import (
    DOMAIN, 
    CONF_SERVICE_URL,
    CONF_AUTH_METHOD,
    CONF_AUTH_BASIC_USERNAME,
    CONF_AUTH_BASIC_PASSWORD
)

from .http_api import async_register_mediamtx_proxy
from . import utils
from pathlib import Path
import hashlib

import logging

_LOGGER = logging.getLogger(__name__)


def _asset_version(path: Path) -> str:
    """Short content hash used as the resource cache-bust tag."""
    try:
        return hashlib.sha1(path.read_bytes()).hexdigest()[:12]
    except OSError:
        return "0"


async def async_setup(hass: HomeAssistant, config: dict):
    """YAML setup (not used but must exist)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up MediaMTX from a config entry."""
    entry_data = entry.data

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        CONF_SERVICE_URL: entry_data[CONF_SERVICE_URL],
        CONF_AUTH_METHOD: entry_data[CONF_AUTH_METHOD],
        CONF_AUTH_BASIC_USERNAME: entry_data[CONF_AUTH_BASIC_USERNAME] if CONF_AUTH_BASIC_USERNAME in entry_data else None,
        CONF_AUTH_BASIC_PASSWORD: entry_data[CONF_AUTH_BASIC_PASSWORD] if CONF_AUTH_BASIC_PASSWORD in entry_data else None,
    }
    

    # Register backend API
    await async_register_mediamtx_proxy(hass, entry)

    # Serve JS card from www directory inside custom_component
    path = Path(__file__).parent / "www"
    await utils.register_static_path(hass, f"/{DOMAIN}", str(path))

    # Register the card as a Lovelace dashboard resource with a content-hash
    # cache-bust tag (HACS-style). Editing the card + restarting HA changes the
    # tag, so every browser auto-refetches it - no manual cache clearing.
    card_file = path / "mediamtx-webrtc-card.js"
    tag = await hass.async_add_executor_job(_asset_version, card_file)
    await utils.init_resource(hass, f"/{DOMAIN}/mediamtx-webrtc-card.js", tag)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload MediaMTX."""
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True

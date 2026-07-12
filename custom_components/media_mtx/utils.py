import logging

_LOGGER = logging.getLogger(__name__)


async def register_static_path(hass, url_path: str, directory_path: str):
    """Register a static directory for serving files."""
    app = hass.http.app

    # Check if this path is already registered
    for route in app.router.routes():
        if getattr(route, "path", None) == url_path:
            return

    app.router.add_static(url_path, directory_path, show_index=False)
    _LOGGER.debug("Registered static directory: %s -> %s", url_path, directory_path)


async def init_resource(hass, url_path: str, tag: str) -> bool:
    """Register (or update) the card as a Lovelace dashboard resource, HACS-style.

    The ``tag`` (a content hash) is appended as ``?hacstag=<tag>`` so the URL
    changes whenever the file changes -> browsers auto-refetch (cache-bust).
    Falls back to a frontend extra_module_url when the Lovelace resource store
    is unavailable (e.g. YAML-mode dashboards).
    """
    versioned = f"{url_path}?hacstag={tag}"

    resources = getattr(hass.data.get("lovelace"), "resources", None)
    if resources is not None:
        try:
            # Ensure the resource store is loaded before reading/writing it.
            await resources.async_get_info()

            for resource in resources.async_items():
                # Match on the path, ignoring any existing ?hacstag=... query.
                if resource["url"].split("?")[0] == url_path:
                    if resource["url"] != versioned:
                        await resources.async_update_item(
                            resource["id"], {"url": versioned}
                        )
                        _LOGGER.info("Updated card resource -> %s", versioned)
                    else:
                        _LOGGER.debug("Card resource already current: %s", versioned)
                    return True

            await resources.async_create_item(
                {"res_type": "module", "url": versioned}
            )
            _LOGGER.info("Registered card resource: %s", versioned)
            return True
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Could not register Lovelace resource (%s); "
                "falling back to extra_module_url",
                err,
            )

    # Fallback: load as a frontend module (works even in YAML-mode Lovelace).
    try:
        from homeassistant.components.frontend import add_extra_js_url

        add_extra_js_url(hass, versioned)
        _LOGGER.info("Loaded card via extra_module_url: %s", versioned)
        return True
    except Exception as err:  # noqa: BLE001
        _LOGGER.error("Unable to load card resource: %s", err)
        return False

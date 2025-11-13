from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from aiohttp import web
from .const import DOMAIN, CONF_SERVICE_URL
import aiohttp


async def async_register_mediamtx_proxy(hass: HomeAssistant, entry: ConfigEntry):
    """Register a proxy route that forwards all HTTP methods to the configured MediaMTX service."""

    async def handle_proxy(request: web.Request):
        """Forward any request (including OPTIONS) to the configured service URL."""

        # Retrieve the configured service URL
        entry_data = hass.data[DOMAIN].get(entry.entry_id)
        if not entry_data:
            return web.json_response(
                {"error": "Integration not properly initialized"}, status=500
            )

        base_url = entry_data[CONF_SERVICE_URL].rstrip("/")
        tail = request.match_info.get("tail", "")
        target_url = f"{base_url}/{tail}".rstrip("/")

        # Copy query parameters
        params = dict(request.query)

        # Forward only the headers we care about
        headers = {
            k: v
            for k, v in request.headers.items()
            if k in ("Authorization", "Content-Type")
        }

        # Read request body, if any
        try:
            body = await request.read()
        except Exception:
            body = None

        # Proxy the request to the backend service
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method=request.method,
                url=target_url,
                headers=headers,
                params=params,
                data=body,
            ) as resp:
                response_body = await resp.read()

                # Forward most headers except hop-by-hop or CORS-related
                response_headers = {
                    k: v
                    for k, v in dict(resp.headers).items()
                    if k.lower() not in ("transfer-encoding",)
                }

                return web.Response(
                    body=response_body,
                    status=resp.status,
                    headers=response_headers,
                )

    # Register the route manually (wildcard = all methods)
    hass.http.app.router.add_route("*", "/api/mediamtx/{tail:.*}", handle_proxy)

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from aiohttp import web, hdrs
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
import aiohttp
import base64


async def async_register_mediamtx_proxy(hass: HomeAssistant, entry: ConfigEntry):
    """Register a proxy route that forwards all HTTP methods to the configured MediaMTX service."""

    async def hass_authenticate(request: web.Request):
        # Already authenticated by HA middleware
        hass_user = request.get("hass_user")
        if hass_user:
            return hass_user

        # Fallback: token in query param
        token = request.query.get("token")
        if not token:
            return None

        # Validate using HA token validation (sync in your version)
        refresh_token = hass.auth.async_validate_access_token(token)
        if refresh_token is None:
            return None

        # Return user from token
        return refresh_token.user

    async def downstream_authentication_header(request: web.Request, entry_data):
        if entry_data[CONF_AUTH_METHOD] == AUTH_METHOD_NONE:
            return ""
        elif entry_data[CONF_AUTH_METHOD] == AUTH_METHOD_PASSTHRU:
            authHdr = request.get(hdrs.AUTHORIZATION)
            return "" if authHdr is None else authHdr
        elif entry_data[CONF_AUTH_METHOD] == AUTH_METHOD_BASIC:
            credential = f"{entry_data[CONF_AUTH_BASIC_USERNAME]}:{entry_data[CONF_AUTH_BASIC_PASSWORD]}"
            b64_credential = base64.b64encode(credential.encode("utf-8")).decode(
                "utf-8"
            )
            return f"Basic {b64_credential}"
        else:
            raise ValueError(f"unsupported auth method:{entry_data[CONF_AUTH_METHOD]}")

    async def handle_proxy(request: web.Request):
        """Forward any request (including OPTIONS) to the configured service URL."""

        # Authenticate user
        hass_user = await hass_authenticate(request)
        if hass_user is None:
            return web.json_response({"error": "Unauthorized"}, status=401)

        # Retrieve the configured entry (service URL, etc)
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
        headers = {k: v for k, v in request.headers.items() if k in ("Content-Type")}

        headers[hdrs.AUTHORIZATION] = await downstream_authentication_header(
            request, entry_data
        )

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
    hass.http.app.router.add_route(
        "*", f"/api/mediamtx/{entry.entry_id}/{{tail:.*}}", handle_proxy
    )
    hass.http.app.router.add_route(
        "*", f"/api/mediamtx/default/{{tail:.*}}", handle_proxy
    )

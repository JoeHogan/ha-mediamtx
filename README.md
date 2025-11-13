# MediaMTX Integration for Home Assistant

This integration proxies API requests from Home Assistant to a MediaMTX service
running on your local network.

## Installation (via HACS)

1. Go to HACS → Integrations → ⋮ → Custom repositories.
2. Add:

https://github.com/JoeHogan/ha-mediamtx

with category **Integration**.
3. Install **MediaMTX Integration**.
4. Restart Home Assistant.
5. Add the integration via *Settings → Devices & Services → Add Integration → MediaMTX*.

## Configuration

You’ll be prompted for your MediaMTX service URL (e.g. `http://192.168.1.X:8899`).

## Card Options

### type
    Required: custom:mediamtx-webrtc-card

### resource
    Required: the name of your MediaMTX camera stream

### name
    Optional: the name you want to appear under the video

# Card Usage Examples

```
    - type: custom:mediamtx-webrtc-card
      resource: driveway_camera
      name: Driveway Camera
```


## Features

- Proxy HTTP requests securely through Home Assistant.
- Supports authenticated requests via HA tokens.
- Handles CORS automatically for frontend access.

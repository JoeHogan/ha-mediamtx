import {
    LitElement,
    html,
    css
  } from "https://unpkg.com/lit-element@4.1.1/lit-element.js?module";

class MediaMtxWebrtcCard extends LitElement {

    constructor() {
        super();
        this.fullscreen = false;
        this.mute = true;
        this.iframe = document.createElement('iframe');
        this.ongoingEvents = [];
    }

    static get properties() {
        return {
            hass: {},
            config: {},
        };
    }

    render() {
        return html`
            <ha-card>
                <div class="webrtc-video ${this.fullscreen ? 'fullscreen' : ''} ${this.getActivity().length ? 'activity' : ''} ${this.getOpenOnEvent() ? 'ongoing-event' : ''}">

                    <div class="webrtc-video-container">

                        <div class="webrtc-video-overlay" @click="${this.toggleFullscreen}">

                            ${this.getActivityBadges()}

                            ${this.fullscreen ?
                                html`
                                    <div class="webrtc-video-controls" @click="${this.controlsClicked}">
                                        <button type="button" @click="${this.toggleMute}">${this.mute ? html`<ha-icon icon="mdi:volume-off"></ha-icon>` : html`<ha-icon icon="mdi:volume-high"></ha-icon>`}</button>
                                        ${this.intercomConfig ?
                                            html`
                                                <ha-intercom-card .hass=${this.hass} .config=${this.intercomConfig}></ha-intercom-card>
                                            ` :
                                            html``
                                        }
                                        <button type="button" @click="${this.restartVideo}"><ha-icon icon="mdi:restart"></ha-icon></button>
                                    </div>
                                `
                                :
                                html``
                            }

                            ${this.getName()}

                        </div>

                        ${this.iframe}

                    </div>

                </div>
            </ha-card>
        `;
    }

    getActivity() {
        if (this.config?.activity && this.hass?.states) {
            let activities = Array.isArray(this.config.activity) ? this.config.activity : [this.config.activity];
            return activities.filter((activity) => {
                let entity = this.hass.states[activity?.entity] || {};
                let state = entity.state || 'Unknown';
                let matchState = activity.state || true; // default matching state
                return state === matchState ? true : false;
            });
        }
        return [];
    }

    getOpenOnEvent() {
        if (this.config?.event && this.hass?.states) {
            let events = Array.isArray(this.config.event) ? this.config.event : [this.config.event];
            let ongoingEvents = events.filter((event) => {
                let entity = this.hass.states[event?.entity] || {};
                let state = entity.state || 'Unknown';
                let matchState = event.state || true; // default matching state
                let show = state === matchState ? true : false;

                let existing = this.ongoingEvents.find(oe => oe.entity === event.entity);
                if (existing) {
                    if(!show) { // state changed
                        this.ongoingEvents = this.ongoingEvents.filter(oe => oe.entity !== event.entity);
                        return false;
                    } // state hasnt changed... check visibility
                    if(existing.show) {
                        return true;
                    }
                    return false;
                }
                if (!show) {
                    return false; // not existing but not a matching event
                }
                let oe = {...event, ...{show: true}};
                this.ongoingEvents.push(oe); // new event. show by default
                if(event.timeoutSeconds) {
                    setTimeout(() => {
                        oe.show = false; // if event has a timeout configured, trigger visibility change
                        this.getOpenOnEvent(); // recheck
                    }, event.timeoutSeconds * 1000);
                }
                return true;

            })
            let hasOngoingEvents = ongoingEvents?.length || false;

            if(hasOngoingEvents) {
                if (!this.hasOngoingEvents) {
                    this.hasOngoingEvents = true;
                    if(!this.fullscreen) {
                        this.fullScreenAutoToggled = true;
                        this.toggleFullscreen();
                    }
                }
            } else if (this.hasOngoingEvents) {
                this.hasOngoingEvents = false;
                if (this.fullscreen && this.fullScreenAutoToggled) {
                    if (this.fullscreen) {
                        this.toggleFullscreen();
                    }
                    this.fullScreenAutoToggled = false;
                }
            }

            return hasOngoingEvents;
        }
        return false;
    }

    postMessage(key, value, attempt = 0) {
        if (!this.iframe.contentWindow) {
            if (attempt < 3) {
                setTimeout(() => this.postMessage(key, value, attempt++), 500);
            }
        } else {
            this.iframe.contentWindow.postMessage({key, value}, window.location.origin);
        }
    }

    toggleFullscreen(e) {
        e?.preventDefault();
        e?.stopPropagation();
        this.fullscreen = this.fullscreen ? false : true;
        if(this.fullscreen) {
            this.mute = false;
        } else {
            this.ongoingEvents.forEach(event => event.show = false); // if fullscreen was toggled by an ongoing event, then closing fullscreen manually should prevent event from retoggling it
        }
        this.postMessage('fullscreen', this.fullscreen);
        this.requestUpdate();
    }

    controlsClicked(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    toggleMute() {
        this.mute = this.mute ? false : true;
        this.postMessage('mute', this.mute);
        this.requestUpdate();
    }

    restartVideo() {
        this.postMessage('restart', true);
    }

    firstUpdated() {
       this.iframe.src = `/media_mtx/video.html${this.configToQs()}`;
    }

    configToQs() {
        return `?config=${btoa(JSON.stringify(this.config || {}))}`;
    }

    setConfig(config) {
        if (!config.resource) {
        throw new Error("You need to define a resource");
        }
        if (config.intercom) {
            this.intercomConfig = {...{hideStatus: true, hideTranscription: true}, ...config.intercom};
        }
        this.config = config;
    }

    // The height of your card. Home Assistant uses this to automatically
    // distribute all cards over the available columns.
    getCardSize() {
        return 2;
    }

    getActivityBadges() {
        let activities = this.getActivity();
        let unique = activities.map(activity => activity.name || 'Activity').filter((name, i, arr) => arr.indexOf(name) === i);
        return html`
            <div class="activities">
                ${unique.map(name => {
                    return html`
                        <div class="activity-badge">${name}</div>
                    `
                })}
            </div>
        `
    }

    getName() {
        if (this.config.name) {
            return html`
                <div class="webrtc-video-name">
                    <h3>${this.config.name}</h3>
                </div>
            `
        }
        return null;
    }

    static get styles() {
        return css`
        .webrtc-video {
            position: relative;
            overflow: hidden;
            background-color: rgba(0, 0, 0, 1);
            border-radius: 10px;
        }
        .webrtc-video.fullscreen {
            position: fixed;
            top: 0;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 100;
            border-radius: 0;
        }
        .webrtc-video.fullscreen.ongoing-event {
            z-index: 200;
        }
        .webrtc-video.activity {
            -webkit-animation: activity 1s ease-in-out infinite;
            animation: activity 1s ease-in-out infinite;
        }
        .webrtc-video-container {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            overflow: hidden;
            aspect-ratio: 16/9;
        }
        .webrtc-video-overlay {
            position: absolute;
            z-index: 3;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
        }
        .webrtc-video-controls {
            position: absolute;
            top: 0;
            right: 0;
            padding: 10px;
            z-index: 4;
            display: none;
        }
        .webrtc-video.fullscreen .webrtc-video-controls {
            display: block;
        }
        .webrtc-video-controls button {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 0;
            background-color: rgba(0, 100, 150, 0.7);
            color: white;
            display: block;
            margin-bottom: 10px;
        }
        .webrtc-video-controls ha-intercom-card {
            margin-bottom: 10px;
        }
        .webrtc-video-name {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            text-align: center;
            background: rgba(0, 0, 0, 0.3);
            color: white;
            padding: 10px 20px;
            z-index: 4;
        }
        .activities {
            position: absolute;
            top: 0;
            left: 0;
            padding: 10px;
            z-index: 4;
            display: none;
        }
        .webrtc-video.activity .activities {
            display: block;
        }
        .activities .activity-badge {
            font-size: 12px;
            margin-bottom: 5px;
            padding: 0px 4px;
            background-color: orange;
            color: white;
            border-radius: 4px;
        }
        h3 {
            margin: 0;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
        @-webkit-keyframes activity {
            from, to {
                box-shadow: 0 0 3px 1px transparent
            }
            50% {
                box-shadow: 0 0 3px 1px red
            }
        }
        @keyframes activity {
            from, to {
                box-shadow: 0 0 3px 1px transparent
            }
            50% {
                box-shadow: 0 0 3px 1px red
            }
        }
        `;
    }
}

if(!customElements.get("mediamtx-webrtc-card")) {
    customElements.define("mediamtx-webrtc-card", MediaMtxWebrtcCard);
}
import { getAccessToken } from "./refreshToken.js";

const unquoteCredential = (v) => (
    JSON.parse(`"${v}"`)
);

const linkToIceServers = (links) => (
    (links !== null) ? links.split(', ').map((link) => {
        const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i);
        const ret = {
            urls: [m[1]],
        };

        if (m[3] !== undefined) {
            ret.username = unquoteCredential(m[3]);
            ret.credential = unquoteCredential(m[4]);
            ret.credentialType = "password";
        }

        return ret;
    }) : []
);

const parseOffer = (offer) => {
    const ret = {
        iceUfrag: '',
        icePwd: '',
        medias: [],
    };

    for (const line of offer.split('\r\n')) {
        if (line.startsWith('m=')) {
            ret.medias.push(line.slice('m='.length));
        } else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
            ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
        } else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) {
            ret.icePwd = line.slice('a=ice-pwd:'.length);
        }
    }

    return ret;
};

const enableStereoOpus = (section) => {
    let opusPayloadFormat = '';
    let lines = section.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('a=rtpmap:') && lines[i].toLowerCase().includes('opus/')) {
            opusPayloadFormat = lines[i].slice('a=rtpmap:'.length).split(' ')[0];
            break;
        }
    }

    if (opusPayloadFormat === '') {
        return section;
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('a=fmtp:' + opusPayloadFormat + ' ')) {
            if (!lines[i].includes('stereo')) {
                lines[i] += ';stereo=1';
            }
            if (!lines[i].includes('sprop-stereo')) {
                lines[i] += ';sprop-stereo=1';
            }
        }
    }

    return lines.join('\r\n');
};

const editOffer = (offer) => {
    const sections = offer.sdp.split('m=');

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.startsWith('audio')) {
            sections[i] = enableStereoOpus(section);
        }
    }

    offer.sdp = sections.join('m=');
};

const generateSdpFragment = (offerData, candidates) => {
    const candidatesByMedia = {};
    for (const candidate of candidates) {
        const mid = candidate.sdpMLineIndex;
        if (candidatesByMedia[mid] === undefined) {
            candidatesByMedia[mid] = [];
        }
        candidatesByMedia[mid].push(candidate);
    }

    let frag = 'a=ice-ufrag:' + offerData.iceUfrag + '\r\n'
        + 'a=ice-pwd:' + offerData.icePwd + '\r\n';

    let mid = 0;

    for (const media of offerData.medias) {
        if (candidatesByMedia[mid] !== undefined) {
            frag += 'm=' + media + '\r\n'
                + 'a=mid:' + mid + '\r\n';

            for (const candidate of candidatesByMedia[mid]) {
                frag += 'a=' + candidate.candidate + '\r\n';
            }
        }
        mid++;
    }

    return frag;
}

export class WHEPClient {
    constructor(config, options) {
        this.url = '/api/mediamtx';
        this.urlIndex = 0;
        this.resource = config.resource;
        this.pc = null;
        this.dc = null;
        this.sessionUrl = '';
        this.onTrackCb = options?.onTrackCb || null;
        this.connectionStateCb = options?.connectionStateCb || null;
        this.queuedCandidates = [];
        this.retryCb = options?.retryCb || null;
    }

    get resourceUrl() {
        let url = Array.isArray(this.url) ? this.url[this.urlIndex] : this.url;
        return `${url}/${this.resource}`;
    }

    async start() {
        console.log("requesting ICE servers");
        let access_token = await getAccessToken();
        return fetch(this.resourceUrl+`/whep`, {
            method: 'OPTIONS',
            headers: {
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json",
            },
            })
            .then((res) => this.onIceServers(res))
            .catch((err) => {
                if (Array.isArray(this.url)) {
                    this.urlIndex = this.url.length > this.urlIndex + 1 ? this.urlIndex + 1 : 0;
                }
                return this.handleConnectionError(err);
            });

    }

    handleConnectionError(err) {
        console.log('error: ' + err);
        if (this.retryCb) {
            if (this.retryCb(this.pc)){
                return this.setDelay(5000).then(() => this.scheduleRestart());
            }
        } else {
            return this.setDelay(5000).then(() => this.scheduleRestart());
        }
        return err;
    }

    onIceServers(res) {
        this.pc = new RTCPeerConnection({
            iceServers: linkToIceServers(res.headers.get('Link')),
        });

        this.dc = this.pc.createDataChannel("");

        const direction = "sendrecv";
        this.pc.addTransceiver("video", { direction });
        this.pc.addTransceiver("audio", { direction });

        this.pc.onicecandidate = (evt) => this.onLocalCandidate(evt);
        this.pc.oniceconnectionstatechange = () => this.onConnectionState();

        this.pc.ontrack = (evt) => this.onTrack(evt);

        return this.pc.createOffer()
            .then((offer) => this.onLocalOffer(offer));
    }

    getConnectionState() {
        if (this.pc) {
            let state = this.pc.iceConnectionState;
            if(!state) {
                console.log(`Awaiting Connection State...`);
                return this.setDelay(500).then(() => this.getConnectionState());
            }
        } else {
            console.log(`Peer Connection is not available...`);
        }
        let state = this.pc ? this.pc.iceConnectionState : 'disconnected';
        console.log(`Connection State: ${state}`);
        return Promise.resolve(state);
    }

    onTrack(evt){
        if (this.onTrackCb) {
            this.onTrackCb(evt);
        }
    }

    setDelay(delay) {
        console.log(`Waiting ${Math.round(delay/1000)} seconds...`);
        return new Promise((res) => {
            setTimeout(() => res(), delay || 0);
        });
    }

    async onLocalOffer(offer) {
        editOffer(offer);

        this.offerData = parseOffer(offer.sdp);
        this.pc.setLocalDescription(offer);

        console.log("sending offer");
        let access_token = await getAccessToken();
        return fetch(this.resourceUrl+`/whep`, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${access_token}`,
                'Content-Type': 'application/sdp',
            },
            body: offer.sdp,
        })
            .then((res) => {
                if (res.status !== 201) {
                    return Promise.reject('bad status code');
                }
                this.sessionUrl = ('/api/mediamtx'+res.headers.get('location')).toString();
                return res.text();
            })
            .then((sdp) => this.onRemoteAnswer(new RTCSessionDescription({
                type: 'answer',
                sdp,
            })))
            .catch((err) => {
                return this.handleConnectionError(err);
            });
    }

    onConnectionState() {
        return this.getConnectionState()
        .then((state) => {
            this.connectionState = state;

            console.log("peer connection state:", state);

            if(this.connectionStateCb) {
                this.connectionStateCb(state);
            }

            if(this.isDisconnected()) {
                console.log('restarting...');
                return this.scheduleRestart();
            }

            return state;
        });
    }

    isConnected() {
        return ['connected', 'connecting', 'checking', 'stable', 'new'].indexOf(this.connectionState) > -1 ? true : false;
    }

    isDisconnected() {
        return ['failed', 'closed', 'disconnected'].indexOf(this.connectionState) > -1 ? true : false;
    }

    onRemoteAnswer(answer) {
        if (this.pc && !this.isConnected()) {
            return this.pc.setRemoteDescription(answer)
            .then(() => {
                if (this.queuedCandidates.length !== 0) {
                    this.queuedCandidates.forEach(item => this.pc.addIceCandidate(item));
                    return this.sendLocalCandidates(this.queuedCandidates)
                    .then(() => {
                        this.queuedCandidates = [];
                    });
                }
            })
            .catch((err) => {
                return this.handleConnectionError(err);
            });
        }
        return Promise.resolve();
    }

    onLocalCandidate(evt) {
        if (evt.candidate !== null) {
            if (this.sessionUrl === '') {
                this.queuedCandidates.push(evt.candidate);
            } else {
                this.sendLocalCandidates([evt.candidate])
            }
        }
    }

    async sendLocalCandidates(candidates) {
        let access_token = await getAccessToken();
        return fetch(this.sessionUrl, {
            method: 'PATCH',
            headers: {
                "Authorization": `Bearer ${access_token}`,
                'Content-Type': 'application/trickle-ice-sdpfrag',
                'If-Match': '*',
            },
            body: generateSdpFragment(this.offerData, candidates),
        })
        .then((res) => {
            if (res.status !== 204) {
                return Promise.reject('bad status code');
            }
        })
        .catch((err) => {
            return this.handleConnectionError(err);
        });
    }

    async clearSession() {
        if (this.sessionUrl) {
            return fetch(this.sessionUrl, {
                method: 'DELETE',
                headers: {
                    "Authorization": `Bearer ${access_token}`,
                    "Content-Type": "application/json",
                },
            })
            .then((res) => {
                if (res.status !== 200) {
                    return Promise.reject('bad status code');
                }
            })
            .catch((err) => {
                console.log('delete session error: ' + err);
            });
        }
        return Promise.resolve();
    }

    scheduleRestart() {
        return this.stop()
        .then(() => {
            return this.clearSession()
            .finally(() => {
                this.sessionUrl = '';
                this.connectionState = 'disconnected';
                this.queuedCandidates = [];
                return this.start();
            });
        });
    }

    stop() {
        if(this.pc !== null) {
            let promise = new Promise((res) => {
                if (this.dc !== null && !this.isDisconnected()) {
                    this.dc.onclose = () => {
                        this.dc = null;
                        this.setDelay(3000).then(() => res());
                    };
                } else {
                    this.dc = null;
                    res();
                }
            });
            this.pc.close();
            this.pc = null;
            return promise;
        }
        return Promise.resolve();
    }
}
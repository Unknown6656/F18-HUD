"use strict";



$.prototype.hasAttr = function(attr)
{
    return this.attr(attr) !== undefined;
};

$.prototype.cssVar = function(name)
{
    return getComputedStyle(this[0]).getPropertyValue(name);
};

$.prototype.cssCalc = function(name)
{
    let value = this.cssVar(name);

    return Number(tosser.evaluateCalc(value, { container: this[0] })
                        .replace(/px$/i, ''));
}

const calc = expr => expr;

const COOKIE_HAS_INTERACTED = 'f18-interacted';
const COOKIE_MAX_GLOAD = 'f18-max-g-load';
const COOKIE_HUD_MODE = 'f18-hud-mode';
const COOKIE_PITCH_LADDER_MODE = 'f18-pitch-ladder-mode'
const DEG_TO_RAD = .0174532925199432957692369076848861271344287188854172545609719144;
const SENSOR_INTERVAL = 35;
const GHOST_ANGLE = 7;
const AOA_ANGLE = 4;

const smoothing = class
{
    #last_input;
    #initial;
    #value;
    #factor;

    constructor(initial, factor = .5)
    {
        this.#initial = initial;
        this.#last_input = initial;
        this.#value = initial;
        this.#factor = factor;
    }

    get factor()
    {
        return this.#factor;
    }

    get value()
    {
        return this.#value;
    }

    get last()
    {
        return this.#last_input;
    }

    reset()
    {
        this.#value = this.#initial;
        this.#last_input = this.#initial;
    }

    update(value, factor = undefined)
    {
        factor = factor || this.#factor;

        const new_value = factor ? this.#value * (1 - factor) + value * factor : value;

        this.#value = new_value || this.#value;
        this.#last_input = value || this.#last_input;

        return this.#value;
    };
}

const root = $(':root');
const heading_tape = $('#heading-tape');
const pitch_ladder = $('#pitch-ladder');
const ghost_indicator = $('#ghost-velocity-indicator');
const flight_indicator = $('#flight-path-indicator');
const hud_mode_indicator = $('#hud-mode-indicator');
const aoa_bracket = $('#aoa-bracket');
const debug = root.hasAttr('debug');

let closest_airport = [undefined, undefined];
let closest_icao_cache = undefined;
let last_ts_orientation = -1;
let last_ts_motion = -1;
let last_location = undefined;
let heading_offset = undefined;
let curr_g = 0.0;
let peak_g = 0.0;

// should be represented by the waterline indicator
const curr_yaw = new smoothing(0, .05);
const curr_roll = new smoothing(0, .05);
const curr_pitch = new smoothing(0, .05);

let target_yaw = 0.0;
let target_roll = 0.0;
let target_pitch = 0.0;
let waypoint_yaw = 0.0;
let waypoint_pitch = 0.0;

// should be represented by the flight path indicator
let inertia_yaw = 0.0;
const inertia_pitch = new smoothing(0.0, .2);


const normalize_angle = angle => (angle % 360 + 360) % 360;

function get_orientation_mode()
{
    let mode = hud_mode_indicator.attr('mode') || 'A';

    if (mode.startsWith('A'))
        mode = mode[1];

    return mode == 'R' ? 'R' : 'L';
}

// angle: [0°..360°]
function set_yaw(angle)
{
    angle = normalize_angle((get_orientation_mode() == 'L' ? 180 : 0) - angle);

    const target_yaw = curr_yaw.update(angle);
    const center = Math.floor(angle / 10) * 10;
    const offset = (center - angle) * 20;
    let html = '';

    for (let deg = center - 30; deg <= center + 30; deg += 10)
        html += `
            <heading-tick small></heading-tick>
            <heading-tick large>${((deg + 720) % 360).toString().padStart(3, '0')}</heading-tick>
        `;

    heading_tape.html(html + '<heading-tick small></heading-tick>')
                .css('--heading', `${offset}%`);
    // setTimeout(() => heading_tape.css('--heading', `${offset}%`), 0); // animation is not smooth without this
    root.css('--current-yaw-angle', `${angle}deg`)
        .css('--waypoint-yaw-offset', `${waypoint_yaw - curr_yaw.last}`);

    set_target_yaw(target_yaw);
}

// angle: [-180° (ccw) ..180° (cw)]
function set_roll(angle)
{
    angle = normalize_angle(angle);

    if (angle > 180.0)
        angle -= 360.0;
    else if (angle < -180.0)
        angle += 360.0;

    const target_roll = curr_roll.update(angle);

    $('#bank-angle-indicator').text(angle.toFixed(0));
    root.css('--current-roll-angle', `${angle}deg`);

    set_target_roll(target_roll);
}

// angle: [-90° (down) .. +90° (up)]
function set_pitch(angle)
{
    angle = get_orientation_mode() == 'L' ? angle : -angle;
    angle = Math.max(-90, Math.min(90, angle));

    const target_pitch = curr_pitch.update(angle);
    const center = Math.round(angle / 10) * 10;
    const offset = (center - angle) * 4;
    let html = '';

    const incr = root.hasAttr('pitch5') ? 5 : 10;

    for (let deg = center + 30; deg >= center - 30; deg -= incr)
    {
        let angle = Math.abs(deg);

        if (!!(angle % 10) && !(angle % 5))
            angle = '';

        html += `
        <pitch-ladder-tick ${deg == 0 ? 'zero' : deg < 0 ? 'neg' : 'pos'}>
            <left-bracket angle="${angle}"></left-bracket>
            <right-bracket angle="${angle}"></right-bracket>
        </pitch-ladder-tick>
        `;
    }

    pitch_ladder.html(html + '<pitch-ladder-tick></pitch-ladder-tick>')
                .css('--pitch', `${offset}%`);
    root.css('--current-pitch-angle', `${angle}deg`)
        .css('--waypoint-pitch-offset', `${curr_pitch.last - waypoint_pitch}`);

    update_aoa();
    set_target_pitch(target_pitch);
}

// angle: [0°..360°]
function set_target_yaw(angle)
{
    angle = normalize_angle(angle);
    target_yaw = angle;

    root.css('--target-yaw-angle', `${angle}deg`)
        .css('--yaw-offset', angle - curr_yaw.last);

    update_flight_path_indicator();
}

// angle: [-180° (ccw) ..180° (cw)]
function set_target_roll(angle)
{
    angle = normalize_angle(angle);

    if (angle > 180.0)
        angle -= 360.0;
    else if (angle < -180.0)
        angle += 360.0;

    target_roll = angle;

    root.css('--target-roll-angle', `${angle}deg`)
        .css('--roll-offset', angle - curr_roll.last);

    update_flight_path_indicator();
}

// angle: [-90° (down) .. +90° (up)]
function set_target_pitch(angle)
{
    angle = Math.max(-90, Math.min(90, angle));
    target_pitch = angle;

    root.css('--target-pitch-angle', `${angle}deg`)
        .css('--pitch-offset', angle - curr_pitch.last);

    update_flight_path_indicator();
}

function update_flight_path_indicator()
{
    const yaw_diff = root.cssVar('--yaw-offset');
    const roll_diff = root.cssVar('--roll-offset');
    const pitch_diff = root.cssVar('--pitch-offset');
    const xstep = root.cssCalc('--yaw-degree-size');
    const ystep = root.cssCalc('--pitch-degree-size');
    const angle = Math.atan2(pitch_diff, yaw_diff) + roll_diff * DEG_TO_RAD;
    let offset = Math.sqrt(yaw_diff * yaw_diff + pitch_diff * pitch_diff);
    let x = Math.cos(angle) * offset * xstep;
    let y = Math.sin(angle) * offset * ystep;

    ghost_indicator.css('--computed-x-offset', `${x}px`)
                   .css('--computed-y-offset', `${y}px`);

    if (offset > GHOST_ANGLE)
    {
        x = Math.cos(angle) * GHOST_ANGLE * xstep;
        y = Math.sin(angle) * GHOST_ANGLE * ystep;

        ghost_indicator.removeAttr('hidden');
        flight_indicator.attr('blink', true);
    }
    else
    {
        flight_indicator.removeAttr('blink');
        ghost_indicator.attr('hidden', true);
    }

    aoa_bracket.css('--computed-y-offset', y)
    flight_indicator.css('--computed-x-offset', `${x}px`)
                    .css('--computed-y-offset', `${y}px`);
}

function update_aoa()
{
    const aoa = curr_pitch.value - inertia_pitch.value;

    $('#angle-of-attack-value').text(aoa.toFixed(1));

    if (Math.abs(aoa) > AOA_ANGLE)
        aoa_bracket.attr('blink', true);
    else
        aoa_bracket.removeAttr('blink');

    root.css('--current-pitch-aoa', `${aoa}deg`)
        .css('--current-aoa-offset', `${aoa * 100.0}%`);
}

// angle: [0°..360°]
function set_inertia_yaw(angle)
{
    angle = normalize_angle(angle);
    inertia_yaw = angle;

    /////// TODO ///////

    ghost_indicator.css('--yaw-diff', inertia_yaw - curr_yaw.value);
    root.css('--inertia-yaw-angle', `${angle}deg`);
}

// angle: [-90° (down) .. +90° (up)]
function set_inertia_pitch(angle)
{
    angle = Math.max(-90, Math.min(90, angle));
    inertia_pitch.update(angle);
    root.css('--inertia-pitch-angle', `${angle}deg`);

    update_aoa();
}

// altitude: m
const set_altitude = altitude => $('#altitude-indicator-value').text(Math.round(altitude * 3.28084));

// speed. m/s, climb_rate: m/s
function set_speed(speed, climb_rate)
{
    $('#speed-indicator-value').text(Math.round(speed * 1.943844)); // [kn]
    $('#mach-speed-value').text((speed / 340.29).toFixed(2)); // [mach]
    $('#climb-rate-value').text(Math.round(climb_rate * 196.8504)); // [ft/min]

    const pitch = Math.atan2(climb_rate, speed) * 180 / Math.PI;

    set_inertia_pitch(pitch);
}

// acceleration: g
function set_acceleration(acceleration)
{
    curr_g = acceleration;
    peak_g = Math.max(peak_g, acceleration);

    $('#g-load-value').text(acceleration.toFixed(1));
    $('#g-peak-value').text(peak_g.toFixed(1));

    let cookie_peak_g = Number(Cookies.get(COOKIE_MAX_GLOAD) || '0');

    if (peak_g > cookie_peak_g)
        Cookies.set(COOKIE_MAX_GLOAD, peak_g.toString());
}

const set_time = () => $('#time-indicator').text(new Date().toISOString().slice(11, 19) + 'Z');

function set_location(event)
{
    const err = event.coords.accuracy || 0.0;
    const alt = event.coords.altitude || 0.0;
    const lat = event.coords.latitude || 0.0;
    const lon = event.coords.longitude || 0.0;
    const time = event.timestamp;

    set_altitude(alt);

    if (last_location)
    {
        const dist = WGS84_distance(lat, lon, last_location.coords.latitude, last_location.coords.longitude);
        const heading = WGS84_orientation(lat, lon, last_location.coords.latitude, last_location.coords.longitude);
        const speed = dist / ((time - last_location.timestamp) / 1000);
        const climb_rate = (alt - last_location.coords.altitude) / ((time - last_location.timestamp) / 1000);

        set_speed(speed, climb_rate);
        set_inertia_yaw(heading);
    }

    last_location = event;

    display_nearest_airport(lat, lon, alt, err);
}

function WGS84_distance(lat1, lon1, lat2, lon2)
{
    lat1 *= DEG_TO_RAD;
    lat2 *= DEG_TO_RAD;
    lon1 *= DEG_TO_RAD;
    lon2 *= DEG_TO_RAD;

    const radius = 6371000;
    const phi = Math.sin(.5 * (lat2 - lat1));
    const psi = Math.sin(.5 * (lon2 - lon1));
    const alpha = phi * phi + psi * psi * Math.cos(lat1) * Math.cos(lat2);

    return 2 * radius * Math.atan2(Math.sqrt(alpha), Math.sqrt(1 - alpha));
}

function WGS84_orientation(lat1, lon1, lat2, lon2)
{
    const lon_delta = lon2 - lon1;
    const y = Math.sin(lon_delta) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon_delta);

    return normalize_angle(Math.atan2(y, x) / DEG_TO_RAD);
}

function update_airport_distance(lat, lon)
{
    let nearest = [];
    let mindist = Number.MAX_SAFE_INTEGER + .1;
    let keys = Object.keys(airports);

    if (closest_icao_cache)
        keys = closest_icao_cache.concat(keys.filter(icao => !closest_icao_cache.includes(icao)));

    for (const icao of keys)
    {
        const airport = airports[icao];
        const currdist = WGS84_distance(lat, lon, airport['lat'], airport['lon']);

        if (currdist < mindist)
        {
            mindist = currdist;
            closest_airport = [icao, currdist];
            nearest.unshift(icao);
        }
        else if (mindist < 500)
            break; // distance to nearest airport is .5km. It's safe to assume that there is no closer airfield.
    }

    closest_icao_cache = nearest;
}

function display_nearest_airport(lat, lon, alt, err)
{
    update_airport_distance(lat, lon);

    const [icao, dist] = closest_airport;

    // if (!icao)
    //     update_airport_distance(lat, lon);

    const airport = airports[icao];
    const dir = WGS84_orientation(lat, lon, airport['lat'], airport['lon']);
    const vdist = alt * 3.28084 - airport['alt'];

    $('#nav-info').html(`
        ${icao}<br/>
        ${Math.round(vdist)} <span ${airport['type'] == 'CLS' ? 'blink' : ''}>${airport['type']}</span><br/>
        ${(dist / 1852).toFixed(1)} TGT<br/>
        WYPT
    `);
    $('#nav-compass').text(Math.round(dir).toString().padStart(3, '0')).css('--nav-compass-heading', `${dir}deg`);

    waypoint_yaw = dir;
    waypoint_pitch = Math.atan2(vdist, dist * 3.28084) * 180 / Math.PI;
}

function change_pitch_ladder_steps()
{
    if (root.hasAttr('pitch5'))
    {
        root.removeAttr('pitch5');
        Cookies.remove(COOKIE_PITCH_LADDER_MODE);
    }
    else
    {
        root.attr('pitch5', true);
        Cookies.set(COOKIE_PITCH_LADDER_MODE, '5');
    }
}

function build_bank_angle_scale()
{
    let html = '<bank-angle-triangle></bank-angle-triangle>';

    for (let angle = 0; angle < 360; angle += 10)
        html += `<bank-angle-tick style="--bank-angle: ${angle}deg"></bank-angle-tick>`;

    $('hud-element#bank-angle-scale').html(html);
}

// TODO : AbsoluteOrientationSensor (android)
function register_orientation_event()
{
    let evtname = 'deviceorientation';

    if (navigator.userAgent.toLowerCase().indexOf('android') > -1)
        evtname = 'deviceorientationabsolute';

    window.addEventListener(evtname, e =>
    {
        const now = performance.now();

        if (SENSOR_INTERVAL && now - last_ts_orientation < SENSOR_INTERVAL)
            return;
        else
            last_ts_orientation = now;

        let heading = normalize_angle(-(Math.abs(e.alpha - 360) + e.beta * e.gamma / 90));

        if (heading_offset)
            heading = normalize_angle(heading_offset - heading);
        else if (e.webkitCompassHeading)
            heading_offset = normalize_angle(e.webkitCompassHeading - heading);

        heading = e.absolute || heading;

        set_yaw(debug ? heading : -heading);
        set_pitch(-e.beta);
        set_roll(e.gamma);
    }, true);
}

function register_motion_event()
{
    window.addEventListener('devicemotion', e =>
    {
        const now = performance.now();

        if (SENSOR_INTERVAL && now - last_ts_motion < SENSOR_INTERVAL)
            return;
        else
            last_ts_motion = now;

        const acc = e.accelerationIncludingGravity;
        const sign = -Math.sign(acc.z * Math.cos(curr_pitch.last * DEG_TO_RAD));
        const g = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) * sign / 9.81;

        set_acceleration(g);
    }, true);
}

function register_location_event()
{
    const gps_options = {
        enableHighAccuracy: true,
        maximumAge: 0,
        // timeout: 8 * SENSOR_INTERVAL,
        timeout: 1000,
        accuracy: 5,
    };

    navigator.geolocation.getCurrentPosition(set_location, alert, gps_options);
    navigator.geolocation.watchPosition(set_location, _ => {}, gps_options); 
}

function reset()
{
    curr_yaw.reset()
    curr_roll.reset()
    curr_pitch.reset()
    inertia_pitch.reset()

    set_yaw(0);
    set_roll(0);
    set_pitch(0);
    set_target_yaw(0);
    set_target_roll(0);
    set_target_pitch(0);
    set_inertia_yaw(0);
    set_inertia_pitch(0);
    set_altitude(0);
    set_speed(0, 0);
    set_acceleration(0);

    peak_g = 0;
    last_ts_orientation = -1;
    last_ts_motion = -1;
    last_location = undefined;
    heading_offset = undefined;
}

async function start(origin = undefined)
{
    $('start-page').remove();

    if (typeof(DeviceMotionEvent) !== 'undefined' && typeof(DeviceMotionEvent.requestPermission) === 'function')
    {
        let response = await DeviceMotionEvent.requestPermission();

        if (response == 'granted')
            register_motion_event();
    }
    else
        register_motion_event();

    if (typeof(DeviceOrientationEvent) !== 'undefined' && typeof(DeviceOrientationEvent.requestPermission) === 'function')
    {
        let response = await DeviceOrientationEvent.requestPermission();

        if (response == 'granted')
            register_orientation_event();
    }
    else
        register_orientation_event();

    $(window).bind('orientationchange', on_device_orientation_changed);

    register_location_event();
    on_device_orientation_changed();
    setInterval(set_time, 500);

    if (!debug && origin)
        make_fullscreen();
}

function autostart()
{
    hud_mode_indicator.attr('mode', Cookies.get(COOKIE_HUD_MODE) || 'A');
    peak_g = Number(Cookies.get(COOKIE_MAX_GLOAD) || '0');

    start();
}

function make_fullscreen()
{
    if (document.fullscreenElement)
        document.exitFullscreen();

    $('body')[0].requestFullscreen();
}

function switch_orientation()
{
    let mode = hud_mode_indicator.attr('mode') || 'A';

    mode = mode.startsWith('A') ? 'R' : mode == 'R' ? 'L' : 'A';

    hud_mode_indicator.attr('mode', mode);
    Cookies.set(COOKIE_HUD_MODE, mode);

    on_device_orientation_changed();
}

function on_device_orientation_changed()
{
    root.css('--orientation', `${window.orientation}deg`);

    if ((hud_mode_indicator.attr('mode') || 'A').startsWith('A'))
        hud_mode_indicator.attr('mode', window.orientation >= 180 ? 'AL' : 'AR');
        // 180 --> L mode
        // 0   --> R mode
    else
        ;// otherwise do nothing (for now)
}

function initialize()
{
    hud_mode_indicator.click(switch_orientation);

    $('#start-button').click(() =>
    {
        Cookies.set(COOKIE_HAS_INTERACTED, 'true', { expires: 30 });

        make_fullscreen();
        start(this);
    });
    $('#waterline-indicator').click(make_fullscreen);
    $('#speed-g-aoa-info *, #speed-g-aoa-info').click(() => 
    {
        peak_g = 0;
        Cookies.set(COOKIE_MAX_GLOAD, '0');
    });
    $('#nav-compass').click(change_pitch_ladder_steps);


    build_bank_angle_scale();
    reset();
    
    if (Cookies.get(COOKIE_PITCH_LADDER_MODE) == '5')
        root.attr('pitch5', true);
    else
        root.removeAttr('pitch5');

    if (Cookies.get(COOKIE_HAS_INTERACTED))
        setTimeout(autostart, 1);

    // if ('serviceWorker' in navigator)
    //     navigator.serviceWorker.register('offline.js');
}


if (location.protocol == 'http:')
    location.href = `https:${location.href.substring(location.protocol.length)}`;
else
    initialize();

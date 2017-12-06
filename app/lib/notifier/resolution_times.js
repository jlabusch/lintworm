var log     = require('../log'),
    config	= require('config'),
    fs      = require('fs'),
    rocket  = require('../rocket'),
    format  = rocket.format,
    persona = config.get('resolution_times.persona'),
    muted   = config.get('resolution_times.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function ResolutionTimer(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = refs.__test_hook || function(){};

    if (refs.__test_overrides){
        if (refs.__test_overrides.config){
            config = refs.__test_overrides.config;
        }
        if (refs.__test_overrides.hook){
            this.__test_hook = refs.__test_overrides.hook;
        }
    }

    this.path = config.get('resolution_times.dir');
}

var changed_files = {};

ResolutionTimer.prototype.start = function(notifier){
    fs.watch(
        this.path,
        { encoding: 'utf8' },
        (et, filename) => {
            // Give the resolution time script some time to finish creating the file...
            // Because sleep() is truly the antidote to race conditions :(
            setTimeout(function(){ changed_files[filename] = et; }, 60*1000);
        }
    );

    setInterval(() => { this.run() }, 30*1000);
}

ResolutionTimer.prototype.run = function(){
    const label = _L('run');

    Object.keys(changed_files).forEach((f) => {
        delete changed_files[f];
        fs.readFile(this.path + f, {encoding: 'utf8'}, (err, data) => {
            if (err){
                log.info(label + f + ' - ' + err);
            }else{
                let json = undefined;
                try{ json = JSON.parse(data); }
                catch(ex){
                    log.error(label + f + ' - ' + ex);
                }
                if (json){
                    const org = format.org(json.organisation_name),
                        chan = channel(org);
                    ['high', 'medium', 'low', 'service_requests', 'elasticity', 'scalability'].forEach((key) => {
                        let list = json[key];
                        list.forEach((obj) => {
                            let state = null;
                            if (obj.time_to_red[0] === '-'){
                                state = 'red <-- SEND HELP!';
                            }else if (obj.time_to_amber[0] === '-'){
                                state = 'amber, red in ' + obj.time_to_red;
                            }
                            if (state){
                                let msg = `${org} ${format.wr(obj.request_id)} ${format.brief(obj.brief)} (${key}): Resolution time ${state} [${obj.allocated_to}]\n`;
                                log.info(label + msg);
                                this.rocket
                                    .send(msg)
                                    .to(muted ? null : webhook)
                                    .channel(chan)
                                    .then(this.__test_hook);
                            }else{
                                log.info(label + f + ' WR ' + obj.request_id + ' - still green, not sending any messages');
                            }
                        });
                    });
                }
            }
        });
    });
}

// Map an org to a channel, taking the whitelist into account.
// Empty whitelist means everything goes.
// Cut-and-paste from ./updates.js
function channel(org){
    const channel_whitelist = config.get('resolution_times.only_channels'),
        channels= config.get('rocketchat.channels');

    if (!channels[org]){
        return null;
    }
    if (channel_whitelist.length > 0 &&
        channel_whitelist.find(o => {return o === org}) === undefined)
    {
        return null;
    }
    return channels[org];
}

module.exports = ResolutionTimer;


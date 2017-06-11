var log     = require('../log'),
    config	= require('config'),
    our_email_domain = require('../our_email_domain'),
    rocket  = require('../rocket'),
    format  = rocket.format,
    channels= config.get('updates.stick_to_default_channel')
                ? {}
                : config.get('rocketchat.channels'),
    persona = config.get('updates.persona'),
    muted   = config.get('updates.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Updater(refs){
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
}

Updater.prototype.start = function(notifier){
    notifier.linting.add_hook('updates', context => { this.run(context) });
}

Updater.prototype.run = function(context){
    const label = _L('run'),
        intel = {
            notes: {
                client: 0,
                us: 0
            },
            last_note_by_client: undefined,
            last_note_by: undefined,
            last_note: undefined,
            last_status: undefined,
            last_status_by_client: undefined,
            last_status_by: undefined
        },
        rows = context.activity && context.activity.rows ? context.activity.rows : [];

    // Take only new updates, gathering intel as a side effect
    rows.forEach((r) => {
        if (r.fresh){
            let ours = our_email_domain(r.email),
                name = r.fullname.replace(/ - Euro/i, '');
            if (r.source === 'note'){
                if (ours){
                    intel.notes.us++;
                }else{
                    intel.notes.client++;
                }
                intel.notes[name] = true;
                intel.last_note_by_client = !ours;
                intel.last_note_by = name;
                intel.last_note = r.note;
            }else if (r.source === 'status'){
                intel.last_status = r.status;
                intel.last_status_by_client = !ours;
                intel.last_status_by = name;
            }
        }
    });

    const notes_by = Object.keys(intel.notes).filter((k) => { return intel.notes[k] === true });

    let msg = undefined;

    if (config.get('updates.client_only') &&
        intel.notes.client < 1 &&
        !intel.last_status_by_client)
    {
        log.debug(label + `no client updates on ${context.wr}, skipping`);
        return;
    }

    switch (notes_by.length){
    case 0:
        // $person changed status to $status
        if (intel.last_status){
            msg = `${intel.last_status_by} set status to ${format.status(intel.last_status)}`;
        }
        break;
    case 1:
        if (intel.last_status === undefined){
            // $person added a note
            msg = `${intel.last_note_by} added a note`;
        }else{
            // $person  added a note and        changed status to $status (same person did both things)
            // $person  added a note and we     changed status to $status (different person for each, latter was us)
            // $cust1   added a note and $cust2 changed status to $status (different person for each, latter not us)
            let who = intel.last_note_by === intel.last_status_by
                    ? ''
                    : intel.last_status_by_client
                        ? intel.last_status_by
                        : 'we';
            msg = `${intel.last_note_by} added a note and ${who} set status to ${format.status(intel.last_status)}`;
        }
        // Add a snippet of their update
        if (intel.last_note_by_client){
            const note_length_limit = 140;
            let note = intel.last_note.length > note_length_limit
                ? intel.last_note.substr(0, note_length_limit) + '... _(continued on WR)_'
                : intel.last_note,
                indent = '> ';
            msg += `\n${indent}${note.replace(/\n\s*\n/g, '\n').replace(/\n/g, '\n' + indent)}`;
        }
        break;
    default:
        // $a[, $b...] and $c have added notes
        // $a[, $b...] and $c have added notes, and status is now $status
        let fin = notes_by.pop();
        msg = `${notes_by.join(', ')} and ${fin} have added notes`;
        if (intel.last_status){
            msg = msg + `; status now ${format.status(intel.last_status)}`;
        }
        break;
    }

    if (msg){
        const org = format.org(context.req.org),
            chan = channels[org]; // undefined is ok. See also updates.stick_to_default_channel
        let s = `${org} ${format.wr(context.wr)}: ${msg}\n`;
        log.info(label + s);
        this.rocket.send(s).to(muted ? null : webhook).channel(chan).then(this.__test_hook);
    }else{
        log.debug(label + `no notes or status changes on ${context.wr}, only timesheets`);
    }
}

module.exports = Updater;


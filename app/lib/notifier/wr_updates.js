var log     = require('../log'),
    config	= require('config'),
    our_email_domain = require('../our_email_domain'),
    format  = require('../rocket').format,
    webhook = config.get('rocketchat.updates');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Updater(refs){
    this.lwm = refs.lwm;
    this.rocket = refs.rocket;
}

Updater.prototype.start = function(){
    this.lwm.add_hook('lint.activity', context => { this.run(context) });
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
            last_status: undefined,
            last_status_by_client: undefined,
            last_status_by: undefined
        },
        rows = context.activity && context.activity.rows ? context.activity.rows : [],
        // Take only new updates, gathering intel as a side effect
        updates = rows.filter((r) => {
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
                }else if (r.source === 'status'){
                    intel.last_status = r.status;
                    intel.last_status_by_client = !ours;
                    intel.last_status_by = name;
                }
            }
            return r.fresh;
        }),
        notes_by = Object.keys(intel.notes).filter((k) => { return intel.notes[k] === true });

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
            // $person    added a note and            changed status to $status (same person did both things)
            // $person    added a note and we         changed status to $status (different person for each, latter was us)
            // $customer1 added a note and $customer2 changed status to $status (different person for each, latter not us)
            let who = intel.last_note_by === intel.last_status_by
                    ? ''
                    : intel.last_status_by_client
                        ? intel.last_status_by
                        : 'we';
            msg = `${intel.last_note_by} added a note and ${who} set status to ${format.status(intel.last_status)}`;
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
        let s = `${format.org(context.req.org)} ${format.wr(context.wr)}: ${msg}\n`;
        log.info(label + s);
        this.rocket.send(s).to(webhook);
    }else{
        log.debug(label + `no notes or status changes on ${context.wr}, only timesheets`);
    }
}

module.exports = Updater;


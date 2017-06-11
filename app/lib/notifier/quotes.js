var log     = require('../log'),
    config	= require('config'),
    rocket  = require('../rocket'),
    format  = rocket.format,
    http    = require('http'),
    sla_or_hosting_match=require('../sla_match'),
    channels= config.get('quotes.stick_to_default_channel')
                ? {}
                : config.get('rocketchat.channels'),
    persona = config.get('quotes.persona'),
    muted   = config.get('quotes.mute'),
    webhook = config.get('rocketchat.webhooks.' + persona);

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Budgeter(refs){
    this.rocket = refs.rocket || rocket;
    this.__test_hook = function(){};

    if (refs.__test_overrides){
        if (refs.__test_overrides.hook){
            this.__test_hook = refs.__test_overrides.hook;
        }
        if (refs.__test_overrides.config){
            config = refs.__test_overrides.config;
        }
        if (refs.__test_overrides.http){
            http = refs.__test_overrides.http;
        }
    }

}

Budgeter.prototype.start = function(notifier){
    notifier.linting.add_hook('quotes', context => { this.run(context) });
}

Budgeter.prototype.parse = function(csv){
    const label = _L('parse');

    let result = {
            summary: [],
            quotes: []
        },
        current_wr = undefined,
        now = new Date(),
        target_date = ',' + now.getFullYear() + '-' + (now.getMonth()+1),
        state = 'searching';

    csv.split(/\n/).forEach((line) => {
        switch(state){
        case 'searching':
            if (line === target_date){
                log.trace(label + `[${state}->in summary] "${line}"`);
                state = 'in summary';
            }
            break;
        case 'in summary':
            if (line){
                let s = line.replace(/^,/, '').replace(/,/g, ' ');
                log.trace(label + s);
                result.summary.push(s);
            }else{
                log.trace(label + `[${state}->in body] "${line}"`);
                state = 'in body';
            }
            break;
        case 'in body':
            let wr = line.match(/WR# (\d+)/);
            if (wr){
                current_wr = wr[1];
            }else if (line.match(/Quotes:/)){
                log.trace(label + `[${state}->in quotes] "${line}"`);
                state = 'in quotes';
            }
            break;
        case 'in quotes':
            if (line){
                // ,(not SLA),19084,Plugin review for H5P,8,Approved,
                let parts = line.split(',');
                parts[4] += 'h';

                let s = `WR# ${current_wr} ${parts.join(' ')}`;
                log.trace(label + s);
                result.quotes.push(s);
            }else{
                log.trace(label + `[${state}->in body] "${line}"`);
                state = 'in body';
            }
            break;
        }
    });
    return result;
}

Budgeter.prototype.run = function(context){
    const label = _L('run'),
        budget_csv_uri = config.get('quotes.budget_csv_uri');

    if (!budget_csv_uri.hostname){
        log.info(label + 'WR# ' + context.req.request_id + ' => no budget_csv_uri hostname, skipping...');
        this.__test_hook && this.__test_hook(null, {__no_uri: true});
        return;
    }

    let rows = context.activity && context.activity.rows ? context.activity.rows : [];

    if (!rows.find(i => { return i.fresh && i.source === 'quote' })){
        log.debug(label + 'no new quotes on WR# ' + context.req.request_id);
        this.__test_hook && this.__test_hook(null, {__no_quotes: true});
        return;
    }

    if (!sla_or_hosting_match(context.req.system)){
        log.info(label + "WR# " + context.req.request_id + ' ' + context.req.system + " isn't a Hosting or SLA system, skipping...");
        this.__test_hook && this.__test_hook(null, {__not_sla: true});
        return;
    }

    log.trace(label + 'found a quote for WR # ' + context.req.request_id + ' - pulling in client budget');

    // There's a theoretical timing hole here if someone else requests the budget
    // (priming the cache), and then a user adds a quote, and then we request the
    // budget again here all within 30 secs or so. In that case it wouldn't yet
    // show the new quote in the budget.

    const options = {
            hostname: budget_csv_uri.hostname,
            port: budget_csv_uri.port,
            path: budget_csv_uri.path.replace(/{org}/g, context.req.org_id),
            method: 'GET'
        },
        req = http.request(options, (res) => {
            if (res.statusCode !== 200){
                let e = label + 'WR# ' + context.req.request_id + ' budget HTTP resp ' + res.statusCode;
                log.error(e);
                this.__test_hook && this.__test_hook(new Error(e));
            }else{
                log.trace(label + 'WR# ' + context.req.request_id + ' => ' + res.statusCode);
                let data = '';
                res.on('data', (chunk) => { data += chunk });
                res.on('end', () => {
                    const org = format.org(context.req.org),
                        chan = channels[org]; // undefined is ok

                    let p = this.parse(data),
                        summary = '',
                        msg =   `New quote added to ${org} ${format.wr(context.req.request_id)}`;

                    // Note: SLA quotes belong only on SLA systems; Hosting quotes don't affect
                    // the SLA budget report.
                    if (p.summary.length > 0 && !context.req.system.match(/hosting/i)){
                        summary = '\nIn context:\n' +
                                    `> ${p.summary.join('\n> ')}\n` +
                                    `> ${p.quotes.join('\n> ')}\n`;
                    }

                    this.rocket
                        .send(msg + summary)
                        .about(summary ? org + summary : msg)
                        .to(muted ? null : webhook)
                        .channel(chan)
                        .then(this.__test_hook);
                });
            }
        });
    req.on('error', (err) => {
        log.error(label + err);
        this.__test_hook && this.__test_hook(err);
    });
    req.end();
}

module.exports = Budgeter;


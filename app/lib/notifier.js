var log     = require('./log'),
    config	= require('config');

'use strict';

function _L(f){
    return require('path').basename(__filename) + '#' + f + ' - ';
}

function Notifier(lintworm, rocket){
    this.first_run = true;
    this.lwm = lintworm || require('./lintworm');
    this.rocket = rocket || require('./rocket');
}

Notifier.prototype.start = function(){
    let self = this;
    function sweep_wrs(err){
        let delay = 60*1000;
        if (self.first_run){
            self.first_run = false;
            delay = 10*1000;
        }
        if (err){
            log.error(_L('interval') + (err.stack || err));
            delay = delay*10;
        }
        setTimeout(() => { self.run(sweep_wrs) }, delay);
    }
    sweep_wrs();

    if (config.get('lint.check_timesheets_on_startup')){
        setTimeout(() => { this.check_timesheets(); }, 5*1000);
    }
    setInterval(() => { this.check_timesheets() }, 24*60*60*1000);
}

Notifier.prototype.check_timesheets = function(){
    let label = _L('check_timesheets');
    this.lwm.timesheets((err, data) => {
        if (err){
            log.error(label + (err.stack || err));
            return;
        }
        if (data && data.rows && data.rows.length > 0){
            let too_low = data.rows.filter((r) => { return r.worked < 70; });
            if (too_low.length > 0){
                let msg = "Timesheets to chase: \n```" +
                            too_low.map((r) => {
                                return r.fullname + ' '.repeat(30 - r.fullname.length) + (r.worked|0) + '%';
                            }).join('\n')
                            + "```\n"
                log.warn(`${msg}---------------------------------\n`);
                this.rocket.send(msg);
            }
        }
    });
}

Notifier.prototype.run = function(next){
    this.lwm.poll((err, data) => {
        if (err){
            next && next(err);
            return;
        }
        if (data && data.rows){
            log.info(_L('run') + `processing ${data.rows.length} updates`);
            this.process_update(data.rows.shift(), data.rows, next);
        }else{
            next && next();
        }
    });
}

function to_chat_handle(email){
    let nicks = config.get('chat_nicks');
    if (nicks[email]){
        return nicks[email];
    }
    return email;
}

function to_org_abbrev(o){
    let acronym = o.match(/([A-Z]{3}[A-Z]*)/);
    if (acronym){
        return acronym[1];
    }
    let uni = o.match(/University/);
    if (uni){
        return o.replace(/ ?University( of )?/g, '');
    }
    return o.replace(/^The/, '').match(/(\b[A-Z])/g).join('');
}

Notifier.prototype.process_update = function(x, xs, next){
    if (!x){
        next && next();
        return;
    }
    const label = _L('process_update');
    log.info(label + 'WR# ' + x.request_id);
    this.lwm.lint(x.request_id, (err, data) => {
        if (err){
            next && next(err);
            return;
        }
        log.info(label + JSON.stringify(data.rows, null, 2));
        let warnings = data.rows.filter((r) => { return r.warning }).map((r) => { return r.warning; });
        if (warnings.length){ // then there's something unusual
            let v = data.rows[data.rows.length-1],
                a = v.to && v.to.length ? `[see ${v.to.map(to_chat_handle).join(', ')}]\n` : '',
                s = `Can someone please check WR# ${v.wr} for ${to_org_abbrev(v.org)} [${x.status}] ${x.brief}? (${warnings.join(', ')})\n${a}`;
            log.warn(`${s}${v.msg}\n---------------------------------\n`);

            this.rocket.send(s).about(v.wr);
        }
        process.nextTick(() => { this.process_update(xs.shift(), xs, next); });
    });
}

module.exports = {
    notifier: new Notifier(),
    type: Notifier
}



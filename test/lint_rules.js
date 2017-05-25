var assert  = require('assert'),
    config  = require('config'),
    quote_leeway = config.get('lint.quote_leeway'),
    lwm = require('../lib/lintworm.js'),
    should  = require('should');

function setup(pre, post){
    let a = [
        1234,
        {request_id: 1234, total_hours: 0, status: 'New Request'}, // 1. req
        {rows: [{email: 'a@b.c', fullname: 'A B'}]}, // 2. alloc
        {rows: []}, // 3. quote
        {rows: []}, // 4. tags
        {rows: []}, // 5. activity
        {rows: []}, // 6. parents
    ];
    pre(a);
    a.push(function(err, data){
        data.rows.forEach((r) => {
            console.log('\t> ' + (r.warning || r.info || r.msg));
        });
        return post(err, data)
    });
    return a;
}

describe(require('path').basename(__filename), function(){
    describe('sanity check', function(){
        it('should handle success', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        data.rows[0].wr.should.equal(1234);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
    });
    describe('allocation rules', function(){
        it('shouldn\'t flag unallocated for Finished WRs', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].status = 'Finished';
                        a[2].rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
        it('should flag unallocated in general', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[2].rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('should flag multiple allocation', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[2].rows = [
                            {email: 'a@b.c', fullname: 'A B'},
                            {email: 'x@catalyst-eu.net', fullname: 'X'},
                            {email: 'y@catalyst-eu.net', fullname: 'X'},
                            {email: 'z@catalyst-eu.net', fullname: 'X'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        should.exist(data.rows[0].warning);
                        data.rows[0].warning.match(/allocated/).should.not.be.null;
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('...unless one of them is the Sysadmin account', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[2].rows = [
                            {email: 'y@catalyst-eu.net', fullname: 'Catalyst Sysadmin Europe'},
                            {email: 'x@catalyst-eu.net', fullname: 'X'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].msg.match(/^No warnings/))
                        should.exist(data.rows[0].to);
                        should.exist(data.rows[0].to[0].match(/catalyst/));
                        done();
                    }
                )
            );
        });
    });
    describe('billing rules', function(){
        it('should recognise warranty', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = quote_leeway + 1;
                        a[4].rows = [
                            {tag_description: 'A'},
                            {tag_description: 'Warranty'},
                            {tag_description: 'C'}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].info);
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg.match(/^No warnings/))
                        done();
                    }
                )
            );
        });
        it('should flag hours with no quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[0] = 221615,
                        a[1] = {
                            request_id: 221615,
                            total_hours: quote_leeway+5
                        };
                        a[2].rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(3);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/allocated/));
                        should.exist(data.rows[1].warning);
                        should.exist(data.rows[1].warning.match(/over budget/));
                        should.exist(data.rows[2].wr);
                        should.exist(data.rows[2].msg);
                        should.exist(data.rows[2].msg.match(/^2 warning/));
                        done();
                    }
                )
            );
        });
        it('should flag unapproved quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = quote_leeway+1;
                        a[3].rows = [
                            {quote_units: 'hours', quote_amount: 5, approved_by_id: undefined}
                        ]
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/approved/));
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        should.exist(data.rows[1].wr);
                        done();
                    }
                )
            );
        });
        it('should consider approved quotes', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = quote_leeway+1;
                        a[3].rows = [
                            {quote_units: 'hours', quote_amount: 5, approved_by_id: 1}
                        ]
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].wr);
                        should.exist(data.rows[0].msg);
                        should.exist(data.rows[0].msg.match(/^No warning/));
                        done();
                    }
                )
            );
        });
        it('should respect config.lint.quote_leeway', function(done){
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = quote_leeway;
                        a[3].rows = [];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(1);
                        should.exist(data.rows[0].wr);
                        should.exist(data.rows[0].msg);
                        should.exist(data.rows[0].msg.match(/^No warning/));
                        done();
                    }
                )
            );
        });
    });
    describe('notes', function(){
        it('should flag too many notes with no timesheets', function(done){
            let today = (new Date()).toISOString();
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = 0;
                        a[5].rows = [
                            {source: 'note', email: 'a@b.c', updated_on: today},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: today},
                            {source: 'note', email: 'a@b.c', updated_on: today},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: today}
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/notes .* with no time/));
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
        it('should guess when client is chasing forgotten tickets', function(done){
            let today = (new Date()).toISOString(),
                last_week = (new Date(new Date().getTime()-14*24*60*60*1000)).toISOString();
            lwm.__apply_lint_rules.apply(
                lwm,
                setup(
                    (a) => {
                        a[1].total_hours = 0;
                        a[5].rows = [
                            {source: 'note', email: 'a@b.c', updated_on: last_week},
                            {source: 'note', email: 'me@catalyst-eu.net', updated_on: last_week},
                            {source: 'note', email: 'a@b.c', updated_on: today},
                        ];
                    },
                    (err, data) => {
                        should.not.exist(err);
                        should.exist(data);
                        should.exist(data.rows);
                        data.rows.length.should.equal(2);
                        should.exist(data.rows[0].warning);
                        should.exist(data.rows[0].warning.match(/forgotten/));
                        should.exist(data.rows[1].wr);
                        should.exist(data.rows[1].msg);
                        should.exist(data.rows[1].msg.match(/^1 warning/));
                        done();
                    }
                )
            );
        });
    });
});

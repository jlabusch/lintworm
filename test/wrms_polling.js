var assert  = require('assert'),
    config  = require('config'),
    MockDB  = require('./lib/mock_db').type,
    db      = require('../lib/db'),
    poller  = require('../lib/wrms_polling'),
    should  = require('should');

describe(require('path').basename(__filename), function(){
    let rows = [
        {request_id: 273724, newest: '2017-06-01 01:04:11'},
        {request_id: 249410, newest: '2017-06-01 02:30:32'},
        {request_id: 273489, newest: '2017-06-01 02:36:13'},
        {request_id: 273210, newest: '2017-06-01 02:38:03'}
    ];
    describe('basic operation', function(){
        it('should poll', function(done){
            db.__test_override(
                new MockDB([
                    [null, {rows: rows}]
                ])
            );
            poller.latest_update(new Date(rows[0].newest));
            poller.poll((err, data) => {
                should.not.exist(err);
                should.exist(data);
                should.exist(data.rows);
                (data.rows.length === rows.length).should.equal(true);
                for (let i = 0; i < rows.length; ++i){
                    data.rows[i].request_id.should.equal(rows[i].request_id);
                }
                poller.__latest_update.toISOString().should.equal(
                    new Date(rows[rows.length-1].newest).toISOString()
                );
                done();
            });
        });
        it('should call hooks', function(done){
            db.__test_override(
                new MockDB([
                    [null, {rows: rows}]
                ])
            );
            poller.latest_update(new Date(rows[0].newest));
            let called_hook = false;
            poller.add_hook('test hook', (data_rows) => {
                called_hook = true;
                should.exist(data_rows);
                (data_rows.length === rows.length).should.equal(true);
                for (let i = 0; i < rows.length; ++i){
                    data_rows[i].request_id.should.equal(rows[i].request_id);
                }
            });
            poller.poll((err, data) => {
                should.not.exist(err);
                should.exist(data);
                should.exist(data.rows);
                (data.rows.length === rows.length).should.equal(true);
                for (let i = 0; i < rows.length; ++i){
                    data.rows[i].request_id.should.equal(rows[i].request_id);
                }
                poller.__latest_update.toISOString().should.equal(
                    new Date(rows[rows.length-1].newest).toISOString()
                );
                setTimeout(function(){
                    called_hook.should.equal(true);
                    done();
                }, 100);
            });
        });
        it('should skip hooks on error', function(done){
            db.__test_override(
                new MockDB([
                    [new Error('test error'), null]
                ])
            );
            let called_hook = false;
            poller.add_hook('test hook', (data_rows) => {
                called_hook = true;
            });
            poller.poll((err, data) => {
                should.exist(err);
                setTimeout(function(){
                    called_hook.should.equal(false);
                    done();
                }, 100);
            });
        });
        it('should preserve lists between hooks', function(done){
            db.__test_override(
                new MockDB([
                    [null, {rows: rows}]
                ])
            );
            poller.latest_update(new Date(rows[0].newest));
            let called_hook_1 = false,
                called_hook_2 = false;
            let n = rows.length;
            poller.add_hook('test1', (data_rows) => {
                called_hook_1 = true;
                should.exist(data_rows);
                data_rows.length.should.equal(n);
                data_rows.shift();
            });
            poller.add_hook('test2', (data_rows) => {
                called_hook_2 = true;
                should.exist(data_rows);
                data_rows.length.should.equal(n);
                data_rows.shift();
            });
            poller.poll((err, data) => {
                should.not.exist(err);
                should.exist(data);
                should.exist(data.rows);
                data.rows.length.should.equal(n);
                setTimeout(function(){
                    called_hook_1.should.equal(true);
                    called_hook_2.should.equal(true);
                    done();
                }, 100);
            });
        });
    });
});

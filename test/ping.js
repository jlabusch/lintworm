var assert  = require('assert'),
    config  = require('config'),
    sa      = require('superagent'),
    app     = require('../index.js'),
    should  = require('should');

const PORT = config.get('server.port');

// answers should be an array of [err, data] pairs.
function MockDB(answers){
    this.answers = answers || [];
}

MockDB.prototype.query = function(){
    try{
        let args = Array.prototype.slice.call(arguments, 0),
            callback = arguments[arguments.length - 1];
        // Example (one element): [null, {rows: ['a', 'b', 'c']}]
        let answer = this.answers.shift() || [new Error('No more data'), null];
        if (typeof(callback) === 'function'){
            callback.apply(this, answer);
        }
    }catch(ex){
        console.error(ex);
    }
}

app.run(new MockDB(), PORT);

describe(require('path').basename(__filename), function(){
    describe('restify', function(){
        it('should be listening on port ' + PORT, function(done){
            let agent = sa.agent();
            agent.get('http://127.0.0.1:' + PORT + '/ping')
                 .end(function(err, res){
                     should.not.exist(err);
                     res.status.should.equal(200);
                     done();
                 });
        });
    });
});

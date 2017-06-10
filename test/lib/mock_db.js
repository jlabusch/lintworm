function MockDB(answers){
    // Example (one answer): [null, {rows: ['a', 'b', 'c']}]
    this.answers = answers || [];
}

MockDB.prototype.query = function(){
    return new Promise((resolve, reject) => {
        process.nextTick(() => {
            let answer = this.answers.shift() || [new Error('No more data'), null];

            if (answer[0]){
                reject(answer[0]);
            }else{
                resolve(answer[1]);
            }
        });
    });
}

module.exports = {
    create: function(answers){ return new MockDB(answers) },
    type: MockDB
}

module.exports = function(s){
    return s ? s.match(/(Service.Level.Agreement)|(?:^|_|\b)SLA(?:$|_|\b)/) : false
}


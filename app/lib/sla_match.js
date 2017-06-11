module.exports = function(s){
    return s ? s.match(/(Hosting)|(Service.Level.Agreement)|(?:^|_|\b)SLA(?:$|_|\b)/) : false
}


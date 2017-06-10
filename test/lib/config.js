var config = require('config');

var override = {};

module.exports = {
    set: function(k, v){ override[k] = v; },
    get: function(k){
        let v = override[k];
        if (v !== undefined){
            return v;
        }
        return config.get(k);
    }
}

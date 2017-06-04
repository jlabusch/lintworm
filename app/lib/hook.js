var log = require('./log');

exports.enable = function(obj, label){
    obj.__hooks = {};

    obj.add_hook = function(key, fn){
        if (!obj.__hooks){
            obj.__hooks = {};
        }

        let arr = obj.__hooks[key];

        if (!arr){
            arr = [];
        }

        arr.push(fn);
        obj.__hooks[key] = arr;

        return arr.length;
    }

    obj.call_hooks = function(data){
        if (!obj.__hooks){
            return;
        }

        process.nextTick(() => {
            Object.keys(obj.__hooks).forEach((key) => {
                if (obj.__hooks[key]){
                    log.trace(label + 'processing hook ' + key);

                    obj.__hooks[key].forEach((fn) => {
                        // TODO: find a more efficient way to isolate data
                        // between hooked functions.
                        let dcopy = JSON.parse(JSON.stringify(data));
                        fn(dcopy);
                    });
                }
            });
        });
    }
}


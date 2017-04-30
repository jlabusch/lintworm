function Lintworm(){
    this.__db = undefined;
}

Lintworm.prototype.db = function(x){
    this.__db = x;
}

module.exports = new Lintworm();


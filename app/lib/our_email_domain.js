module.exports = function(s){
    return s ? s.match(/catalyst(\-eu.net|.net.nz|\-au.net)/) : false
}

let bunyan  = require('bunyan'),
    config  = require('config'),
    fs      = require('fs'),
    pkg     = require('../package.json');

let streams = [
    {
        stream: process.stdout,
        level: config.get('log.level')
    }
];

if (config.get('log.file') &&
    config.get('log.file') !== '-')
{
    // TODO: play nice with standard logging things, e.g. file rotation
    streams.push({
        stream: fs.createWriteStream(
            config.get('log.file'),
            {
                flags: 'w',
                defaultEncoding: 'utf8',
                mode: 0o666
            }
        ),
        level: config.get('log.level')
    });
}

module.exports = bunyan.createLogger({
    name: pkg.name,
    streams: streams,
});

[OpenStreetMap]: https://www.openstreetmap.org/ "OpenStreetMap homepage"
[pbf-format]: http://wiki.openstreetmap.org/wiki/PBF_Format "PBF file format explained"

# OsmPbfAnalyst

An [OpenStreetMap][pbf-format] compressed xml or [PBF][pbf-format] [visual] parser

> I felt overwhelmed working with osm data, it felt opaque, so I wrote a parser that displayed what was inside a compressed xml file in order to learn the format, now I am confident in being able to use and move the data anywhere :)

![Preview](https://my.mixtape.moe/dtvxmq.gif)
*Set uiEnabled false to disable console output*

## Installation

`npm i <GIT_URL> --save`

## Quick Usage
```
const OsmPbfAnalyst = require('osm-pbf-analyst');

OsmPbfAnalyst('./path/to/file.pbf').start();
```

## Usage

```js
const OsmPbfAnalyst = require('osm-pbf-analyst')
const options = { // Defaults
  highWaterMark: 1024 * 64,
  uiEnabled: true,
  uiUpdateInterval: 600,
  uiColors: true,
}

OsmPbfAnalyst('./path/to/file.pbf', options)
.on('open', ...)
.on('end', ...)
.on('error', ...)
.on('header', ...)
.on('node', ...)
.on('way', ...)
.on('relationship', ...)
.on('changeset', ...)
.start()
.pause()
.resume()
//.stop()
```

## TODO

- Add to readme, api section; improve readme
- Fix terminal recorded gif
- Add "estimated time of arrival" (eta)
- Tests
- Stream from url and accept a Buffer as well

## LICENSE

MIT

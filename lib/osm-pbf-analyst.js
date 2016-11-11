module.exports = OsmPbfAnalyst;
const fs = require('fs');
const zlib = require('zlib');
const EventEmitter = require('events').EventEmitter;
const ProtocolBuffer = require('protobufjs');

const UiRender = require('./ui-render');

const Long = ProtocolBuffer.Long;
const FileFormat = ProtocolBuffer.loadProtoFile('./proto/File.proto').build('osmpbf');
const BlockFormat = ProtocolBuffer.loadProtoFile('./proto/Block.proto').build('osmpbf');

/**
* Default parser options
* @property DEFAULT_OPTIONS
* @type {Object}
*/
const DEFAULT_OPTIONS = {
  highWaterMark: 1024 * 64,
  uiEnabled: true,
  uiUpdateInterval: 600,
  uiColors: true,
};

/**
* @method OsmPbfAnalyst
* @param filename {String}
* @param [options] {Object}
*/
function OsmPbfAnalyst(filename, options) {
  const _options = Object.assign({}, DEFAULT_OPTIONS, options);
  const { highWaterMark, uiEnabled, uiUpdateInterval, uiColors } = _options;
  const memory = newMemoryObject(uiEnabled);
  const { internal, file, block, primitive } = memory;
  const fileReadStream = fs.createReadStream(filename, { highWaterMark });
  const instance = new EventEmitter();
  
  // Pause stream so it is manually started with `start` method
  fileReadStream.pause();

  /**
  * Tests whether buffer can be read a specified amount of bytes more.
  * Used to test that the buffer has a complete OSM File structure, before processing.
  * @method canRead
  * @param size {Number} of bytes to attempt to read, starting from `pointer` offset
  * @return {Boolean}
  */
  const canRead = (size) => internal.pointer + size <= internal.buffer.length;

  /**
  * Reads 4 bytes as a 32bit int from `pointer` offset
  * @method readInt32
  * @return {Int32|Number}
  */
  const readInt32 = () => {
    const value = internal.buffer.readInt32BE(internal.pointer);
    internal.pointer += 4;
    return value;
  };

  /**
  * Reads a specified amount of bytes as a Buffer from `pointer` offset
  * @method readBuffer
  * @param size {Number} of bytes to read
  * @return {Buffer}
  */
  const readBuffer = (size) => {
    const value = internal.buffer.slice(internal.pointer, internal.pointer + size);
    internal.pointer += size;
    return value;
  };


  /**
  * Removes elements preceding the `pointer` in buffer.
  * 1. This is to clear up memory as it is no longer needed. Reading
  * the buffer with `readInt32` & `readBuffer`, moves the pointer up
  * past bytes that have been read; bytes that are read are deleted.
  * 2. Resets `pointer` back to zero.
  * @method clipBuffer
  */
  const clipBuffer = () => {
    const newLength = internal.buffer.length - internal.pointer;
    const newBuffer = new Buffer(newLength);
    for (var i = 0; i < newLength; i++) {
      newBuffer[i] = internal.buffer[i + internal.pointer];
    }
    internal.buffer = newBuffer;
    internal.pointer = 0;
  };

  /**
  * Attempt to read a OSM File block.
  * @method readFile
  * @return {Boolean} `true` if a file structure was successfully read
  */
  const readFile = () => {
    if (canRead(4)) {
      const headerSize = readInt32();
      if (canRead(headerSize)) {
        const header = FileFormat.BlobHeader.decode(readBuffer(headerSize));
        if (canRead(header.datasize)) {
          const blob = FileFormat.Blob.decode(readBuffer(header.datasize));
          const { type } = header;
          // So far there are only two types: `OSMHeader` & `OSMData`
          instance.emit(type, blob);
          clipBuffer();
          return true;
        }
      }
    }
    return false;
  };

  /**
  * Setup File Stream Events
  */

  const onFileStreamClose = () => {
    file.opened = false;
    file.closed = true;
    instance.emit('end');
  };
  const onFileStreamData = (data) => {
      file.bytesRead += data.length;
      // Merge this chunk at the end of the `buffer`
      internal.buffer = Buffer.concat([internal.buffer, data], internal.buffer.length + data.length);
      // Reset pointer, so reading starts at the beggining of the internal.buffer.
      // OPTIMIZE It is possible to not reset pointer, instead conntinue if `readFile`
      // method can store its state.
      internal.pointer = 0;
      // Read all fully buffered file blocks
      while (readFile());
      // Count chunks received
      file.chunkCount += 1;
  };
  const onFileStreamEnd = () => fileReadStream.close();
  const onFileStreamError = (error) => intance.emit('error', error);
  const onFileStreamOpen = () => {
    file.opened = true;
    file.closed = false;
    instance.emit('open');
    fileReadStream.on('data', onFileStreamData);
  };

  /**
  * Parser Internal Events
  */

  const onOSMHeader = (blob) => {
    const { raw, raw_size, zlib_data, lzma_data, OBSOLETE_bzip2_data } = blob;
    if (raw) {
      instance.emit('header', BlockFormat.HeaderBlock.decode(raw));
    } else if (zlib_data) {
      const inflated = zlib.inflateSync(zlib_data.buffer.slice(zlib_data.offset));
      const header = BlockFormat.HeaderBlock.decode(inflated);
      instance.emit('Header', header);
    } else if (lzma_data) {
      // Proposed Compression; not required
    } else if (OBSOLETE_bzip2_data) {
      // Obsolete Compression; always ignore
    }
  };
  const onOSMData = (blob) => {
    const { raw, raw_size, zlib_data, lzma_data, OBSOLETE_bzip2_data } = blob;
    let primitiveBlock = null;
    if (raw) {
      primitiveBlock = BlockFormat.PrimitiveBlock.decode(raw);
    } else if (zlib_data) {
      const inflated = zlib.inflateSync(zlib_data.buffer.slice(zlib_data.offset));
      primitiveBlock = BlockFormat.PrimitiveBlock.decode(inflated);
    } else if (lzma_data) {
      // Proposed Compression; not required
    } else if (OBSOLETE_bzip2_data) {
      // Obsolete Compression; always ignore
    }

    if (!primitiveBlock) return instance;
    const { primitivegroup, lat_offset, lon_offset, granularity, date_granularity, stringtable } = primitiveBlock;
    const firstPrimitive = primitivegroup[0];
    const { nodes, dense, ways, relations, changesets } = firstPrimitive;
    // Each file block has to apply a fix to the lat/lon and timestamps on each node
    // http://wiki.openstreetmap.org/wiki/PBF_Format#Definition_of_OSMData_fileblock
    const fixLatitude = (lat) => .000000001 * lat.multiply(granularity).add(lat_offset);
    const fixLongitude = (lon) => .000000001 * lon.multiply(granularity).add(lon_offset);
    const fixTimestamp = (timestamp) => timestamp.multiply(date_granularity).divide(1000);
    const utf8StringTable = stringtable.s.map(x => x.toUTF8());
    const toolbox = { fixLatitude, fixLongitude, fixTimestamp, utf8StringTable, primitiveBlock };

    // A Primitive group can only have one halid property
    // A parser can ignore unsupported types      
    if (nodes.length) {
      instance.emit('Nodes', nodes, toolbox);
    } else if (dense) {
      instance.emit('DenseNode', dense, toolbox);
    } else if (ways.length) {
      instance.emit('Ways', ways, primitiveBlock.primitivegroup, primitiveBlock);
    } else if (relations.length) {
      instance.emit('Relations', relations, primitiveBlock.primitivegroup, primitiveBlock);
    } else if (changesets.length) {
      instance.emit('ChangeSets', changesets, primitiveBlock.primitivegroup, primitiveBlock);
    }
    return instance;
  };
  const onDenseNode = (dense, toolbox) => {
    const { id, denseinfo, lat, lon, keys_vals } = dense;
    const { primitiveBlock, utf8StringTable } = toolbox;
    const { stringtable } = primitiveBlock;
    const keyValsLength = dense.keys_vals.length;

    const errCheckMin = Math.min(id.length, lat.length, lon.length, denseinfo.version.length);
    const errCheckMax = Math.max(id.length, lat.length, lon.length, denseinfo.version.length);
    const length = errCheckMin;
    if (errCheckMin !== errCheckMax) throw new Error('Corrupt DenseNode');
    if (length !== 8000) console.warn(new Error('DenseNode Abnormal Length:' + length).stack);

    // Dense Nodes are delta encoded, in other words, the data is in
    // the `difference` between elements.
    let found_tag = false;
    let lastID = new Long(0);
    let lastLat = new Long(0);
    let lastLon = new Long(0);
    let changeset = new Long(0);
    let timestamp = new Long(0);
    let uid = 0;
    let user_sid = 0;
    let version = 0;
    let username = '';
    for (let i = 0; i < length; i++) {
      node = {tags: {}};
      lastID = lastID.add(dense.id[i]);
      lastLat = lastLat.add(dense.lat[i]);
      lastLon = lastLon.add(dense.lon[i]);
      user_sid += dense.denseinfo.user_sid[i];
      uid += dense.denseinfo.uid[i];
      timestamp = timestamp.add(dense.denseinfo.timestamp[i]);
      changeset = changeset.add(dense.denseinfo.changeset[i]);
      // Current node's data
      node.changeset = changeset;
      node.id = lastID;
      node.version = dense.denseinfo.version[i];
      node.lat = toolbox.fixLatitude(lastLat);
      node.lon = toolbox.fixLongitude(lastLon);
      node.timestamp = toolbox.fixTimestamp(timestamp);
      node.username = stringtable.s[user_sid].toUTF8();
      // Get tags for node
      for (var k = 0; k < keyValsLength; k++) {
        const keyId = keys_vals[k];
        k++;
        if (!keyId) break;
        const valueId = keys_vals[k];
        const key = utf8StringTable[keyId];
        const value = utf8StringTable[valueId];
        node.tags[key] = value;
      }
      instance.emit('Node', node);
    }
  };

  /**
  * Parser Flow Commands
  */

  const start = () => {
    if (!internal.started) {
      internal.started = true;
      internal.paused = false;
      fileReadStream.resume();
    }
    return instance;
  };

  const stop = () => {
    if (!file.closed) {
      file.closed = true;
      file.started = false;
      fileReadStream.close();
    }
    return instance;
  };

  const pause = () => {
    if (file.opened && internal.started && !internal.paused) {
      fileReadStream.pause();
    }
    return instance;
  };

  const resume = () => {
    if (file.opened && internal.started) {
      fileReadStream.resume();
    }
    return instance;
  };

  /**
  * Put it all together
  */

  fileReadStream.on('error', onFileStreamError);
  fileReadStream.on('end', onFileStreamEnd);
  fileReadStream.on('close', onFileStreamClose);
  fileReadStream.on('open', onFileStreamOpen);
  instance.on('OSMHeader', onOSMHeader);
  instance.on('OSMData', onOSMData);
  instance.on('DenseNode', onDenseNode);
  instance.start = start;
  instance.stop = stop;
  instance.pause = pause;
  instance.resume = resume;

  if (uiEnabled) {
    memory.file.name = filename;
    memory.timerRef = setupUiInterface(() => memory, uiUpdateInterval);

    /**
    * Since ui is being displayed, count nodes, ways, relations and 
    * changesets, as well as tags on each node.
    */

    instance 
    .on('Header', (header) => {
      block.header = header
    })
    .on('Node', (node) => {
      primitive.nodes++;
      primitive.node = node;
      if (node.tags) {
        const tag_keys = Object.keys(node.tags);
        for (var i = 0; i < tag_keys.length; i++) {
          const tag_key = tag_keys[i];
          if (primitive.tags_found.indexOf(tag_key) === -1) {
            primitive.tags_found.push(tag_key);
            primitive.tags_counter[tag_key] = 0;
          }
          primitive.tags_counter[tag_key]++;
        }
      }
    })
    .on('Ways', (ways) => {
      for (var i = 0; i < ways.length; i++) {
        primitive.ways++;
      }
    })
    .on('Relations', (relations) => {
      for (var i = 0; i < relations.length; i++) {
        primitive.relations++;
      }
    })
    .on('ChangeSets', (changeSets) => {
      for (var i = 0; i < changeSets.length; i++) {
        primitive.changesets++;
      }
    })
    .on('end', () => {
      setTimeout(() => {
        clearInterval(memory.timerRef);
      }, 200);
    });
    
    // Determine File Size
    fs.stat(filename, (error, stat)  => {
      if (error) throw error;
      file.size = stat.size;
    });
  }

  return instance;
}

/**
* @private
* @method newMemoryObject
* @param uiEnabled {Boolean}
* @return {Object}
*/
const newMemoryObject = (uiEnabled) => {
  const memory = {
    internal: { pointer: 0, buffer: new Buffer(0), started: false, paused: false },
    file: { name: '',  size: 0, bytesRead: 0, chunkCount: 0, chunkSize: 0, opened: false, closed: false },
  };
  if (uiEnabled) {
    memory.block = { header: {}, filesize: 0, discovered: 0, total: 0, bytes_read: 0, total_bytes_read: 0 };
    memory.primitive = { nodes: 0, ways: 0, relations: 0, change_sets: 0, tags_found: [], tags_counter: {} };
  }
  return memory;
};

/**
* @private
* Begins UI Interface
* @method uiConsole
*/
const setupUiInterface = (callback, interval) => {
  let busy = false;
  let timerRef = setInterval(() => {
    if (!busy) {
      busy = true;
      UiRender(callback());
      busy = false;
    }
  }, +interval || 600);
  UiRender(callback());
  return timerRef;
};

module.exports = UiRender;
const color = require('cli-color');
const clui = require('clui');
const Humanize = require('humanize-plus');
const inspect = require('util').inspect;
const debug = (o, d) => inspect(o, {colors: false, depth: d || 6});

const { fileSize, formatNumber } = Humanize;
const { Gauge, Spinner, Line, LineBuffer } = clui;

const TAB = 20;
const COLOR_HEAD = [color.white.underline];
const COLOR_LABEL = [color.cyan];
const COLOR_VALUE = [color.bold.white];

// process.stdout.on('resize', () => {});
const formatHeaderBBox = (bbox) => {
  if (bbox) {
    const left = (bbox.left.toNumber(10) * .000000001).toFixed(6);
    const top = (bbox.top.toNumber(10) * .000000001).toFixed(6);
    const right = (bbox.right.toNumber(10) * .000000001).toFixed(6);
    const bottom = (bbox.bottom.toNumber(10) * .000000001).toFixed(6);
    return [`left:${left}\tright:${right}`, ` top: ${top}\tbottom:${bottom}`];
  }
  return ['left:0 right:0', '  top: 0 bottom:0'];
};
const prep_node = (node) => {
  if (node) {
    node.changeset = node.changeset.toString(10)
    node.id = node.id.toString(10)
    node.timestamp = node.timestamp.toString(10)
    return JSON.parse(JSON.stringify(node), null, 4);
  }
  return node;
};


function UiRender(memory) {
  const { rows, columns } = process.stdout;
  const { internal, file, block, primitive } = memory;
  const outputBuffer = new LineBuffer({ x: 0, y: 0, width: 'console', height: 'console' });

  // Prepare data
  const formattedBBox = formatHeaderBBox(block.header.bbox);
  const fileCompletionPercentage = 100 * (file.bytesRead / file.size);
  const fileGauge = Gauge(file.bytesRead, file.size, 30, 0, `${fileCompletionPercentage.toFixed(6)}%`);

  // UI: Blank Line
  const blank = new Line(outputBuffer).fill();

  // Render

  if (false) {
    blank.store();

    new Line(outputBuffer).padding(1)
    .column('buffer size', TAB, COLOR_LABEL)
    .column(Humanize.fileSize(internal.buffer.length), COLOR_VALUE)
    .fill().store();
  }

  blank.store();

  new Line(outputBuffer).padding(1).column('PBF File', TAB, COLOR_HEAD).store();

  blank.store();

  new Line(outputBuffer).padding(1)
  .column('name', TAB, COLOR_LABEL)
  .column(file.name, COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
  .column('size', TAB, COLOR_LABEL)
  .column(fileSize(file.size), COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
  .column('read', TAB, COLOR_LABEL)
  .column(fileSize(file.bytesRead), COLOR_VALUE).fill().store();
  if (false) {
    new Line(outputBuffer).padding(1)
    .column('chunks', TAB, COLOR_LABEL)
    .column(`${formatNumber(file.chunkCount)}`, COLOR_VALUE).fill().store();
  }
  new Line(outputBuffer).padding(1)
  .column('progress', TAB, COLOR_LABEL)
  .column(String(fileGauge)).fill().store();

  blank.store();

  new Line(outputBuffer).padding(1).column('OSMHeader', TAB, COLOR_HEAD).store();

  blank.store();

  new Line(outputBuffer).padding(1)
  .column('bounds', TAB, COLOR_LABEL).column(formattedBBox[0], COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
  .column('    ', TAB, COLOR_LABEL).column(formattedBBox[1], COLOR_VALUE).fill().store();

  blank.store();

  new Line(outputBuffer).padding(1)
    .column('required_features', TAB, COLOR_LABEL)
    .column(String(memory.block.header.required_features), 60, COLOR_VALUE).fill().store();;
  new Line(outputBuffer).padding(1)
    .column('optional_features', TAB, COLOR_LABEL)
    .column(String(memory.block.header.optional_features), 60, COLOR_VALUE).fill().store();  
  new Line(outputBuffer).padding(1)
    .column('writingprogram', TAB, COLOR_LABEL)
    .column(String(memory.block.header.writingprogram), 60, COLOR_VALUE).fill().store();;
  new Line(outputBuffer).padding(1)
    .column('source', TAB, COLOR_LABEL)
    .column(String(memory.block.header.source), 60, COLOR_VALUE).fill().store();;

  blank.store();

  if (false) {
    new Line(outputBuffer).padding(1).column('Osmosis', TAB, COLOR_HEAD).store();

    blank.store();

    new Line(outputBuffer).padding(1)
      .column('timestamp', TAB, COLOR_LABEL)
      .column(String(memory.block.header.osmosis_replication_timestamp), 60, COLOR_VALUE).fill().store();
    new Line(outputBuffer).padding(1)
      .column('sequence_number', TAB, COLOR_LABEL)
      .column(String(memory.block.header.osmosis_replication_sequence_number), 60, COLOR_VALUE).fill().store();
    new Line(outputBuffer).padding(1)
      .column('base_url', TAB, COLOR_LABEL)
      .column(String(memory.block.header.osmosis_replication_base_url), 60, COLOR_VALUE).fill().store();

    blank.store();
  }  

  new Line(outputBuffer).padding(1).column('OSMData', TAB, [color.white.underline]).store();
  
  blank.store();
  new Line(outputBuffer).padding(1)
    .column('nodes', TAB, COLOR_LABEL)
    .column(formatNumber(primitive.nodes), COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
    .column('ways', TAB, COLOR_LABEL)
    .column(formatNumber(primitive.ways), COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
    .column('relationships', TAB, COLOR_LABEL)
    .column(formatNumber(primitive.relationships), COLOR_VALUE).fill().store();
  new Line(outputBuffer).padding(1)
    .column('changesets', TAB, COLOR_LABEL)
    .column(formatNumber(primitive.changesets), COLOR_VALUE).fill().store();

  blank.store();

  new Line(outputBuffer).padding(1)
    .column('node peek', TAB, COLOR_LABEL)
    .column(debug(prep_node(primitive.node)).replace(/\n/g, '').replace(/, /g, '').replace(/ \w+:/g, (x)=> color.cyan(x)), 1000, [color.bold.white]).fill().store();

  blank.store();
  
  const count = Object.keys(memory.primitive.tags_counter).length;

  if (true) {
    const colpossible = Math.ceil(columns / 30);
    const tags = Object.keys(memory.primitive.tags_counter);

    tags.sort((a, b) => primitive.tags_counter[b] - primitive.tags_counter[a]);

    new Line(outputBuffer).padding(1).column('Tags Found', TAB, [color.white.underline]).store();

    blank.store();

    for (var i = 0; i < tags.length; i++) {
      const tag = tags[i];
      new Line(outputBuffer).padding(1)
      .column(tag, 1 + String(tag).length, [color.bold.yellow])
      .column(formatNumber(memory.primitive.tags_counter[tag]), TAB, [color.bold.white])
      .fill().store();
    }
  }
  outputBuffer.output();
};

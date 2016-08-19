'use strict';

const gm = require('gm').subClass({ imageMagick: true });
const fs = require('fs');
const AWS = require('aws-sdk');

const TMP_PATH = '/tmp/img.jpg';
const FOREVER = '31536000';
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

function parsePath(path) {
  const res = /^full\/(.*)\/(.*)\.jpg/.exec(path);
  return {
    cam: res[1],
    name: res[2],
  };
}

function configNoSuchKeyHandler(err) {
  if (err.code === 'NoSuchKey') {
    return { Body: '{}' };
  }
  throw err;
}

function parseJsonBody(data) {
  return JSON.parse(data.Body.toString());
}

function getObject(params) {
  return new Promise((resolve, reject) => {
    s3.getObject(params, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

function getConfig(event) {
  return Promise.all([
    getObject({
      Bucket: event.bucket.name,
      Key: 'config.json',
    }).catch(configNoSuchKeyHandler).then(parseJsonBody),
    getObject({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/config.json`,
    }).catch(configNoSuchKeyHandler).then(parseJsonBody),
  ]).then(configs => Object.assign({}, configs[0], configs[1]));
}

function extractExif(event) {
  return new Promise((resolve, reject) => {
    gm(TMP_PATH).identify('%[EXIF:*]', (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  }).then(data => new Promise((resolve, reject) => {
    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/exif/${event.image.name}.txt`,
      Body: data || '\n',
      CacheControl: `max-age=${FOREVER}`,
    }, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  }));
}

function processImage(e) {
  const event = Object.assign(e);
  event.image = parsePath(event.object.key);
  return new Promise((resolve, reject) => {
    const stream = s3.getObject({
      Bucket: event.bucket.name,
      Key: event.object.key,
    }).createReadStream().pipe(fs.createWriteStream(TMP_PATH));

    stream.on('finish', res => resolve(res));
    stream.on('error', err => reject(err));
  })
  .then(() => getConfig(event))
  .then(config => {
    console.log('using config', config);
    return extractExif(event);
  })
  .then(() => true);
}

exports.handler = (event, context, callback) => {
  processImage(event.Records[0].s3)
    .then(res => callback(null, res))
    .catch(err => callback(err));
};

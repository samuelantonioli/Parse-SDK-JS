/**
 * Copyright (c) 2015-present, Parse, LLC.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */

import CoreManager from './CoreManager';
import ParsePromise from './ParsePromise';

type Base64 = { base64: string };
type FileData = Array<number> | Base64 | File;
export type FileSource = {
  format: 'file';
  file: File;
  type: string
} | {
  format: 'base64';
  base64: string;
  type: string
};

var dataUriRegexp =
  /^data:([a-zA-Z]*\/[a-zA-Z+.-]*);(charset=[a-zA-Z0-9\-\/\s]*,)?base64,/;

function b64Digit(number: number): string {
  if (number < 26) {
    return String.fromCharCode(65 + number);
  }
  if (number < 52) {
    return String.fromCharCode(97 + (number - 26));
  }
  if (number < 62) {
    return String.fromCharCode(48 + (number - 52));
  }
  if (number === 62) {
    return '+';
  }
  if (number === 63) {
    return '/';
  }
  throw new TypeError('Tried to encode large digit ' + number + ' in base64.');
}

/**
 * A Parse.File is a local representation of a file that is saved to the Parse
 * cloud.
 * @class Parse.File
 * @constructor
 * @param name {String} The file's name. This will be prefixed by a unique
 *     value once the file has finished saving. The file name must begin with
 *     an alphanumeric character, and consist of alphanumeric characters,
 *     periods, spaces, underscores, or dashes.
 * @param data {Array} The data for the file, as either:
 *     1. an Array of byte value Numbers, or
 *     2. an Object like { base64: "..." } with a base64-encoded String.
 *     3. a File object selected with a file upload control. (3) only works
 *        in Firefox 3.6+, Safari 6.0.2+, Chrome 7+, and IE 10+.
 *        For example:<pre>
 * var fileUploadControl = $("#profilePhotoFileUpload")[0];
 * if (fileUploadControl.files.length > 0) {
 *   var file = fileUploadControl.files[0];
 *   var name = "photo.jpg";
 *   var parseFile = new Parse.File(name, file);
 *   parseFile.save().then(function() {
 *     // The file has been saved to Parse.
 *   }, function(error) {
 *     // The file either could not be read, or could not be saved to Parse.
 *   });
 * }</pre>
 * @param type {String} Optional Content-Type header to use for the file. If
 *     this is omitted, the content type will be inferred from the name's
 *     extension.
 */
export default class ParseFile {
  _name: string;
  _url: ?string;
  _source: FileSource;
  _previousSave: ?ParsePromise;

  constructor(name: string, data?: FileData, type?: string) {
    var specifiedType = type || '';

    this._name = name;

    if (data !== undefined) {
      if (Array.isArray(data)) {
        this._source = {
          format: 'base64',
          base64: ParseFile.encodeBase64(data),
          type: specifiedType
        };
      } else if (typeof File !== 'undefined' && data instanceof File) {
        this._source = {
          format: 'file',
          file: data,
          type: specifiedType
        };
      } else if (data && typeof data.base64 !== 'undefined') {
        const base64 = data.base64;
        var commaIndex = base64.indexOf(',');

        if (commaIndex !== -1) {
          var matches = dataUriRegexp.exec(base64.slice(0, commaIndex + 1));
          // if data URI with type and charset, there will be 4 matches.
          this._source = {
            format: 'base64',
            base64: base64.slice(commaIndex + 1),
            type: matches[1]
          };
        } else {
          this._source = {
            format: 'base64',
            base64: base64,
            type: specifiedType
          };
        }
      } else {
        throw new TypeError('Cannot create a Parse.File with that data.');
      }
    }
  }

  /**
   * Gets the name of the file. Before save is called, this is the filename
   * given by the user. After save is called, that name gets prefixed with a
   * unique identifier.
   * @method name
   * @return {String}
   */
  name(): string {
    return this._name;
  }

  /**
   * Gets the url of the file. It is only available after you save the file or
   * after you get the file from a Parse.Object.
   * @method url
   * @param {Object} options An object to specify url options
   * @return {String}
   */
  url(options?: { forceSecure?: boolean }): ?string {
    options = options || {};
    if (!this._url) {
      return;
    }
    if (options.forceSecure) {
      return this._url.replace(/^http:\/\//i, 'https://');
    } else {
      return this._url;
    }
  }

  /**
   * Saves the file to the Parse cloud.
   * @method save
   * @param {Object} options A Backbone-style options object.
   * @return {Parse.Promise} Promise that is resolved when the save finishes.
   */
  save(options?: { success?: any, error?: any }) {
    options = options || {};
    var controller = CoreManager.getFileController();
    if (!this._previousSave) {
      if (this._source.format === 'file') {
        this._previousSave = controller.saveFile(this._name, this._source).then((res) => {
          this._name = res.name;
          this._url = res.url;
          return this;
        });
      } else {
        this._previousSave = controller.saveBase64(this._name, this._source).then((res) => {
          this._name = res.name;
          this._url = res.url;
          return this;
        });
      }
    }
    if (this._previousSave) {
      return this._previousSave._thenRunCallbacks(options);
    }
  }

  toJSON(): { name: ?string, url: ?string } {
    return {
      __type: 'File',
      name: this._name,
      url: this._url
    };
  }

  equals(other: mixed): boolean {
    if (this === other) {
      return true;
    }
    // Unsaved Files are never equal, since they will be saved to different URLs
    return (
      (other instanceof ParseFile) &&
      this.name() === other.name() &&
      this.url() === other.url() &&
      typeof this.url() !== 'undefined'
    );
  }

  static fromJSON(obj): ParseFile {
    if (obj.__type !== 'File') {
      throw new TypeError('JSON object does not represent a ParseFile');
    }
    var file = new ParseFile(obj.name);
    file._url = obj.url;
    return file;
  }

  static encodeBase64(bytes: Array<number>): string {
    var chunks = [];
    chunks.length = Math.ceil(bytes.length / 3);
    for (var i = 0; i < chunks.length; i++) {
      var b1 = bytes[i * 3];
      var b2 = bytes[i * 3 + 1] || 0;
      var b3 = bytes[i * 3 + 2] || 0;

      var has2 = (i * 3 + 1) < bytes.length;
      var has3 = (i * 3 + 2) < bytes.length;

      chunks[i] = [
        b64Digit((b1 >> 2) & 0x3F),
        b64Digit(((b1 << 4) & 0x30) | ((b2 >> 4) & 0x0F)),
        has2 ? b64Digit(((b2 << 2) & 0x3C) | ((b3 >> 6) & 0x03)) : '=',
        has3 ? b64Digit(b3 & 0x3F) : '='
      ].join('');
    }

    return chunks.join('');
  }
}

var DefaultController = {
  saveFile: function(name: string, source: FileSource) {
    if (source.format !== 'file') {
      throw new Error('saveFile can only be used with File-type sources.');
    }
    // To directly upload a File, we use a REST-style AJAX request
    var headers = {
      'X-Parse-Application-ID': CoreManager.get('APPLICATION_ID'),
      'X-Parse-JavaScript-Key': CoreManager.get('JAVASCRIPT_KEY')
    };
    var url = CoreManager.get('SERVER_URL');
    if (url[url.length - 1] !== '/') {
      url += '/';
    }
    url += 'files/' + name;
    return CoreManager.getRESTController().ajax('POST', url, source.file, headers);
  },

  saveBase64: function(name: string, source: FileSource) {
    if (source.format !== 'base64') {
      throw new Error('saveBase64 can only be used with Base64-type sources.');
    }
    var data: { base64: any; _ContentType?: any } = {
      base64: source.base64
    };
    if (source.type) {
      data._ContentType = source.type;
    }
    var path = 'files/' + name;
    return CoreManager.getRESTController().request('POST', path, data);
  }
};

CoreManager.setFileController(DefaultController);

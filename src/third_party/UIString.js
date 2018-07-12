'use strict';

const util = require('util');

const Common = {
  UIString(...args) {
    return util.format(...args)
  }
}

module.exports = Common;

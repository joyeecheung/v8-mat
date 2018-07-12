'use strict';

const TextUtils = {
  TextUtils: {}
};

/**
 * @unrestricted
 */
TextUtils.TextUtils.BalancedJSONTokenizer = class {
  /**
   * @param {function(string)} callback
   * @param {boolean=} findMultiple
   */
  constructor(callback, findMultiple) {
    this._callback = callback;
    this._index = 0;
    this._balance = 0;
    this._buffer = '';
    this._findMultiple = findMultiple || false;
    this._closingDoubleQuoteRegex = /[^\\](?:\\\\)*"/g;
  }

  /**
   * @param {string} chunk
   * @return {boolean}
   */
  write(chunk) {
    this._buffer += chunk;
    const lastIndex = this._buffer.length;
    const buffer = this._buffer;
    let index;
    for (index = this._index; index < lastIndex; ++index) {
      const character = buffer[index];
      if (character === '"') {
        this._closingDoubleQuoteRegex.lastIndex = index;
        if (!this._closingDoubleQuoteRegex.test(buffer))
          break;
        index = this._closingDoubleQuoteRegex.lastIndex - 1;
      } else if (character === '{') {
        ++this._balance;
      } else if (character === '}') {
        --this._balance;
        if (this._balance < 0) {
          this._reportBalanced();
          return false;
        }
        if (!this._balance) {
          this._lastBalancedIndex = index + 1;
          if (!this._findMultiple)
            break;
        }
      } else if (character === ']' && !this._balance) {
        this._reportBalanced();
        return false;
      }
    }
    this._index = index;
    this._reportBalanced();
    return true;
  }

  _reportBalanced() {
    if (!this._lastBalancedIndex)
      return;
    this._callback(this._buffer.slice(0, this._lastBalancedIndex));
    this._buffer = this._buffer.slice(this._lastBalancedIndex);
    this._index -= this._lastBalancedIndex;
    this._lastBalancedIndex = 0;
  }

  /**
   * @return {string}
   */
  remainder() {
    return this._buffer;
  }
};

module.exports = TextUtils;

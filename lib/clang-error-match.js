"use strict";

module.exports = clangErrorMatch;

function clangErrorMatch(output) {
  // Turns regex into parser.
  // |regexp| is regular expression
  // |extract| is function which receives regular expression match object (not null)
  //           and returns arbitrary info (not null).
  // Returns function which receives string and returns either null or info
  // returned by |extract|.
  function reParser(regexp, extract) {
    return function(line) {
      var m = regexp.exec(line);
      if (m == null) {
        return null;
      }
      return extract(m);
    }
  }

  var reError = /^([a-zA-Z0-9_/.+-]+):(\d+):(\d+):\s(?:fatal )?error:\s(.+)$/;
  function errorParser(line) {
    var m = reError.exec(line);
    if (m == null) return null;
    return {
      file: m[1],
      line: m[2],
      col: m[3],
      message: m[4],
    };
  }

  var reNote = /^([a-zA-Z0-9_/.+-]+):(\d+):(\d+):\snote:\s(.+)$/;
  function noteParser(line) {
    var m = reNote.exec(line);
    if (m == null) return null;
    return {
      file: m[1],
      line: m[2],
      col: m[3],
      message: m[4],
    };
  }

  var reInclude = /^In file included from ([a-zA-Z0-9_/.+-]+):(\d+):$/;
  function includeParser(line) {
    var m = reInclude.exec(line);
    if (m == null) return null;
    return {
      file: m[1],
      line: m[2],
    };
  }

  var reAuxMessage = /^(\d+ errors? generated.|ninja:.*)$/;
  function auxParser(line) {
    var m = reAuxMessage.exec(line);
    if (m == null) return null;
    return line;
  }

  var parsers = [
    { name: 'error',   parser: errorParser },
    { name: 'note',    parser: noteParser },
    { name: 'include', parser: includeParser },
    { name: 'aux',     parser: auxParser },
  ];

  function parseLine(line) {
    for (var i = 0; i < parsers.length; ++i) {
      var p = parsers[i];
      const info = p.parser(line);
      if (info !== null) {
        return { kind: p.name, info: info };
      }
    }
    return { kind: null, info: line };
  }

  class Parser {
    constructor(lines) {
      this.lines = lines;
      this.pos = -1;
      this.moveNext();
    }

    skipUntil(kinds) {
      while (!this.done() && kinds.indexOf(this.current.kind) == -1) {
        this.moveNext();
      }
      return !this.done();
    }

    moveNext() {
      this.pos += 1;
      if (this.pos < this.lines.length) {
        this.current = parseLine(this.lines[this.pos]);
      } else {
        this.current = null;
      }
    }

    done() {
      return this.current === null;
    }
  }

  // When file path contains '..' component then navigation
  // (clicking on "at line N col M in foo/bar/file") works fine, but
  // lint marks on gutter and inline lint bubbles are not displayed.
  // So try to exclude '..' components from path.
  function normalizePath(path) {
    var parts = [];
    for (var c of path.split('/')) {
      if (c == '..' && parts.length > 0 && parts[parts.length-1] != '..')
        parts.pop();
      else
        parts.push(c);
    }
    return parts.join('/');
  }

  function parseError(parser) {
    var includes = [];
    while (!parser.done() && parser.current.kind == 'include') {
      includes.push(parser.current.info);
      parser.moveNext();
    }
    if (parser.done() || parser.current.kind != 'error')
      return null;

    const match = {
      type: 'Error',
      file: normalizePath(parser.current.info.file),
      line: parser.current.info.line,
      col: parser.current.info.col,
      message: parser.current.info.message,
      trace: includes.map(inc => {return {
        type: 'Trace',
        file: normalizePath(inc.file),
        line: inc.line,
        message: 'In file included ',
      }}),
    };
    parser.moveNext();

    while (!parser.done() && parser.current.kind == null) {
      match.message += '\n' + parser.current.info;
      parser.moveNext();
    }

    var m;
    while (m = parseNote(parser)) {
      // If 'in instantiation of' note is met, it means original error points
      // to template implementation rather than to instantiation point, which is
      // rarely useful. So replace original error position with one of instantiation
      // and store original error as note.
      if (m.message.startsWith('in instantiation of')) {
        match.trace.push({
          file: match.file,
          line: match.line,
          col: match.col,
          message: 'Original error location',
        });
        match.file = m.file;
        match.line = m.line;
        match.col = m.col;
        match.message += "\n" + m.message;
      } else {
        match.trace.push(m);
      }
    }

    return match;
  }

  function parseNote(parser) {
    if (parser.done() || parser.current.kind != 'note')
      return null;

    const match = {
      file: normalizePath(parser.current.info.file),
      line: parser.current.info.line,
      col: parser.current.info.col,
      message: parser.current.info.message,
    }
    parser.moveNext();
    while (!parser.done() && parser.current.kind === null) {
      match.message += '\n' + parser.current.info;
      parser.moveNext();
    }
    return match;
  }

  const lines = output.split(/\n/);
  const matches = [];
  const parser = new Parser(lines);
  while (parser.skipUntil(['error', 'include'])) {
    var match = parseError(parser);
    if (match !== null)
      matches.push(match);
  }
  return matches;
}

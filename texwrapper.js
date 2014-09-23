var spawn   = require("child_process").spawn;
var path    = require("path");
var fs      = require("fs");
var fse     = require("fs-extra");
var temp    = require("temp");
var through = require("through");

//Eagerly create temporary directory
var directory_built = false
  , directory_err   = null
  , directory_wait  = []
  , directory_path  = "/tmp"
  , directory_count = 0;
temp.mkdir("node-latex", function(err, dirpath) {
  if(!err) {
    process.on("exit", function() {
      fse.removeSync(dirpath);
    });
  }
  directory_err = err;
  directory_path = dirpath;
  directory_built = true;
  for(var i=0; i<directory_wait.length; ++i) {
    directory_wait[i]();
  }
  directory_wait.length = 0;
});

//Waits for directory to be built
function awaitDir(cb) {
  function makeLocalDir() {
    if(directory_err) {
      cb(directory_err, null);
      return;
    }
    var temp_path = path.join(directory_path, "" + directory_count++);
    fse.mkdirp(temp_path, function(err) {
      if(err) {
        cb(err, null);
        return;
      }
      cb(null, temp_path);
    });
  }
  if(directory_built) {
    makeLocalDir();
  } else {
    directory_wait.push(makeLocalDir);
  }
}

//Send errors downstream to result
function handleErrors(dirpath, result) {
  var log_file = path.join(dirpath, "texput.log");
  fs.exists(log_file, function(exists) {
    if(!exists) {
      fse.remove(dirpath);
      result.emit("error", new Error("Error running LaTeX"));
      return;
    }
    //Try to crawl through the horrible mess that LaTeX shat upon us
    var log = fs.createReadStream(log_file);
    var err = [];
    log.on("data", function(data) {
      var lines = data.toString().split("\n");
      for(var i=0; i<lines.length; ++i) {
        var l = lines[i];
        if(l.length > 0) {
          err.push(lines[i]);
        }
      }
    });
    log.on("end", function() {

      if(err.length > 0) {
        result.emit("error", new LatexSyntaxError("LaTeX Syntax Error", err));
      } else {
        result.emit("error", new Error("Unspecified LaTeX Error"));
      }
    });
  });
}

//Converts a expression into a LaTeX image
module.exports.LatexSyntaxError = LatexSyntaxError;
module.exports.create = function(doc, options) {
  if(!options) {
    options = {};
  }

  var format = options.format || "pdf";

  //LaTeX command
  var tex_command = options.command || (format === "pdf" ? "pdflatex" : "latex");

  //Create result
  var result = through();
  awaitDir(function(err, dirpath) {
    function error(e) {
      result.emit("error", e);
      result.destroySoon();
    }
    if(err) {
      error(err);
      return;
    }
    //Write data to tex file
    var input_path = path.join(dirpath, "texput.tex");
    var tex_file = fs.createWriteStream(input_path);

    tex_file.on("close", function() {
      //Invoke LaTeX
      var tex = spawn(tex_command, [
        "-halt-on-error",
        "-interaction=nonstopmode",
        "texput.tex"
      ], {
        cwd: dirpath,
        env: process.env
      });

      // Let the user know if LaTeX couldn't be found
      tex.on('error', function(err) {
        if (err.code === 'ENOENT') {
          console.error("\nThere was an error spawning " + tex_command + ". \n"
                        + "Please make sure your LaTeX distribution is"
                        + "properly installed.\n");
        } else {
          handleErrors(dirpath, result);
        }
      });

      //Wait for LaTeX to finish its thing
      tex.on("exit", function(code, signal) {
        var output_file = path.join(dirpath, "texput." + format);
        fs.exists(output_file, function(exists) {
          if(exists) {
            var stream = fs.createReadStream(output_file);
            stream.on("close", function() {
              fse.remove(dirpath);
            });
            stream.pipe(result);
          } else {
            handleErrors(dirpath, result);
          }
        });
      });
    });

    if(typeof doc === "string" || doc instanceof Buffer) {
      tex_file.end(doc);
    } else if(doc instanceof Array) {
      for(var i=0; i<doc.length; ++i) {
        tex_file.write(doc[i]);
      }
      tex_file.end();
    } else if(doc.pipe) {
      doc.pipe(tex_file);
    } else {
      error(new Error("Invalid document"));
      return;
    }
  });

  return result;
};

function LatexSyntaxError (message, raw_log) {
  this.message = message;
  this.raw_log = raw_log;
  var log = [];
  var err_message;
  for(var i=0; i<this.raw_log.length; ++i) {
    var log_line = this.raw_log[i];
    if(/^!/.test(log_line)) {
      if (err_message) {
        log.push(err_message);
      }
      err_message = log_line;
    }
    var regex = /^l\.(\d+)(.+)/;
    if(err_message && regex.test(log_line)) {
      var matches = log_line.match(regex);
      var trace = [];
      trace.push(matches[2]);
      for(var j=i+1; j<this.raw_log.length; ++j) {
        var stack_line = this.raw_log[j];
        if(/^\s/.test(stack_line)){
          trace.push(stack_line.replace(/^\s+/, '  '));
        } else {
          break;
        }
      }
      log.push('Line ' + matches[1] + ': ' + err_message.replace(/^!\s+/, '') + '\n' + trace.join('\n'));
      log.push('');
      err_message = undefined;
    }
    this.trace = log.join('\n');
  }
}
LatexSyntaxError.prototype = new Error();
LatexSyntaxError.prototype.constructor = LatexSyntaxError;

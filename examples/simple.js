
//Simple example
var dvistream = require("../texwrapper.js").create([
  "\\documentclass{article}",
  "\\begin{document}",
  "abc",
  "\\end{document}"
],{
  cmd_turns: 2
});
dvistream.pipe(process.stdout);

/*
 * This file sets the log level to SILENT when referenced.  It should only be referenced
 * from the command line by the mocha runner.
 */

import * as log from "loglevel";

log.setLevel(log.levels.SILENT);

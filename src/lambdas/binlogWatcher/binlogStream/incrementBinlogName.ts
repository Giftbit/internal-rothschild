export function incrementBinlogName(binlogName: string): string {
    const lastDotIx = binlogName.lastIndexOf(".");
    if (lastDotIx === -1) {
        throw new Error(`Binlog name ${binlogName} doesn't have a '.' and can't be incremented.`);
    }

    const prefix = binlogName.substring(0, lastDotIx);
    const suffix = binlogName.substring(lastDotIx + 1);
    const suffixParsed = +suffix;
    if (isNaN(suffixParsed)) {
        throw new Error(`Binlog name ${binlogName} suffix can't be parsed to a number.`);
    }

    const suffixPlusOne = (suffixParsed + 1 + "").padStart(suffix.length, "0");
    return `${prefix}.${suffixPlusOne}`;
}

import papaparse = require("papaparse");

export function csvSerializer(body: any): string {
    return papaparse.unparse(body);
}
